"""PayPal Invoicing v2 client (sandbox only).

Behaviors verified against the live sandbox (see execution spec, section 4):
- create returns a link object (no `id`); the invoice id is the last path segment of `href`
- `/send` can 404 with an empty body right after create, so it is retried with backoff
- the payer link is `detail.metadata.recipient_view_url`
"""
import asyncio
import datetime as dt
import logging
import time
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

import httpx

from ..config import Settings
from ..errors import MercuryError
from ..models import InvoiceRequest, InvoiceResult, InvoiceStatus

log = logging.getLogger("mercury.paypal")

NET_TERMS = {10, 15, 30, 45, 60, 90}
PAYPAL_TZ = ZoneInfo("America/Los_Angeles")  # PayPal dates invoices on the US calendar
SEND_RETRY_DELAYS = (1.0, 2.0, 3.0)  # seconds between /send attempts that return 404
RESULT_TTL_S = 600
SANDBOX_VIEW_BASE = "https://www.sandbox.paypal.com/invoice/p/#"


def payment_term(due_days: int | None, today: dt.date) -> dict | None:
    """Map a number of days to a PayPal v2 `detail.payment_term` object."""
    if due_days is None:
        return None
    if due_days == 0:
        return {"term_type": "DUE_ON_RECEIPT"}
    if due_days in NET_TERMS:
        return {"term_type": f"NET_{due_days}"}
    return {
        "term_type": "DUE_ON_DATE_SPECIFIED",
        "due_date": (today + dt.timedelta(days=due_days)).isoformat(),
    }


def invoice_id_from_href(href: str) -> str:
    return href.rstrip("/").rsplit("/", 1)[-1]


def fallback_view_url(invoice_id: str) -> str:
    """PayPal's payer-view fragment is the invoice id without the `INV2-` prefix and dashes."""
    return SANDBOX_VIEW_BASE + invoice_id.removeprefix("INV2-").replace("-", "")


class PayPalService:
    def __init__(
        self,
        settings: Settings,
        client: httpx.AsyncClient,
        *,
        sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
        today: Callable[[], dt.date] = lambda: dt.datetime.now(PAYPAL_TZ).date(),
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._s = settings
        self._http = client
        self._sleep = sleep
        self._today = today
        self._clock = clock

        self._token: str | None = None
        self._expires_at = 0.0
        self._token_lock = asyncio.Lock()

        self._results: dict[str, tuple[float, InvoiceResult]] = {}
        self._drafts: dict[str, tuple[float, str]] = {}
        self._inflight: dict[str, asyncio.Future] = {}

    # ---------------------------------------------------------------- auth

    async def get_token(self, stale: str | None = None) -> str:
        """Return a cached token, refreshing when expired or when `stale` was just rejected."""
        async with self._token_lock:
            fresh = self._token and self._clock() < self._expires_at - 60
            if fresh and self._token != stale:
                return self._token  # type: ignore[return-value]
            try:
                resp = await self._http.post(
                    f"{self._s.paypal_api_base}/v1/oauth2/token",
                    auth=(self._s.paypal_client_id, self._s.paypal_client_secret),
                    data={"grant_type": "client_credentials"},
                    headers={"Accept": "application/json"},
                )
            except httpx.TimeoutException as exc:
                raise MercuryError("UPSTREAM_TIMEOUT", "PayPal timed out. Try again.", 504, retryable=True) from exc
            except httpx.HTTPError as exc:
                raise MercuryError("UPSTREAM_ERROR", "Could not reach PayPal.", 502, retryable=True) from exc
            if resp.status_code != 200:
                raise MercuryError("PAYPAL_AUTH", "PayPal rejected the sandbox credentials. Check backend/.env.", 502)
            data = resp.json()
            self._token = data["access_token"]
            self._expires_at = self._clock() + float(data.get("expires_in", 300))
            return self._token  # type: ignore[return-value]

    async def _request(self, method: str, path: str, *, json: dict | None = None,
                       headers: dict | None = None) -> httpx.Response:
        """Authenticated call. On a 401, refresh the token and retry exactly once."""
        token = await self.get_token()
        for attempt in (0, 1):
            try:
                resp = await self._http.request(
                    method,
                    f"{self._s.paypal_api_base}{path}",
                    json=json,
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json", **(headers or {})},
                )
            except httpx.TimeoutException as exc:
                raise MercuryError("UPSTREAM_TIMEOUT", "PayPal timed out. Try again.", 504, retryable=True) from exc
            except httpx.HTTPError as exc:
                raise MercuryError("UPSTREAM_ERROR", "Could not reach PayPal.", 502, retryable=True) from exc
            if resp.status_code == 401 and attempt == 0:
                token = await self.get_token(stale=token)
                continue
            return resp
        raise AssertionError("unreachable")

    @staticmethod
    def _error_from(resp: httpx.Response) -> MercuryError:
        """Translate a PayPal error response. Logic uses `details[0]`, never the top-level name
        (PayPal can answer 406 MEDIA_TYPE_NOT_ACCEPTABLE when the real cause is in `details`)."""
        try:
            body = resp.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        first = (body.get("details") or [{}])[0]
        message = first.get("description") or body.get("message") or f"PayPal returned HTTP {resp.status_code}."
        log.warning("PayPal %s: status=%s issue=%s debug_id=%s", resp.request.url.path, resp.status_code,
                    first.get("issue"), body.get("debug_id"))
        if resp.status_code in (401, 403):
            return MercuryError("PAYPAL_AUTH", f"PayPal denied the request: {message}", 502)
        if resp.status_code == 429 or resp.status_code >= 500:
            return MercuryError("UPSTREAM_ERROR", f"PayPal is having trouble ({resp.status_code}). Try again.",
                                502, retryable=True)
        return MercuryError("PAYPAL_REJECTED", message, 422)

    # ------------------------------------------------------------ pipeline

    def build_draft_payload(self, req: InvoiceRequest) -> dict:
        detail: dict[str, Any] = {
            # No `invoice_date` on purpose: PayPal fills in its own "today". Sending the local date
            # made invoices SCHEDULED (not sent) whenever the user's calendar day was ahead of the US.
            "currency_code": req.currency,
        }
        if req.note:
            detail["note"] = req.note
        term = payment_term(req.due_days, self._today())
        if term:
            detail["payment_term"] = term
        return {
            "detail": detail,
            "primary_recipients": [{"billing_info": {"email_address": str(req.client_email)}}],
            "items": [
                {
                    "name": item.name,
                    "quantity": str(item.quantity),
                    "unit_amount": {"currency_code": req.currency, "value": f"{item.unit_amount:.2f}"},
                }
                for item in req.items
            ],
        }

    async def create_draft(self, req: InvoiceRequest) -> str:
        resp = await self._request(
            "POST", "/v2/invoicing/invoices",
            json=self.build_draft_payload(req),
            headers={"PayPal-Request-Id": req.request_id},
        )
        if resp.status_code not in (200, 201):
            raise self._error_from(resp)
        body = resp.json() if resp.content else {}
        invoice_id = body.get("id") or (invoice_id_from_href(body["href"]) if body.get("href") else None)
        if not invoice_id:
            raise MercuryError("UPSTREAM_ERROR", "PayPal returned an unexpected response when creating the invoice.", 502)
        return invoice_id

    async def send_invoice(self, invoice_id: str) -> str | None:
        """Send a draft. Returns the payer link from the response when PayPal provides one."""
        path = f"/v2/invoicing/invoices/{invoice_id}/send"
        body = {"send_to_recipient": True, "send_to_invoicer": True}
        for attempt in range(len(SEND_RETRY_DELAYS) + 1):
            try:
                resp = await self._request("POST", path, json=body)
            except MercuryError as exc:
                raise MercuryError("SEND_FAILED", f"Draft created but sending failed: {exc.message}",
                                   exc.http_status, invoice_id=invoice_id, retryable=exc.retryable) from exc
            if resp.status_code in (200, 202):
                try:
                    data = resp.json() if resp.content else {}
                except ValueError:
                    data = {}
                return data.get("href") if isinstance(data, dict) else None
            if resp.status_code == 404 and attempt < len(SEND_RETRY_DELAYS):
                await self._sleep(SEND_RETRY_DELAYS[attempt])
                continue
            err = self._error_from(resp)
            if resp.status_code == 404:
                err = MercuryError("UPSTREAM_ERROR", "PayPal could not find the new invoice yet.", 502, retryable=True)
            raise MercuryError("SEND_FAILED", f"Draft created but sending failed: {err.message}",
                               502, invoice_id=invoice_id, retryable=err.retryable)
        raise AssertionError("unreachable")

    async def get_invoice(self, invoice_id: str) -> dict:
        resp = await self._request("GET", f"/v2/invoicing/invoices/{invoice_id}")
        if resp.status_code == 404:
            raise MercuryError("NOT_FOUND", "Invoice not found.", 404)
        if resp.status_code != 200:
            raise self._error_from(resp)
        return resp.json()

    # ------------------------------------------------------------- results

    @staticmethod
    def _result_from_invoice(inv: dict, invoice_id: str, *, email: str | None = None,
                             total: str | None = None, currency: str | None = None) -> InvoiceResult:
        recipients = inv.get("primary_recipients") or [{}]
        detail = inv.get("detail", {})
        url = (detail.get("metadata") or {}).get("recipient_view_url") or fallback_view_url(invoice_id)
        return InvoiceResult(
            invoice_id=invoice_id,
            invoice_url=url,
            status=inv.get("status", "SENT"),
            client_email=(recipients[0].get("billing_info") or {}).get("email_address") or email or "",
            total=(inv.get("amount") or {}).get("value") or total or "0.00",
            currency=detail.get("currency_code") or currency or "USD",
        )

    async def _finalize(self, invoice_id: str, req: InvoiceRequest, payer_link: str | None) -> InvoiceResult:
        try:
            inv = await self.get_invoice(invoice_id)
        except MercuryError:
            # The invoice is already sent; do not fail the whole request over the read-back.
            return InvoiceResult(
                invoice_id=invoice_id,
                invoice_url=payer_link or fallback_view_url(invoice_id),
                status="SENT",
                client_email=str(req.client_email),
                total=f"{req.total:.2f}",
                currency=req.currency,
            )
        return self._result_from_invoice(inv, invoice_id, email=str(req.client_email),
                                         total=f"{req.total:.2f}", currency=req.currency)

    def _evict(self) -> None:
        cutoff = self._clock() - RESULT_TTL_S
        self._results = {k: v for k, v in self._results.items() if v[0] >= cutoff}
        self._drafts = {k: v for k, v in self._drafts.items() if v[0] >= cutoff}

    async def _run(self, req: InvoiceRequest) -> InvoiceResult:
        rid = req.request_id
        draft = self._drafts.get(rid)
        if draft:
            invoice_id = draft[1]  # a previous attempt created the draft; never create a second one
        else:
            invoice_id = await self.create_draft(req)
            self._drafts[rid] = (self._clock(), invoice_id)
        payer_link = await self.send_invoice(invoice_id)
        result = await self._finalize(invoice_id, req, payer_link)
        self._results[rid] = (self._clock(), result)
        return result

    async def create_and_send(self, req: InvoiceRequest) -> InvoiceResult:
        merchant = self._s.merchant_email
        if merchant and str(req.client_email).lower() == merchant:
            raise MercuryError(
                "SELF_INVOICE",
                "That is your own business account. Use a different recipient.",
                422,
            )
        self._evict()
        hit = self._results.get(req.request_id)
        if hit:
            return hit[1]
        task = self._inflight.get(req.request_id)
        if task is None:
            task = asyncio.ensure_future(self._run(req))
            self._inflight[req.request_id] = task
            task.add_done_callback(lambda _t, rid=req.request_id: self._inflight.pop(rid, None))
        # shield: a client disconnect must not cancel an invoice that is mid-flight
        return await asyncio.shield(task)

    async def resend(self, invoice_id: str) -> InvoiceResult:
        """Retry the send step for an existing draft (after SEND_FAILED)."""
        payer_link = await self.send_invoice(invoice_id)
        inv = await self.get_invoice(invoice_id)
        result = self._result_from_invoice(inv, invoice_id)
        if payer_link and not (inv.get("detail", {}).get("metadata") or {}).get("recipient_view_url"):
            result.invoice_url = payer_link
        return result

    async def status(self, invoice_id: str) -> InvoiceStatus:
        inv = await self.get_invoice(invoice_id)
        txns = (inv.get("payments") or {}).get("transactions") or []
        paid_at = txns[0].get("payment_date") if txns else None
        return InvoiceStatus(invoice_id=invoice_id, status=inv.get("status", "UNKNOWN"), paid_at=paid_at)
