# Testing and verification

How Mercury Cmd is tested, what you can try yourself in the running app, and the current status of each check.

**Status legend**
- **Automated**: covered by tests that run with `make test` (mocked PayPal and Ollama).
- **Live**: checked against the real PayPal sandbox and a real local model.
- **To verify**: not yet checked by a person in the running app.

---

## 1. Automated tests (`make test`)

| Area | Tests | What they prove |
| :--- | :---: | :--- |
| Backend, PayPal service and API (`test_paypal.py`, `test_api.py`) | 41 | Token caching and refresh, create, send with retry, idempotency, partial-failure retry, error mapping, self-invoice block, CORS, auth token, sandbox-only guard |
| Backend, parsing (`test_parse.py`) | 112 | 33-case corpus through the rule-based parser and through grounding; hallucinated email and amount dropped; fallback when Ollama fails, is slow or returns junk |
| Frontend logic (`invoice`, `entities`, `recents`) | 42 | Exact money math, validation, request building, entity highlighting, recents store |
| Frontend accessibility (`a11y.test.tsx`, axe-core) | 6 | No violations on the empty state, preview, missing-email preview and success card; every control has a name; Esc steps back |
| Frontend contrast (`contrast.test.ts`) | 24 | WCAG AA and AAA contrast for every text color in dark and light themes |
| **Total** | **225** | Backend 153, frontend 72, plus a clean TypeScript check |

Related commands: `make eval` (parse corpus against the real model), `make smoke TO=<buyer email>` (real PayPal round trip), `make shots` (regenerate screenshots).

## 2. Live checks against real services

| Check | Result |
| :--- | :--- |
| Token, create, send, read back in the PayPal sandbox (`make smoke`) | Pass: invoice reaches `SENT`, payer link returned |
| Local model on the 33-case corpus (`make eval`) | 33 of 33 answered by the model itself |
| Rule-based fallback on its 30 supported cases | 30 of 30 |
| Ollama unreachable | Pass: fallback answers in milliseconds, health reports `llm: offline` |
| Invoice sent from the UI (dark and light, several sends) | Pass: `Awaiting payment`, and it appears in Recent invoices after a reload |
| Duplicate `request_id`, self-invoice, no token, no email in the text | Pass against the running API |
| Backend stopped | Pass: "Mercury's backend isn't running. Start it with `make backend`." |
| Clean copy of the repo: `make setup`, tests, web build, backend run | Pass (the desktop Rust build was not repeated in the copy) |

## 3. Scenarios you can try in the running app

Start with `make dev-web` (browser) or `make dev` (desktop). Use a sandbox buyer email as the recipient.

### Describe it

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 1 | Full sentence | `Invoice <buyer> $1,200 for brand refresh and $300 for icons, net 15` | Two items, Net 15, total $1,500.00, "AI" badge | Live |
| 2 | Quantity | `Bill <buyer> 3 hours of consulting at $100 per hour, due on receipt` | Qty 3, $100, total $300.00, Due on receipt | Live |
| 3 | Live highlighting | Type any sentence | Email blue, amounts green, terms amber while you type | Live |
| 4 | Examples | Click an example in the empty state | It fills the input and reads it | Live |
| 5 | Missing email | `invoice $500 for logo design` | Amber "Missing: email. Click to type", cursor jumps to the email field | Live |
| 6 | No invented values | `bill them $100 for design work` | No email is made up; email flagged missing | Live, Automated |
| 7 | Currencies | `Charge x@y.co €500 for logo design` | Currency set to EUR | Automated |
| 8 | Basic mode | Stop Ollama, then parse | "Basic mode" badge, single item | Live (API), To verify (badge) |
| 9 | Missing amount | `bill sarah@acme.co for logo design` | "Missing: amount. Click to add an item" | Automated, To verify (UI) |

### Review it

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 10 | Edit fields | Change description, quantity, unit price | Line amounts and total update | Automated, To verify (UI) |
| 11 | Add and remove items | "Add item", trash icon | Rows change, total updates, last row cannot be removed | To verify |
| 12 | Currency and terms | Use the two dropdowns | Symbols and terms change, icon and chevron do not overlap the text | Live (layout, after a macOS fix), To verify (changing values) |
| 13 | Validation | Clear the email or enter 0 | Field turns amber, send is blocked with a hint | Automated, To verify (UI) |
| 14 | Back and clear | `Esc` in preview, `Esc` again | Back to the input, then cleared | Live |

### Send it

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 15 | Send | `⌘↵` | Authenticating, Creating draft, Sending, then the success card | Live |
| 16 | Really sent | Look at the pill | "Awaiting payment", not "Scheduled" | Live |
| 17 | Double send | Press `⌘↵` twice quickly | Exactly one invoice | Automated, Live (API) |
| 18 | Own account | Use the merchant email | "That is your own business account. Use a different recipient." | Live (API), To verify (UI) |
| 19 | Backend down | Stop the backend, then parse or send | "Mercury's backend isn't running…" | Live |
| 20 | Send fails after the draft | Force a send error | Draft kept, "Retry send" button, no second invoice | Automated, To verify (UI) |

### Track it

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 21 | Copy link | "Copy payment link" | Button shows "Link copied"; the link opens the payer page | Live (button and link), To verify (`⌘C`) |
| 22 | Open link | "Open" | PayPal sandbox payer page opens in the browser | To verify |
| 23 | **Buyer pays** | Open the link, log in as the sandbox buyer, pay | Pill changes to **Paid**, timeline completes, title becomes "Payment received" | Live: payment verified at PayPal (invoice `PAID`, transaction `SUCCESS`), and the open card flips to Paid after the polling fix |
| 24 | Recent invoices | Reload or reopen the palette | Last five invoices with live status, copy and open buttons | Live |
| 25 | Start over | `Esc` or "Create another" | Palette resets | Live |

### Look and accessibility

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 26 | Dark and light | Switch the system appearance | Both themes render correctly | Live (browser) |
| 27 | Theme toggle | Click the sun, moon or monitor icon in the footer | Cycles system, light, dark and remembers it | To verify |
| 28 | Keyboard only | `Tab`, arrow keys through examples, `⌘↵`, `Esc` | Everything reachable, visible focus ring | Automated, To verify (manual) |
| 29 | Contrast and labels | `make test` | 24 contrast and 6 accessibility checks pass | Automated |
| 30 | Reduced motion | Enable it in the system settings | Animations are skipped | To verify |

### Desktop app (Tauri, macOS)

| # | Scenario | Try | Expect | Status |
| :-: | :--- | :--- | :--- | :---: |
| 31 | Hotkey | `⌘⇧Space` from another app | Palette appears with the input focused | Live |
| 32 | Hide | Press the hotkey again, press `Esc` on an empty input, or click another app | Palette hides, a sent invoice stays on screen when you return | To verify |
| 33 | Resize | Type a sentence and wait | Window grows to fit the preview | To verify |
| 34 | Menu-bar icon | Look at the menu bar | Icon appears; click toggles; right-click shows Open and Quit | To verify |
| 35 | Native glass and theme | Switch appearance, use the theme toggle | Blur and tint follow dark and light | To verify |
| 36 | No Dock icon | Look at the Dock | App does not appear there | To verify |
| 37 | Custom hotkey | Set `MERCURY_HOTKEY=Alt+Space` and restart | New shortcut works | To verify |

## 4. Known gaps

- Payment is now verified end to end in the sandbox. The first attempt exposed a polling bug (the card stopped checking after five minutes), which is fixed and covered by regression tests.
- Desktop-only behavior (31 to 37 except the hotkey opening the palette) needs a person at the Mac.
- `Retry send` is covered by service tests but not yet exercised through the UI.
- The rule-based parser handles one item per invoice; this is by design (see README).
