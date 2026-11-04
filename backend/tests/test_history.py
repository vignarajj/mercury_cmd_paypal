import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app

from .conftest import BASE, INVOICE_ID, TOKEN, token_json

H = {"X-Mercury-Token": TOKEN}
SEARCH = f"{BASE}/v2/invoicing/search-invoices"
GET = f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}"


def inv(i: int, status: str = "SENT", email: str = "a@b.co", created: str | None = None, total: str = "10.00") -> dict:
    return {
        "id": f"INV2-AAAA-BBBB-CCCC-{i:04d}",
        "status": status,
        "amount": {"currency_code": "USD", "value": total},
        "primary_recipients": [{"billing_info": {"email_address": email}}],
        "detail": {"invoice_number": f"{i:04d}", "currency_code": "USD",
                   "metadata": {"create_time": created or f"2026-11-0{i}T10:00:00Z"}},
    }


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


@respx.mock
def test_list_maps_sorts_and_paginates(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    route = respx.post(SEARCH).respond(200, json={"total_items": 7, "total_pages": 2, "items": [inv(1), inv(3, "PAID", "z@y.io"), inv(2)]})
    r = client.get("/api/invoices?page=1&page_size=3", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert [i["number"] for i in body["items"]] == ["0003", "0002", "0001"]  # newest first
    assert body["items"][0] == {
        "invoice_id": "INV2-AAAA-BBBB-CCCC-0003", "number": "0003", "status": "PAID", "client_email": "z@y.io",
        "total": "10.00", "currency": "USD", "created_at": "2026-11-03T10:00:00Z",
        "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCC0003",
    }
    assert (body["total_items"], body["total_pages"], body["page"]) == (7, 2, 1)
    assert "page=1&page_size=3&total_required=true" in str(route.calls.last.request.url)


@respx.mock
def test_list_passes_status_filters_and_email_search(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    route = respx.post(SEARCH).respond(200, json={"total_items": 0, "total_pages": 1, "items": []})
    client.get("/api/invoices?status=PAID&status=MARKED_AS_PAID&q=sarah@acme.co", headers=H)
    assert json.loads(route.calls.last.request.content) == {"status": ["PAID", "MARKED_AS_PAID"], "recipient_email": "sarah@acme.co"}


@respx.mock
def test_list_text_search_filters_the_page_by_email_or_number(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    route = respx.post(SEARCH).respond(200, json={"total_items": 3, "total_pages": 1,
                                                  "items": [inv(1, email="acme@x.io"), inv(2, email="other@y.io"), inv(3, email="b@z.io")]})
    r = client.get("/api/invoices?q=acme", headers=H)
    assert [i["client_email"] for i in r.json()["items"]] == ["acme@x.io"]
    assert json.loads(route.calls.last.request.content) == {}  # not an email: filtered locally
    assert [i["number"] for i in client.get("/api/invoices?q=0002", headers=H).json()["items"]] == ["0002"]


def test_list_validates_status_and_requires_token(client):
    assert client.get("/api/invoices").status_code == 401
    r = client.get("/api/invoices?status=BOGUS", headers=H)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_INPUT"
    assert client.get("/api/invoices?page=0", headers=H).status_code == 422
    assert client.get("/api/invoices?page_size=1000", headers=H).status_code == 422


@respx.mock
def test_list_surfaces_paypal_errors(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.post(SEARCH).respond(403, json={"name": "NOT_AUTHORIZED", "message": "nope"})
    r = client.get("/api/invoices", headers=H)
    assert r.status_code == 502 and r.json()["error"]["code"] == "PAYPAL_AUTH"


FULL = {
    "id": INVOICE_ID, "status": "PAID",
    "detail": {
        "invoice_number": "0008", "currency_code": "USD", "invoice_date": "2026-11-03", "note": "Thanks!",
        "payment_term": {"term_type": "NET_15", "due_date": "2026-11-18"},
        "metadata": {"create_time": "2026-11-03T09:00:00Z", "first_sent_time": "2026-11-03T09:00:05Z",
                     "recipient_view_url": "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD"},
    },
    "primary_recipients": [{"billing_info": {"email_address": "buyer@personal.example.com"}}],
    "items": [{"name": "Brand refresh", "quantity": "1", "unit_amount": {"currency_code": "USD", "value": "1200.00"}},
              {"name": "Hours", "quantity": "3", "unit_amount": {"currency_code": "USD", "value": "100.00"}}],
    "amount": {"currency_code": "USD", "value": "1500.00"},
    "due_amount": {"currency_code": "USD", "value": "0.00"},
    "payments": {"paid_amount": {"currency_code": "USD", "value": "1500.00"},
                 "transactions": [{"payment_id": "4WP26", "payment_date_time": "2026-11-03T23:57:07Z", "method": "PAYPAL",
                                   "amount": {"currency_code": "USD", "value": "1500.00"}, "transaction_status": "SUCCESS"}]},
}


@respx.mock
def test_detail_maps_items_dates_and_payments(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.get(GET).respond(200, json=FULL)
    r = client.get(f"/api/invoice/{INVOICE_ID}/detail", headers=H)
    assert r.status_code == 200
    d = r.json()
    assert d["items"] == [
        {"name": "Brand refresh", "quantity": "1", "unit_amount": "1200.00", "amount": "1200.00"},
        {"name": "Hours", "quantity": "3", "unit_amount": "100.00", "amount": "300.00"},
    ]
    assert (d["number"], d["status"], d["total"], d["paid_amount"], d["due_amount"]) == ("0008", "PAID", "1500.00", "1500.00", "0.00")
    assert (d["invoice_date"], d["sent_at"], d["due_date"], d["payment_term"], d["note"]) == (
        "2026-11-03", "2026-11-03T09:00:05Z", "2026-11-18", "NET_15", "Thanks!")
    assert d["payments"] == [{"payment_id": "4WP26", "date": "2026-11-03T23:57:07Z", "method": "PAYPAL", "amount": "1500.00", "status": "SUCCESS"}]
    assert d["invoice_url"].endswith("#AAAABBBBCCCCDDDD") and d["invoice_id"] == INVOICE_ID


@respx.mock
def test_detail_handles_a_draft_with_no_payments_and_unknown_invoice(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.get(GET).respond(200, json={"id": INVOICE_ID, "status": "DRAFT", "detail": {"currency_code": "USD"},
                                      "primary_recipients": [{"billing_info": {"email_address": "a@b.co"}}], "amount": {"value": "5.00"}})
    d = client.get(f"/api/invoice/{INVOICE_ID}/detail", headers=H).json()
    assert d["payments"] == [] and d["items"] == [] and d["paid_amount"] == "0.00" and d["sent_at"] is None
    respx.get(f"{BASE}/v2/invoicing/invoices/INV2-NOPE-NOPE").respond(404)
    r = client.get("/api/invoice/INV2-NOPE-NOPE/detail", headers=H)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"


@respx.mock
def test_info_has_health_and_never_secrets(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    r = client.get("/api/info", headers=H)
    assert r.status_code == 200
    d = r.json()
    assert d["paypal"] == {"status": "ok", "error": None, "host": BASE, "mode": "sandbox", "merchant_email": "merchant@business.example.com"}
    assert d["llm"] == {"provider": "none", "model": None, "status": "disabled"}
    assert d["version"]
    text = r.text
    assert "client-secret" not in text and "client-id" not in text and TOKEN not in text
    assert client.get("/api/info").status_code == 401


@respx.mock
def test_info_reports_a_paypal_credential_problem(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(401, json={"error": "invalid_client"})
    d = client.get("/api/info", headers=H).json()
    assert d["paypal"]["status"] == "error" and "credentials" in d["paypal"]["error"]
