import asyncio
import datetime as dt
import json

import httpx
import pytest
import respx

from app.errors import MercuryError
from app.services.paypal_service import (
    fallback_view_url,
    invoice_id_from_href,
    payment_term,
)

from .conftest import BASE, INVOICE_ID, invoice_json, make_request, token_json

CREATE = f"{BASE}/v2/invoicing/invoices"
SEND = f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}/send"
GET = f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}"
TOKEN_URL = f"{BASE}/v1/oauth2/token"
LINK = {"rel": "self", "href": f"https://api.sandbox.paypal.com/v2/invoicing/invoices/{INVOICE_ID}", "method": "GET"}
PAYER = {"rel": "payer-view", "href": "https://www.sandbox.paypal.com/invoice/p/#INV2-AAAA-BBBB-CCCC-DDDD", "method": "GET"}


def mock_happy(mock: respx.MockRouter):
    token = mock.post(TOKEN_URL).respond(200, json=token_json())
    create = mock.post(CREATE).respond(201, json=LINK)
    send = mock.post(SEND).respond(200, json=PAYER)
    get = mock.get(GET).respond(200, json=invoice_json())
    return token, create, send, get


# ------------------------------------------------------------ pure helpers

def test_payment_term_mapping():
    today = dt.date(2026, 11, 3)
    assert payment_term(None, today) is None
    assert payment_term(0, today) == {"term_type": "DUE_ON_RECEIPT"}
    assert payment_term(15, today) == {"term_type": "NET_15"}
    assert payment_term(30, today) == {"term_type": "NET_30"}
    assert payment_term(20, today) == {"term_type": "DUE_ON_DATE_SPECIFIED", "due_date": "2026-11-23"}


def test_invoice_id_and_view_url_helpers():
    assert invoice_id_from_href(LINK["href"]) == INVOICE_ID
    assert fallback_view_url("INV2-AAAA-BBBB-CCCC-DDDD") == "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD"


def test_money_never_uses_float_rounding():
    req = make_request(items=[{"name": "x", "quantity": 3, "unit_amount": "0.1"}, {"name": "y", "quantity": 1, "unit_amount": 19.999}])
    assert [i.unit_amount.as_tuple().exponent for i in req.items] == [-2, -2]
    assert str(req.total) == "20.30"


@pytest.mark.parametrize("bad", ["0", "-5", "abc", "1000000.01"])
def test_rejects_bad_amounts(bad):
    with pytest.raises(ValueError):
        make_request(items=[{"name": "x", "quantity": 1, "unit_amount": bad}])


def test_rejects_unsupported_currency_and_too_many_items():
    with pytest.raises(ValueError):
        make_request(currency="JPY")
    with pytest.raises(ValueError):
        make_request(items=[{"name": f"i{n}", "quantity": 1, "unit_amount": "1"} for n in range(11)])


# ------------------------------------------------------------------ token

@respx.mock
async def test_token_is_cached_until_near_expiry(service, clock):
    token = respx.post(TOKEN_URL).respond(200, json=token_json(expires_in=300))
    await service.get_token()
    await service.get_token()
    assert token.call_count == 1
    clock.now += 241  # inside the 60 s safety margin of a 300 s token
    await service.get_token()
    assert token.call_count == 2


@respx.mock
async def test_concurrent_token_requests_refresh_once(service):
    token = respx.post(TOKEN_URL).respond(200, json=token_json())
    await asyncio.gather(*(service.get_token() for _ in range(5)))
    assert token.call_count == 1


@respx.mock
async def test_bad_credentials_map_to_paypal_auth(service):
    respx.post(TOKEN_URL).respond(401, json={"error": "invalid_client"})
    with pytest.raises(MercuryError) as e:
        await service.get_token()
    assert e.value.code == "PAYPAL_AUTH"


# A8: expired/rejected token mid-session is refreshed once and the call succeeds
@respx.mock
async def test_401_triggers_one_refresh_and_retry(service):
    tokens = iter(["old-token", "new-token"])
    respx.post(TOKEN_URL).mock(side_effect=lambda r: httpx.Response(200, json={"access_token": next(tokens), "expires_in": 32400}))
    seen = []

    def create(request: httpx.Request):
        seen.append(request.headers["authorization"])
        return httpx.Response(401) if len(seen) == 1 else httpx.Response(201, json=LINK)

    respx.post(CREATE).mock(side_effect=create)
    assert await service.create_draft(make_request()) == INVOICE_ID
    assert seen == ["Bearer old-token", "Bearer new-token"]


# --------------------------------------------------------------- pipeline

@respx.mock
async def test_happy_path_and_payload(service):
    _, create, send, get = mock_happy(respx)
    result = await service.create_and_send(make_request(note="Thanks!"))

    assert result.model_dump() == {
        "invoice_id": INVOICE_ID,
        "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD",
        "status": "SENT",
        "client_email": "buyer@personal.example.com",
        "total": "1200.00",
        "currency": "USD",
    }
    payload = json.loads(create.calls.last.request.content)
    assert payload["detail"] == {
        "currency_code": "USD",
        "note": "Thanks!",
        "payment_term": {"term_type": "NET_15"},
    }
    assert payload["items"] == [
        {"name": "Brand refresh", "quantity": "1", "unit_amount": {"currency_code": "USD", "value": "1200.00"}}
    ]
    assert create.calls.last.request.headers["paypal-request-id"] == "req-0001-aaaa"
    assert json.loads(send.calls.last.request.content) == {"send_to_recipient": True, "send_to_invoicer": True}


@respx.mock
async def test_create_parses_id_from_href_or_id_field(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).respond(201, json={"id": "INV2-FROM-ID-FIELD"})
    assert await service.create_draft(make_request()) == "INV2-FROM-ID-FIELD"


# A4: duplicate submits create exactly one invoice
@respx.mock
async def test_sequential_duplicate_request_id_creates_one_invoice(service):
    _, create, send, _ = mock_happy(respx)
    first = await service.create_and_send(make_request())
    second = await service.create_and_send(make_request())
    assert first == second
    assert create.call_count == 1 and send.call_count == 1


@respx.mock
async def test_concurrent_duplicate_request_id_creates_one_invoice(service):
    _, create, send, _ = mock_happy(respx)
    results = await asyncio.gather(*(service.create_and_send(make_request()) for _ in range(4)))
    assert len({r.invoice_id for r in results}) == 1
    assert create.call_count == 1 and send.call_count == 1


@respx.mock
async def test_distinct_request_ids_create_distinct_invoices(service):
    _, create, _, _ = mock_happy(respx)
    await service.create_and_send(make_request(request_id="req-0001-aaaa"))
    await service.create_and_send(make_request(request_id="req-0002-bbbb"))
    assert create.call_count == 2


# A6: self-invoice is blocked before any PayPal call
@respx.mock
async def test_self_invoice_blocked_without_calling_paypal(service):
    with pytest.raises(MercuryError) as e:
        await service.create_and_send(make_request(client_email="Merchant@Business.example.com"))
    assert e.value.code == "SELF_INVOICE" and e.value.http_status == 422
    assert not respx.calls


# A7: send fails after the draft exists -> SEND_FAILED with the id; retry sends only
@respx.mock
async def test_send_failure_keeps_draft_and_retry_does_not_recreate(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    create = respx.post(CREATE).respond(201, json=LINK)
    send = respx.post(SEND).mock(side_effect=[
        httpx.Response(500, json={"name": "INTERNAL_SERVER_ERROR"}),
        httpx.Response(200, json=PAYER),
    ])
    respx.get(GET).respond(200, json=invoice_json())

    with pytest.raises(MercuryError) as e:
        await service.create_and_send(make_request())
    assert e.value.code == "SEND_FAILED"
    assert e.value.invoice_id == INVOICE_ID
    assert e.value.retryable is True

    result = await service.create_and_send(make_request())  # same request_id
    assert result.status == "SENT"
    assert create.call_count == 1
    assert send.call_count == 2


@respx.mock
async def test_send_rejection_surfaces_paypal_details_not_top_level_name(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).respond(201, json=LINK)
    respx.post(SEND).respond(406, json={
        "name": "MEDIA_TYPE_NOT_ACCEPTABLE",
        "message": "The server does not implement the media type that would be acceptable to the client.",
        "details": [{"issue": "INR_FOREIGN_CURRENCY_BLOCKED", "description": "We're unable to send invoices to customers within India."}],
    })
    with pytest.raises(MercuryError) as e:
        await service.create_and_send(make_request())
    assert e.value.code == "SEND_FAILED"
    assert "within India" in e.value.message
    assert "media type" not in e.value.message
    assert e.value.invoice_id == INVOICE_ID
    assert e.value.retryable is False


# verified quirk: /send can 404 with an empty body right after create
@respx.mock
async def test_send_retries_on_404_with_backoff(service, sleeps):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    send = respx.post(SEND).mock(side_effect=[httpx.Response(404), httpx.Response(404), httpx.Response(200, json=PAYER)])
    assert await service.send_invoice(INVOICE_ID) == PAYER["href"]
    assert send.call_count == 3
    assert sleeps == [1.0, 2.0]


@respx.mock
async def test_send_gives_up_after_repeated_404(service, sleeps):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(SEND).respond(404)
    with pytest.raises(MercuryError) as e:
        await service.send_invoice(INVOICE_ID)
    assert e.value.code == "SEND_FAILED" and e.value.retryable is True
    assert sleeps == [1.0, 2.0, 3.0]


@respx.mock
async def test_create_rejection_maps_to_paypal_rejected_422(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).respond(422, json={"details": [{"issue": "INVALID_PARAMETER_VALUE", "description": "Email is invalid."}]})
    with pytest.raises(MercuryError) as e:
        await service.create_draft(make_request())
    assert (e.value.code, e.value.http_status, e.value.message) == ("PAYPAL_REJECTED", 422, "Email is invalid.")


@respx.mock
async def test_403_maps_to_paypal_auth(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).respond(403, json={"name": "NOT_AUTHORIZED", "message": "Authorization failed due to insufficient permissions."})
    with pytest.raises(MercuryError) as e:
        await service.create_draft(make_request())
    assert e.value.code == "PAYPAL_AUTH"


@respx.mock
async def test_timeout_maps_to_upstream_timeout(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(MercuryError) as e:
        await service.create_draft(make_request())
    assert (e.value.code, e.value.http_status, e.value.retryable) == ("UPSTREAM_TIMEOUT", 504, True)


@respx.mock
async def test_readback_failure_still_returns_success(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    respx.post(CREATE).respond(201, json=LINK)
    respx.post(SEND).respond(200, json=PAYER)
    respx.get(GET).respond(500)
    result = await service.create_and_send(make_request())
    assert result.status == "SENT"
    assert result.invoice_url == PAYER["href"]
    assert result.total == "1200.00"


@respx.mock
async def test_status_reports_paid(service):
    respx.post(TOKEN_URL).respond(200, json=token_json())
    inv = invoice_json(status="PAID")
    inv["payments"] = {"transactions": [{"payment_date": "2026-11-04T10:00:00Z"}]}
    respx.get(GET).respond(200, json=inv)
    st = await service.status(INVOICE_ID)
    assert (st.status, st.paid_at) == ("PAID", "2026-11-04T10:00:00Z")


def test_payload_never_sends_invoice_date(service):
    """Regression: a local-calendar date ahead of the US made PayPal mark the invoice SCHEDULED, not SENT."""
    assert "invoice_date" not in service.build_draft_payload(make_request())["detail"]
