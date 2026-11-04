import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.config import ConfigError, Settings
from app.main import create_app

from .conftest import BASE, INVOICE_ID, TOKEN, invoice_json, token_json

H = {"X-Mercury-Token": TOKEN}
BODY = {
    "client_email": "buyer@personal.example.com",
    "items": [{"name": "Brand refresh", "quantity": 1, "unit_amount": "1200.00"}],
    "currency": "USD",
    "due_days": 15,
    "request_id": "req-api-0001",
}


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_sandbox_guard_rejects_live_host():
    with pytest.raises(ConfigError):
        Settings("i", "s", "https://api-m.paypal.com", "m@x.com", "t")


def test_website_url_is_rejected_as_api_base():
    """Regression: https://sandbox.paypal.com (the website) makes invoicing calls 301."""
    with pytest.raises(ConfigError, match="REST API host"):
        Settings("i", "s", "https://sandbox.paypal.com", "m@x.com", "t")
    Settings("i", "s", "https://api-m.sandbox.paypal.com", "m@x.com", "t")  # the correct host loads
    Settings("i", "s", "https://api.sandbox.paypal.com", "m@x.com", "t")


def test_unexpected_errors_use_the_error_shape_not_a_stack_trace(settings, monkeypatch):
    from app.services.paypal_service import PayPalService

    async def boom(self, req):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(PayPalService, "create_and_send", boom)
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        r = c.post("/api/invoice", json=BODY, headers=H)
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL"
    assert "secret internal detail" not in r.text


def test_missing_or_wrong_token_is_401(client):
    assert client.post("/api/invoice", json=BODY).status_code == 401
    r = client.post("/api/invoice", json=BODY, headers={"X-Mercury-Token": "nope"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_invalid_input_returns_spec_error_shape(client):
    r = client.post("/api/invoice", json={**BODY, "client_email": "not-an-email"}, headers=H)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "INVALID_INPUT"
    assert "client_email" in err["fields"]


def test_invalid_amount_and_currency(client):
    bad_amount = {**BODY, "items": [{"name": "x", "quantity": 1, "unit_amount": "-1"}]}
    assert client.post("/api/invoice", json=bad_amount, headers=H).json()["error"]["code"] == "INVALID_INPUT"
    assert client.post("/api/invoice", json={**BODY, "currency": "JPY"}, headers=H).status_code == 422


def test_invoice_id_path_is_validated(client):
    r = client.get("/api/invoice/..%2Fevil", headers=H)
    assert r.status_code in (404, 422)
    assert client.get("/api/invoice/x", headers=H).json()["error"]["code"] == "INVALID_INPUT"


@respx.mock
def test_create_invoice_end_to_end(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.post(f"{BASE}/v2/invoicing/invoices").respond(201, json={"href": f".../invoices/{INVOICE_ID}"})
    respx.post(f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}/send").respond(200, json={"href": "x"})
    respx.get(f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}").respond(200, json=invoice_json())
    r = client.post("/api/invoice", json=BODY, headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["invoice_id"] == INVOICE_ID
    assert r.json()["status"] == "SENT"


@respx.mock
def test_self_invoice_returns_422(client):
    r = client.post("/api/invoice", json={**BODY, "client_email": "merchant@business.example.com"}, headers=H)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "SELF_INVOICE"
    assert not respx.calls


@respx.mock
def test_send_failed_response_includes_invoice_id(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.post(f"{BASE}/v2/invoicing/invoices").respond(201, json={"href": f".../invoices/{INVOICE_ID}"})
    respx.post(f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}/send").respond(500)
    r = client.post("/api/invoice", json=BODY, headers=H)
    assert r.status_code == 502
    assert r.json()["error"] == {
        "code": "SEND_FAILED",
        "message": "Draft created but sending failed: PayPal is having trouble (500). Try again.",
        "retryable": True,
        "invoice_id": INVOICE_ID,
    }


@respx.mock
def test_status_endpoint(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    respx.get(f"{BASE}/v2/invoicing/invoices/{INVOICE_ID}").respond(200, json=invoice_json(status="PAID"))
    r = client.get(f"/api/invoice/{INVOICE_ID}", headers=H)
    assert r.json() == {"invoice_id": INVOICE_ID, "status": "PAID", "paid_at": None}


@respx.mock
def test_health_is_open_and_reports_paypal_state(client):
    respx.post(f"{BASE}/v1/oauth2/token").respond(200, json=token_json())
    assert client.get("/api/health").json()["paypal"] == "ok"


def test_cors_allows_tauri_and_local_dev_but_not_others(client):
    def preflight(origin):
        return client.options("/api/invoice", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-mercury-token"})
    for ok in ("tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:5173"):
        assert preflight(ok).headers.get("access-control-allow-origin") == ok
    assert "access-control-allow-origin" not in preflight("https://evil.example").headers
