import datetime as dt

import httpx
import pytest

from app.config import Settings
from app.models import InvoiceRequest
from app.services.paypal_service import PayPalService

BASE = "https://api-m.sandbox.paypal.com"
MERCHANT = "merchant@business.example.com"
TOKEN = "test-mercury-token"
INVOICE_ID = "INV2-AAAA-BBBB-CCCC-DDDD"


@pytest.fixture
def settings() -> Settings:
    return Settings(
        paypal_client_id="client-id",
        paypal_client_secret="client-secret",
        paypal_api_base=BASE,
        merchant_email=MERCHANT,
        mercury_token=TOKEN,
        llm_provider="none",  # tests never touch a real Ollama
    )


class FakeClock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def sleeps() -> list[float]:
    return []


@pytest.fixture
async def service(settings, clock, sleeps):
    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async with httpx.AsyncClient(timeout=5) as client:
        yield PayPalService(settings, client, sleep=fake_sleep, today=lambda: dt.date(2026, 11, 3), clock=clock)


def make_request(**overrides) -> InvoiceRequest:
    data = {
        "client_email": "buyer@personal.example.com",
        "items": [{"name": "Brand refresh", "quantity": 1, "unit_amount": "1200"}],
        "currency": "USD",
        "due_days": 15,
        "note": None,
        "request_id": "req-0001-aaaa",
    }
    data.update(overrides)
    return InvoiceRequest(**data)


def token_json(expires_in: int = 32400) -> dict:
    return {"access_token": "tok-123", "token_type": "Bearer", "expires_in": expires_in}


def invoice_json(status: str = "SENT", total: str = "1200.00") -> dict:
    return {
        "id": INVOICE_ID,
        "status": status,
        "detail": {
            "currency_code": "USD",
            "metadata": {"recipient_view_url": "https://www.sandbox.paypal.com/invoice/p/#AAAABBBBCCCCDDDD"},
        },
        "primary_recipients": [{"billing_info": {"email_address": "buyer@personal.example.com"}}],
        "amount": {"currency_code": "USD", "value": total},
    }
