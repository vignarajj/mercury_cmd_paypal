# Mercury Cmd: Execution Spec (v2, hardened for the PayPal AI Hackathon)

**Status:** Implemented · **Scope:** PayPal sandbox only

---

## 0. Product in One Paragraph

Mercury Cmd is a macOS command palette. Press a global hotkey from any app, type "Bill sarah@acme.co $1,200 for brand refresh and $300 for icons, net 15", review an editable preview, press `Cmd+Enter`, and a real **PayPal sandbox invoice** is created, sent, and linked, with its live status (SENT → PAID) shown in the palette.

- **Who:** freelancers, contractors and small agencies who invoice from a dozen different tools.
- **Problem:** invoicing breaks flow. Leave the work, open PayPal, fill many fields, copy a link.
- **Why it wins:** PayPal is the product (not a bolt-on), the AI does real extraction with grounding checks, and the demo shows the full loop including the buyer paying.

### Locked decisions

| Decision | Choice | Why |
| :--- | :--- | :--- |
| Platform | **macOS only** (Tauri v2) | Global shortcuts are unreliable on Linux/Wayland; Windows adds test cost. Video is recorded on the build device. |
| Global hotkey | `CommandOrControl+Shift+Space`, overridable via `MERCURY_HOTKEY` | Bare `Cmd+K` would steal the key from most editors and chat apps. |
| LLM | **Local Ollama** (`gemma4:e2b-it-qat`, tested 33/33), structured JSON output | Free, private, no API key needed. |
| Fallback | Deterministic **regex parser** when Ollama is offline or times out (8 s) | App always works; judges without Ollama still get a working demo (single-item "basic mode"). |
| AI scope | Extraction + grounding checks (no agent tool-calls) | Depth comes from validation, multi-item invoices, payment terms and the live status loop. |
| Sponsor tools | None. **PayPal only** | Keeps the integration focused on PayPal. |
| Currencies | `USD, EUR, GBP, CAD, AUD` | Avoids zero-decimal currency rejections (JPY etc.). |
| License | **MIT** | Detectable by GitHub in the About section, as the rules require. |
| Backend start | `make dev` launches uvicorn + Tauri. No sidecar. | Fastest path; documented in README. |

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Desktop: Tauri v2 (Rust shell, macOS)                       │
│  • Global hotkey registered in Rust (Pressed only)          │
│  • Frameless, transparent, always-on-top, vibrancy window   │
│  • React 19 + TS + Tailwind v4 + Framer Motion + Lucide     │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTP, 127.0.0.1:47891, header X-Mercury-Token
┌───────────────▼─────────────────────────────────────────────┐
│ FastAPI microservice (Python 3.12, httpx async)             │
│  /api/parse        → Ollama (structured JSON) → regex fb    │
│  /api/invoice      → PayPal create → send → link            │
│  /api/invoice/{id} → PayPal status                          │
│  /api/health                                                │
└───────┬──────────────────────────────┬──────────────────────┘
        │                              │
   Ollama :11434              PayPal Sandbox REST
   (optional)                 https://api-m.sandbox.paypal.com
```

**Web mode (for judges without Rust):** the same React app runs in a browser via `npm run dev:web`. The palette is always visible and `Cmd+K` is handled in-page. Everything else (backend, PayPal, parsing) is identical.

---

## 2. Configuration (`backend/.env`, never committed)

| Variable | Example | Notes |
| :--- | :--- | :--- |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | from sandbox app | App must have **Invoicing** enabled |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` | Backend **refuses to start** if the host is not a `sandbox` host |
| `PAYPAL_MERCHANT_EMAIL` | sandbox business email | Used for the self-invoice check |
| `LLM_PROVIDER` | `ollama` or `none` | `none` forces regex mode |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://localhost:11434` / `gemma4:e2b-it-qat` | One default model, everywhere |
| `LLM_TIMEOUT_S` | `8` | Then fall back to regex |
| `MERCURY_TOKEN` | random string | Shared secret with the frontend; required on all `/api/*` calls |
| `MERCURY_HOTKEY` | `CommandOrControl+Shift+Space` | Read by the Tauri shell |
| `ALLOWED_ORIGINS_REGEX` | `^(tauri://localhost|http://localhost:\d+|http://127\.0\.0\.1:\d+)$` | Passed to `allow_origin_regex` (wildcard ports are invalid in `allow_origins`) |

### PayPal sandbox prerequisites (checklist)

- [ ] Developer Dashboard → Sandbox app created, **Invoicing** feature on.
- [ ] **Tick Invoicing and Save BEFORE the first token request.** PayPal reuses the same access token for a client until it expires (about 9 h; the `nonce` repeats), so enabling a feature afterwards can leave you with a token that has no Invoicing scope (403 `NOT_AUTHORIZED`). If that happens, create a fresh app with Invoicing enabled first.
- [ ] Sandbox **Business** account (merchant) with invoicing available, country **United States**. An India-based merchant/buyer is blocked from sending invoices (`INR_FOREIGN_CURRENCY_BLOCKED`).
- [ ] Sandbox **Personal** account (buyer), country **United States**, real sandbox email, password saved. This is the demo recipient. `@example.com` addresses will not work for the "buyer pays" step.
- [ ] Confirm the three response shapes in §4. `make smoke` runs the real round trip.

---

## 3. API Contract

All routes require `X-Mercury-Token`, except `GET /api/health` (open, returns no secrets, lets the UI say "backend not running"). Bind to `127.0.0.1`. Start with `uvicorn app.main:create_app --factory --host 127.0.0.1 --port 47891`.

### `POST /api/parse`

```json
// request
{ "text": "Bill sarah@acme.co $1,200 for brand refresh and $300 for icons, net 15" }

// response 200
{
  "client_email": "sarah@acme.co",
  "items": [
    { "name": "Brand refresh", "quantity": 1, "unit_amount": "1200.00" },
    { "name": "Icons",         "quantity": 1, "unit_amount": "300.00"  }
  ],
  "currency": "USD",
  "due_days": 15,
  "note": null,
  "missing_fields": [],
  "is_complete": true,
  "warnings": [],
  "source": "llm"            // "llm" | "regex"
}
```

**Server-side rules (never trust the model):**

1. `client_email` is kept **only if it appears literally in the input** (case-insensitive) and passes email validation. Otherwise `null` and `missing_fields += ["client_email"]`.
2. Every `unit_amount` must correspond to a number present in the input (after removing `,` and currency symbols). Otherwise drop the item and add a warning `"amount not found in text"`.
3. Amounts parsed as `Decimal`, quantized to `0.01`, must be `> 0` and `<= 1,000,000`. Max **10 items**.
4. `currency` must be in the whitelist; default `USD`; `$`→USD, `€`→EUR, `£`→GBP.
5. `is_complete` and `missing_fields` are **computed by the server** (email present, ≥1 valid item). The model's own flags are ignored.
6. `source: "regex"` adds the warning `"Basic mode: single item only"`.
7. **Latest read wins.** The palette reads while the person types and drops its previous request on every pause, so a new `/api/parse` call cancels the one still running (which stops the model working on it). The replaced request answers `409 PARSE_SUPERSEDED`; the palette has already abandoned it and ignores the reply. Without this, half-typed sentences queued ahead of the real one and pushed it past the 8-second limit into Basic mode.

### `POST /api/invoice`

```json
// request (what the preview card sends after user edits)
{
  "client_email": "sarah@acme.co",
  "items": [{ "name": "Brand refresh", "quantity": 1, "unit_amount": "1200.00" }],
  "currency": "USD",
  "due_days": 15,
  "note": null,
  "request_id": "uuid-from-client"      // idempotency key
}
```

```json
// response 200
{
  "invoice_id": "INV2-XXXX-XXXX-XXXX-XXXX",
  "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-XXXX-XXXX-XXXX-XXXX",
  "status": "SENT",
  "client_email": "sarah@acme.co",
  "total": "1500.00",
  "currency": "USD"
}
```

```json
// error shape (all non-2xx)
{ "error": { "code": "SEND_FAILED", "message": "Draft created but sending failed.",
             "invoice_id": "INV2-…", "retryable": true } }
```

| Code | HTTP | Meaning | UI behavior |
| :--- | :-: | :--- | :--- |
| `INVALID_INPUT` | 422 | Bad email/amount/currency | Highlight the field |
| `SELF_INVOICE` | 422 | Recipient equals `PAYPAL_MERCHANT_EMAIL` | "Use a different recipient (this is your own business account)" |
| `PAYPAL_AUTH` | 502 | Credentials rejected after one retry | "Check PayPal sandbox credentials" |
| `PAYPAL_REJECTED` | 422 | PayPal 4xx; pass through `details[].issue` + `description` | Show PayPal's message |
| `SEND_FAILED` | 502 | Draft exists, send failed | Offer **Retry send** (`POST /api/invoice/{id}/send`) |
| `UPSTREAM_TIMEOUT` | 504 | PayPal timeout | Retry button |

Do not hardcode PayPal's own error names; map by HTTP class and surface PayPal's `details`.

**Verified quirk:** PayPal can return HTTP **406** with the misleading top-level name `MEDIA_TYPE_NOT_ACCEPTABLE` when the real cause is in `details[0].issue`/`description` (seen: `INR_FOREIGN_CURRENCY_BLOCKED` when sending from an India-based sandbox account). Always show `details[0].description` when present, and use `details[0].issue` (not the top-level `name`) for logic. Treat a 4xx on send as `SEND_FAILED` with the draft's `invoice_id`.

### `GET /api/invoice/{id}` → `{ "status": "PAID", "paid_at": "…" | null }`
### `POST /api/invoice/{id}/send` → retries the send step for an existing draft
### `GET /api/health` → `{ "paypal": "ok|error", "llm": "ok|offline", "mode": "llm|regex" }`

---

## 4. PayPal Pipeline (Invoicing v2)

> Items marked **Verified** were checked against the live PayPal sandbox; the rest follow PayPal's v2 documentation.

1. **Token.** `POST /v1/oauth2/token`, HTTP Basic, `grant_type=client_credentials`. Cache in memory with `expires_at = now + expires_in`, reuse while `now < expires_at - 60`. Guard refresh with an `asyncio.Lock`. On any PayPal **401**: clear cache, refresh, retry the call **once**.
2. **Create draft.** `POST /v2/invoicing/invoices`.
   - `detail.currency_code`, optional `detail.note`. **Do not send `detail.invoice_date`** (verified Nov 4): the local calendar day can be ahead of PayPal's US calendar, and PayPal then marks the invoice `SCHEDULED` (sent later) instead of `SENT`. Omitting it makes PayPal use its own today and send immediately. `SCHEDULED` is shown in the UI as a warning pill if it ever appears.
   - `detail.payment_term`: map `due_days` → `DUE_ON_RECEIPT` (0), `NET_10/15/30/45/60/90` (exact match), otherwise `DUE_ON_DATE_SPECIFIED` with `due_date = today + due_days`. `NET_15` is verified (PayPal fills in `due_date` itself); confirm the other names in Phase 1 tests.
   - `primary_recipients[0].billing_info.email_address`.
   - `items[]`: `name`, `quantity` (string), `unit_amount {currency_code, value}` where `value` comes from `Decimal(...).quantize(Decimal("0.01"))`. Never use `float`.
   - Header `PayPal-Request-Id: <request_id>` (harmless if ignored).
   - **Verified in sandbox (Nov 3):** the 201 response is a link object (`rel`, `href`, `method`), not `{"id": …}`. Extract the invoice ID as the last path segment of `href` (e.g. `INV2-XXXX-XXXX-XXXX-XXXX`); fall back to `body["id"]` if present.
3. **Send.** `POST /v2/invoicing/invoices/{id}/send` with `{"send_to_recipient": true, "send_to_invoicer": true}`. Accept `200` or `202`. **Verified:** a `200` returns `{rel: "payer-view", href: "https://www.sandbox.paypal.com/invoice/p/#INV2-XXXX-…", method: "GET"}`, so the send response already contains a payer link. **Verified quirk:** calling `/send` immediately after create can return **404 with an empty body** (eventual consistency). Retry on 404 up to 4 times with 1 s, 2 s, 3 s backoff before reporting `SEND_FAILED`; the same call succeeded on retry.
4. **Link + status.** `GET /v2/invoicing/invoices/{id}`.
   - Link: `detail.metadata.recipient_view_url` (**verified**; `payer_view_url` does not exist in v2). Real example: `https://www.sandbox.paypal.com/invoice/p/#XXXXXXXXXXXXXXXX`. Note the fragment (the send response's `payer-view` link uses the full `INV2-…` ID instead; prefer `recipient_view_url` as canonical) is the invoice ID **without the `INV2-` prefix and without dashes**. Fallback: `https://www.sandbox.paypal.com/invoice/p/#` + `id.removeprefix("INV2-").replace("-", "")`.
   - Status: `status` field.
5. **Idempotency.** Keep `request_id → result` in an in-memory dict (TTL 10 min). A repeated `request_id` returns the stored result and never creates a second invoice. The UI also disables the send button in flight.
6. **Partial failure.** If step 3 fails after step 2 succeeded, return `SEND_FAILED` with `invoice_id` so the UI can retry only the send. Never create a second draft for the same `request_id`.
7. **Self-invoice guard.** Compare lowercase `client_email` to `PAYPAL_MERCHANT_EMAIL` before calling PayPal.
8. **Timeouts.** `httpx.AsyncClient(timeout=15)`; one shared client, created at app startup.
9. **Progress events.** The UI shows `Authenticating → Creating draft → Sending → Done`. Simplest: the frontend steps through a timed animation tied to the single request, not streamed events.

---

## 5. Parsing Engine

### Ollama path
- `POST {OLLAMA_BASE_URL}/api/chat`, `stream:false`, `temperature:0`, `keep_alive:"30m"`, and `format` set to the **JSON schema** of `ParsedInvoiceCandidate` (structured outputs).
- System prompt: extract only what is literally stated; use `null` for anything missing; never invent emails or amounts; split multiple deliverables into items; map "net 30" → `due_days: 30`, "due on receipt" → `0`.
- Backend **warms the model on startup** (a 1-token request) so the first demo call is fast.
- Any exception, non-JSON, or >`LLM_TIMEOUT_S` → fall back to regex.
- Post-process through the server-side rules in §3.

**Verified against a live model (Nov 4, `gemma4:e2b-it-qat`):**
- A pydantic-generated schema (with `$defs`/`$ref` and optional fields) made the model **omit `items` entirely**. The shipped schema is hand-written, flat and fully required (`LLM_SCHEMA` in `ai_service.py`); a test guards it.
- Corpus result via `scripts/eval_parser.py`: **LLM 33/33, regex 30/30 (regex-capable cases)**. Few-shot examples are deliberately *not* corpus cases. The corpus is developer-written, so treat it as a regression suite, not an unbiased benchmark.
- Latency: **median about 2.5 s, max about 4.7 s** per parse with warm-up. Never promise sub-second parsing; the UI shows a shimmer and the 600 ms auto-parse debounce stays.
- If the model returns no usable items but the text has an amount, the regex fills them and `source` becomes `"regex"` (honest "Basic mode" badge) with a warning.
- Model names come back lowercase; grounding capitalizes the first letter.

### Regex fallback (deterministic, single item)
1. Extract the email first: `[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`; strip trailing punctuation; remove it from the working text.
2. Extract the amount from the cleaned text. Prefer a number with a currency marker (`$`, `€`, `£`, `USD`, etc.); otherwise accept a single bare number only if exactly one remains. Support `1,200.50` and `1.5k`.
3. Extract terms: `net\s*(\d+)` or `due on receipt`.
4. Service name: remove filler (`bill`, `invoice`, `send`, `charge`, `to`, `for`, `of`, `a`, `an`, `the`, `about`) and the matched tokens; collapse whitespace; title-case; if empty → missing field.
5. Result carries `source:"regex"` and the "Basic mode" warning.

### Test corpus
Keep `backend/tests/parse_cases.json` with ≥ 25 prompts (single item, multi item, euro, "k" amounts, missing email, missing amount, digits in the email, "Sprint 2", trailing period, ALL CAPS). Both paths must pass the same corpus where the capability exists.

---

## 6. Desktop Shell (Tauri v2, macOS)

**`tauri.conf.json` essentials**
- `app.macOSPrivateApi: true` (transparent window) and Cargo feature `macos-private-api`.
- Window: `label: "main"`, `width: 680`, `height: 96` (grows), `decorations:false`, `transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `visible:false`, `shadow:false`, `center:true`.
- `windowEffects`: macOS `hudWindow` vibrancy with rounded radius. CSS `backdrop-filter` cannot blur the desktop behind a window, so native vibrancy is required for the glass look.
- `lib.rs`: `app.set_activation_policy(ActivationPolicy::Accessory)` so the app has no Dock icon and can float over full-screen apps.

**Hotkey (Rust, in `setup`)**
- Register `MERCURY_HOTKEY` through `tauri_plugin_global_shortcut`.
- Handler **must check `event.state() == ShortcutState::Pressed`**, otherwise it fires on release too and toggles twice.
- Toggle: if visible → hide; else center, show, `set_focus`, emit `palette:shown` to the webview (which focuses the input).

**Window lifecycle**
- Hide on `Escape` (per UI rules) and on blur, with a **150 ms debounce** to avoid flicker when focus bounces during show.
- **State is preserved across hide.** Reset to idle after 60 s hidden, or after a successful send once the window is dismissed.
- Dynamic height: the frontend calls `setSize` as content changes (input only ≈ 96 px, preview ≈ 360 px, success ≈ 300 px).

**`capabilities/default.json`** must include: `core:window:allow-show`, `allow-hide`, `allow-set-focus`, `allow-set-size`, `allow-center`, `allow-is-visible`, `core:event:default`, `global-shortcut:allow-register/unregister/is-registered`, and `opener:default` (to open the payment link in the default browser).

---

## 7. UI / UX Spec

**Design tokens:** dark neutral glass, one accent colour, 14–16 px radius, 2 type sizes in the palette, Lucide icons. Do not use PayPal logos or marks (third-party trademarks in the video are disallowed); the word "PayPal" in text is fine.

**States**

```
IDLE → PARSING → PREVIEW(valid | incomplete) → SENDING → SUCCESS(status polling)
                      ↘ ERROR (inline, recoverable) ↗
```

**Keyboard**

| Key | Behavior |
| :--- | :--- |
| Hotkey | Toggle palette |
| `Enter` in input | Parse now |
| Auto-parse | After 600 ms pause **if** text contains `@` and a digit; cancel in-flight request with `AbortController` on new input |
| `Cmd+Enter` | Send invoice (only when preview is valid) |
| `Tab` / `Shift+Tab` | Move across preview fields |
| `Esc` | Preview open → back to input (keeps text); after a send → start over and stay open; input has text → clear; input empty → hide |
| `⌘N` | New invoice from any state except sending |
| `⌘,` | Open the Dashboard |
| `Cmd+C` on success | Copy payment link |

**Preview card:** editable email, one row per item (name, qty, amount), currency select, due-terms select, total line, amber "Missing: email. Click to type" badges, warning chips from `warnings`, source badge ("AI" or "Basic mode"). Send button disabled until valid.

**Sending:** inputs disabled, stepper `Authenticating → Creating draft → Sending`.

**Success card:** animated check, "Invoice sent to …", invoice ID, total, **status pill** that polls `GET /api/invoice/{id}` every 4 s for 2 minutes, then every 15 s for up to an hour, stops at a final status, and re-checks immediately when the window regains focus (a hidden window's timers are throttled, and payments often arrive while the user is in the browser). Buttons: **Copy payment link**, **Open in browser**, **Create another**.

**Errors:** friendly inline message from the §3 table, never a raw stack trace. Backend unreachable → "Mercury backend is not running (run `make dev`)".

**Empty/first-run:** placeholder text "Try: Bill client@acme.co $500 for logo design, net 15"; a footer chip shows `Sandbox` so it is obvious no real money moves.

---

## 8. Security & Safety

- Backend bound to `127.0.0.1`; every `/api/*` requires `X-Mercury-Token`; CORS via `allow_origin_regex`.
- `.env` is gitignored; `backend/.env.example` documents every variable; secrets never logged.
- Sandbox-only guard: the process exits at startup if `PAYPAL_API_BASE` does not contain `sandbox`.
- No real money anywhere in the project. State this in README and the Devpost text.

---

## 9. Acceptance Tests (must pass before recording)

| # | Test | Expected |
| :-: | :--- | :--- |
| A1 | `curl` script: token → create → send → get | Invoice visible in the buyer's sandbox account; link opens |
| A2 | Parse corpus (≥ 25 cases) | ≥ 90 % exact on LLM path; 100 % on the regex-capable subset |
| A3 | Hallucination guard | Input without an email never yields an email |
| A4 | Double `Cmd+Enter` | Exactly one invoice created |
| A5 | Kill Ollama | `/api/parse` still returns, `source:"regex"` |
| A6 | Recipient = merchant email | `SELF_INVOICE` message, no PayPal call |
| A7 | Send fails after draft (simulated) | `SEND_FAILED` + working **Retry send** |
| A8 | Expired token mid-session | One transparent retry, request succeeds |
| A9 | Buyer pays in sandbox | Status pill flips to PAID within ~10 s |
| A10 | Hotkey from another app | Palette appears once, input focused; second press hides |
| A11 | Fresh clone, README only | A new person gets a working demo in ≤ 10 min (web mode if no Rust) |
| A12 | Backend stopped | Clear "not running" message |

---

## 10. Dashboard and Desktop Window Behavior

### Why
The palette is a fixed, borderless, always-on-top window by design. History, invoice detail and settings need a normal window, so the app has two windows that share one frontend: the **palette** (label `main`) and the **Dashboard** (label `dashboard`, route `#/dashboard`).

### Palette flow rules
- After a successful send the input is **cleared**; typing or pasting starts a new invoice immediately.
- `Esc` after a send starts over and keeps the palette open; the next `Esc` on an empty input hides it.
- **Pin** (footer icon, or Settings): the palette does not hide when focus moves elsewhere. Stored locally and mirrored to the native window.
- The palette is draggable by its top edge and footer. On show it opens near the top of the display under the mouse (unless pinned).
- If the global hotkey cannot be registered, the app still starts: the menu-bar icon works and the palette shows a notice naming the cause.

### Dashboard window (Tauri)
- Standard title bar with close, minimize and zoom; resizable; minimum 980 x 600; centered on first open.
- While it is open the app is a regular app (Dock icon); closing it returns to menu-bar-only.
- Opened from the tray menu (**Open Dashboard**), the palette footer icon, or `⌘,`. It identifies itself by its native window label, so it does not depend on a URL fragment.
- Browser mode serves the same screens at `/#/dashboard` and `/#/dashboard/settings`.

### Backend endpoints for the Dashboard
All require `X-Mercury-Token`.

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/invoices?page=&page_size=&status=&q=` | The merchant's invoices from PayPal (`POST /v2/invoicing/search-invoices`), newest first. `status` is repeatable and validated; an email in `q` is sent to PayPal as `recipient_email`, other text filters the returned page by email, number or id. `page_size` is 1 to 100. Verified against the sandbox |
| `GET /api/invoice/{id}/detail` | Items with line totals, invoice date, sent time, terms, due date, note, paid and due amounts, and payment transactions |
| `GET /api/models` | Chat models installed in Ollama (`models`, each flagged `cloud` or local), every other model Ollama has with the reason it cannot be used (`unavailable`: `cloud` while cloud models are not allowed, or `embedding`), the current and default model, `allow_cloud`, and Ollama's status (`ok`, `model_missing`, `offline`, `disabled`) |
| `POST /api/model` | Body `{"model": "<name>"}`. Switches the parsing model without a restart and remembers it in `backend/.mercury-prefs.json`. Rejects models that are not installed (`MODEL_NOT_INSTALLED`, 422), cloud models before the opt-in (`CLOUD_NOT_ALLOWED`, 422), a stopped Ollama (`LLM_OFFLINE`, 503) and `LLM_PROVIDER=none` (`LLM_DISABLED`, 409) |
| `POST /api/cloud` | Body `{"allow": true}` or `{"allow": false}`. The opt-in for Ollama cloud models, which run on ollama.com so the invoice text leaves the computer. Off by default and remembered in `backend/.mercury-prefs.json`. Turning it off while a cloud model is selected switches back to a local model at once. Same errors as `/api/model` for `LLM_DISABLED` |
| `GET /api/info` | Read-only settings and live health: PayPal status, host and merchant email; AI provider, model and status; backend version. Never includes credentials or the shared token |

### Screens
- **Invoices:** search and status chips (All, Awaiting payment, Paid, Draft or scheduled, Cancelled or refunded), a list with client, number, date, amount and status, paging, and a detail pane with the Created, Sent, Paid timeline and Copy link, Open and Copy ID actions.
- **Settings:** theme (System, Light, Dark), AI model (installed models, switch, the off-by-default Cloud models opt-in with its privacy warning, the models that cannot be used and why, and a four-step Ollama setup guide that opens by itself when no model is ready), shortcut and registration state, pin switch, live connection health with retry, recent invoices stored on this device (with Clear), About, and Quit (desktop).

### Status polling
The success card polls `GET /api/invoice/{id}` every 4 s for 2 minutes, then every 15 s for up to an hour, stops at a final status, and re-checks immediately when the window regains focus.

### Dock icon
A packaged build takes its Dock icon from `icon.icns`. A `tauri dev` build is a bare binary, so macOS would show the generic "exec" icon; the app therefore also sets its icon at startup from `icons/icon.png`. The icon artwork (`frontend/brand/app-icon-macos.svg`) has the usual transparent margin so it sits at the same size as other Dock icons.
