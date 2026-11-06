"""A new /api/parse request cancels the one still running, so half-typed sentences never queue up in front of the real one."""
import asyncio

import httpx
import pytest

from app.config import Settings
from app.main import create_app
from app.services.ai_service import ParseService

TOKEN = "test-mercury-token"
HEADERS = {"X-Mercury-Token": TOKEN}


class SlowParser:
    """Stands in for the model: takes a while for sentences starting with 'slow', answers at once otherwise."""

    def __init__(self) -> None:
        self.cancelled: list[str] = []
        self.completed: list[str] = []
        self._real = ParseService(None)

    async def parse(self, text: str):
        try:
            await asyncio.sleep(0.4 if text.startswith("slow") else 0)
        except asyncio.CancelledError:
            self.cancelled.append(text)
            raise
        self.completed.append(text)
        return await self._real.parse(text)


@pytest.fixture
def parser() -> SlowParser:
    return SlowParser()


@pytest.fixture
async def client(parser):
    settings = Settings(
        paypal_client_id="client-id", paypal_client_secret="client-secret",
        paypal_api_base="https://api-m.sandbox.paypal.com", merchant_email="merchant@business.example.com",
        mercury_token=TOKEN, llm_provider="none",
    )
    app = create_app(settings)
    app.state.settings = settings
    app.state.parser = parser  # the ASGI transport does not run the lifespan, so wire the state by hand
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


def read(client: httpx.AsyncClient, text: str):
    return client.post("/api/parse", json={"text": text}, headers=HEADERS)


async def test_a_newer_read_cancels_the_one_still_running(client, parser):
    older = asyncio.create_task(read(client, "slow bill a@b.co $5"))
    await asyncio.sleep(0.05)
    newer = await read(client, "Bill a@b.co $5 for logo design")

    assert newer.status_code == 200
    older_resp = await older
    assert older_resp.status_code == 409
    assert older_resp.json()["error"]["code"] == "PARSE_SUPERSEDED"
    assert parser.cancelled == ["slow bill a@b.co $5"]
    assert parser.completed == ["Bill a@b.co $5 for logo design"]


async def test_a_burst_of_reads_runs_only_the_last_one(client, parser):
    tasks = []
    for i in range(10):
        tasks.append(asyncio.create_task(read(client, f"slow bill a@b.co ${i + 1}")))
        await asyncio.sleep(0.02)
    last = await read(client, "Bill a@b.co $99 for the final design")
    results = await asyncio.gather(*tasks)

    assert last.status_code == 200
    assert [r.status_code for r in results] == [409] * 10
    assert parser.completed == ["Bill a@b.co $99 for the final design"]  # nothing else ran to the end


async def test_reads_one_after_another_are_unaffected(client, parser):
    first = await read(client, "Bill a@b.co $5 for logo design")
    second = await read(client, "Bill c@d.co $7 for icons")
    assert first.status_code == second.status_code == 200
    assert parser.cancelled == []
    assert len(parser.completed) == 2
