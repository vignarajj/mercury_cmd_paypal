import json
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services.ai_service import LLMUnavailable, OllamaClient, ParseService
from app.services.grounding import ground, numbers_in_text
from app.services.regex_parser import parse_regex

from .conftest import BASE, MERCHANT, TOKEN

CASES = json.loads((Path(__file__).parent / "parse_cases.json").read_text())
REGEX_CASES = [c for c in CASES if c["regex"]]
OLLAMA = "http://localhost:11434"


def summarize(r):
    return {
        "email": r.client_email,
        "currency": r.currency,
        "due_days": r.due_days,
        "items": [[i.name.lower(), i.unit_amount] + ([i.quantity] if i.quantity != 1 else []) for i in r.items],
        "missing": r.missing_fields,
    }


def test_corpus_has_at_least_25_cases():
    assert len(CASES) >= 25


# A2 / A3: the regex path must pass every regex-capable case exactly
@pytest.mark.parametrize("case", REGEX_CASES, ids=lambda c: c["id"])
def test_regex_path_matches_corpus(case):
    result = ground(parse_regex(case["text"]), case["text"], "regex")
    assert summarize(result) == case["expect"], case["text"]


# an ideal model answer for every case must survive grounding unchanged
@pytest.mark.parametrize("case", [c for c in CASES if c["expect"]["items"]], ids=lambda c: c["id"])
def test_ideal_llm_output_passes_grounding(case):
    exp = case["expect"]
    raw = case.get("mock_llm") or {
        "client_email": exp["email"],
        "currency": exp["currency"],
        "due_days": exp["due_days"],
        "items": [{"name": n, "quantity": 1, "unit_amount": a} for n, a, *_ in exp["items"]],
    }
    assert summarize(ground(raw, case["text"], "llm")) == exp


def test_regex_multi_amount_uses_first_and_warns():
    text = "Bill sarah@acme.co $1,200 for brand refresh and $300 for icons, net 15"
    r = ground(parse_regex(text), text, "regex")
    assert [i.unit_amount for i in r.items] == ["1200.00"]
    assert any("Several amounts" in w for w in r.warnings)


# ------------------------------------------------------------ grounding

def test_hallucinated_email_is_dropped():
    raw = {"client_email": "ceo@bigcorp.com", "items": [{"name": "Logo", "unit_amount": "500.00"}]}
    r = ground(raw, "invoice $500 for logo", "llm")
    assert r.client_email is None and r.missing_fields == ["client_email"]
    assert any("not in your text" in w for w in r.warnings)


def test_no_email_in_input_never_yields_an_email():  # A3
    r = ground({"client_email": "made.up@example.com", "items": []}, "bill them $100 for design", "llm")
    assert r.client_email is None


def test_email_missed_by_model_is_filled_from_text():
    r = ground({"client_email": None, "items": [{"name": "Logo", "unit_amount": "500"}]}, "bill a@b.co $500 for logo", "llm")
    assert r.client_email == "a@b.co"


def test_invented_or_computed_amount_is_dropped():
    raw = {"client_email": "a@b.co", "items": [{"name": "Logo", "unit_amount": "999.00"}]}
    r = ground(raw, "bill a@b.co $500 for logo", "llm")
    assert r.items == [] and r.missing_fields == ["items"] and r.is_complete is False
    assert any("not in your text" in w for w in r.warnings)


def test_quantity_must_be_in_text():
    raw = {"client_email": "a@b.co", "items": [{"name": "Logo", "quantity": 7, "unit_amount": "500"}]}
    r = ground(raw, "bill a@b.co $500 for logo", "llm")
    assert r.items[0].quantity == 1


def test_model_completeness_flags_are_ignored():
    raw = {"client_email": None, "items": [], "is_complete": True, "missing_fields": []}
    r = ground(raw, "hello", "llm")
    assert r.is_complete is False and r.missing_fields == ["client_email", "items"]


def test_due_days_needs_support_in_text():
    assert ground({"due_days": 30, "items": []}, "bill a@b.co $5 for x", "llm").due_days is None
    assert ground({"due_days": None, "items": []}, "bill a@b.co $5 for x net 45", "llm").due_days == 45


def test_text_currency_beats_model_currency():
    assert ground({"currency": "USD", "items": []}, "bill a@b.co €5 for x", "llm").currency == "EUR"
    assert ground({"currency": "XYZ", "items": []}, "bill a@b.co 5 for x", "llm").currency == "USD"


def test_note_only_when_user_asked_for_one():
    assert ground({"note": "Thanks!", "items": []}, "bill a@b.co $5 for x", "llm").note is None
    assert ground({"note": "Thanks!", "items": []}, "bill a@b.co $5 for x, note: Thanks!", "llm").note == "Thanks!"


def test_numbers_in_text_ignores_digits_inside_emails_and_expands_k():
    nums = {str(n) for n in numbers_in_text("bill client2@corp.com 1.5k for sprint 2")}
    assert "1500.00" in nums and "2.00" in nums
    assert "client2" not in nums


# ------------------------------------------------------- Ollama / fallback

@pytest.fixture
def ollama_settings():
    return Settings("i", "s", BASE, MERCHANT, TOKEN, llm_provider="ollama", llm_timeout_s=2.0)


def chat_reply(obj) -> httpx.Response:
    return httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps(obj)}})


@respx.mock
async def test_llm_path_used_when_available(ollama_settings):
    case = next(c for c in CASES if c["id"] == "m01")
    route = respx.post(f"{OLLAMA}/api/chat").mock(return_value=chat_reply(case["mock_llm"]))
    async with httpx.AsyncClient() as http:
        r = await ParseService(OllamaClient(ollama_settings, http)).parse(case["text"])
    assert r.source == "llm" and summarize(r) == case["expect"]
    sent = json.loads(route.calls.last.request.content)
    assert sent["options"] == {"temperature": 0} and sent["stream"] is False
    assert sent["format"]["properties"]["items"]["type"] == "array"  # structured-output schema is sent


@pytest.mark.parametrize("failure", [
    httpx.Response(500),
    httpx.Response(200, json={"message": {"content": "not json at all"}}),
    httpx.Response(200, json={"unexpected": True}),
    httpx.Response(200, json={"message": {"content": "[1, 2]"}}),
])
@respx.mock
async def test_bad_llm_answers_fall_back_to_regex(ollama_settings, failure):  # A5
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=failure)
    async with httpx.AsyncClient() as http:
        r = await ParseService(OllamaClient(ollama_settings, http)).parse("bill a@b.co $500 for logo design")
    assert r.source == "regex" and r.is_complete
    assert "Basic mode: single item only." in r.warnings


@respx.mock
async def test_ollama_down_or_timeout_falls_back_to_regex(ollama_settings):  # A5
    respx.post(f"{OLLAMA}/api/chat").mock(side_effect=httpx.ConnectError("refused"))
    async with httpx.AsyncClient() as http:
        r = await ParseService(OllamaClient(ollama_settings, http)).parse("bill a@b.co $500 for logo design")
    assert r.source == "regex"


async def test_slow_llm_hits_wall_clock_timeout(ollama_settings):
    import asyncio

    class Slow:
        async def post(self, *a, **k):
            await asyncio.sleep(5)

    s = Settings("i", "s", BASE, MERCHANT, TOKEN, llm_provider="ollama", llm_timeout_s=0.05)
    with pytest.raises(LLMUnavailable):
        await OllamaClient(s, Slow()).extract("anything")  # type: ignore[arg-type]


@respx.mock
async def test_empty_llm_items_are_filled_by_regex(ollama_settings):
    respx.post(f"{OLLAMA}/api/chat").mock(return_value=chat_reply({"client_email": "a@b.co", "items": []}))
    async with httpx.AsyncClient() as http:
        r = await ParseService(OllamaClient(ollama_settings, http)).parse("bill a@b.co $500 for logo design")
    assert r.source == "regex" and r.is_complete and r.items[0].unit_amount == "500.00"
    assert any("basic parser" in w for w in r.warnings)


def test_llm_schema_is_flat_and_fully_required():
    """Regression: a $ref/optional schema made local models drop `items` entirely."""
    from app.services.ai_service import LLM_SCHEMA
    text = json.dumps(LLM_SCHEMA)
    assert "$ref" not in text and "$defs" not in text
    assert set(LLM_SCHEMA["required"]) == set(LLM_SCHEMA["properties"])
    item = LLM_SCHEMA["properties"]["items"]["items"]
    assert set(item["required"]) == set(item["properties"])


@respx.mock
async def test_ollama_health_states(ollama_settings):
    async with httpx.AsyncClient() as http:
        client = OllamaClient(ollama_settings, http)
        respx.get(f"{OLLAMA}/api/tags").respond(200, json={"models": [{"name": ollama_settings.ollama_model}]})
        assert await client.health() == "ok"
        respx.get(f"{OLLAMA}/api/tags").respond(200, json={"models": [{"name": "other:1b"}]})
        assert await client.health() == "model_missing"
        respx.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("down"))
        assert await client.health() == "offline"


# ----------------------------------------------------------------- API

@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        yield c


def test_parse_endpoint_regex_mode(client):
    r = client.post("/api/parse", json={"text": "Bill client@corp.com $750 for Frontend React Development"},
                    headers={"X-Mercury-Token": TOKEN})
    assert r.status_code == 200
    body = r.json()
    assert body["client_email"] == "client@corp.com" and body["is_complete"] is True
    assert body["items"] == [{"name": "Frontend React Development", "quantity": 1, "unit_amount": "750.00"}]
    assert body["source"] == "regex"


def test_parse_endpoint_validates_and_requires_token(client):
    assert client.post("/api/parse", json={"text": "x"}).status_code == 401
    r = client.post("/api/parse", json={"text": "   "}, headers={"X-Mercury-Token": TOKEN})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_INPUT"


def test_health_reports_llm_disabled_in_regex_mode(client):
    with respx.mock:
        respx.post(f"{BASE}/v1/oauth2/token").respond(200, json={"access_token": "t", "expires_in": 100})
        assert client.get("/api/health").json() == {"paypal": "ok", "llm": "disabled", "mode": "regex"}


# the parse output must be directly submittable as an invoice request (the preview card round-trip)
@pytest.mark.parametrize("case", [c for c in CASES if c["expect"]["items"] and c["expect"]["email"]], ids=lambda c: c["id"])
def test_parsed_output_is_a_valid_invoice_request(case):
    from app.models import InvoiceRequest
    exp = case["expect"]
    raw = case.get("mock_llm") or {"client_email": exp["email"], "currency": exp["currency"], "due_days": exp["due_days"],
                                   "items": [{"name": n, "quantity": 1, "unit_amount": a} for n, a, *_ in exp["items"]]}
    p = ground(raw, case["text"], "llm")
    req = InvoiceRequest(client_email=p.client_email, items=[i.model_dump() for i in p.items], currency=p.currency,
                         due_days=p.due_days, note=p.note, request_id="req-roundtrip-1")
    assert str(req.total) == f"{sum(float(i.unit_amount) * i.quantity for i in p.items):.2f}"
