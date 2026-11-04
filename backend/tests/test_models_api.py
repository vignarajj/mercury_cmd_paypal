"""Settings > AI model: list local models, switch at runtime, remember the choice."""
import dataclasses

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app
from app.services.prefs import Preferences

from .conftest import TOKEN

H = {"X-Mercury-Token": TOKEN}
OLLAMA = "http://localhost:11434"

TAGS = {"models": [
    {"name": "gemma4:e2b-it-qat", "size": 4_336_358_185, "capabilities": ["completion", "tools"], "details": {"parameter_size": "4.6B"}},
    {"name": "qwen3:4b", "size": 2_500_000_000, "capabilities": ["completion"], "details": {"parameter_size": "4B"}},
    {"name": "nomic-embed-text:latest", "size": 274_302_450, "capabilities": ["embedding"], "details": {}},
    {"name": "glm-5.2:cloud", "size": 290, "remote_host": "https://ollama.com", "capabilities": ["completion"], "details": {}},
]}


@pytest.fixture
def prefs(tmp_path):
    return Preferences(tmp_path / "prefs.json")


@pytest.fixture
def client(settings, prefs):
    s = dataclasses.replace(settings, llm_provider="ollama")
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{OLLAMA}/api/tags").respond(200, json=TAGS)
        router.post(f"{OLLAMA}/api/chat").respond(200, json={"message": {"content": "{}"}})
        with TestClient(create_app(s, prefs=prefs)) as c:
            yield c


def test_lists_only_local_chat_models(client):
    d = client.get("/api/models", headers=H).json()
    assert [m["name"] for m in d["models"]] == ["gemma4:e2b-it-qat", "qwen3:4b"]
    assert d["current"] == "gemma4:e2b-it-qat" and d["default"] == "gemma4:e2b-it-qat" and d["status"] == "ok"
    assert d["models"][0]["parameters"] == "4.6B"


def test_requires_the_token(client):
    assert client.get("/api/models").status_code == 401
    assert client.post("/api/model", json={"model": "qwen3:4b"}).status_code == 401


def test_switching_applies_immediately_and_is_remembered(client, prefs):
    r = client.post("/api/model", headers=H, json={"model": "qwen3:4b"})
    assert r.status_code == 200 and r.json()["current"] == "qwen3:4b"
    assert prefs.ollama_model == "qwen3:4b"
    assert client.get("/api/models", headers=H).json()["current"] == "qwen3:4b"


@pytest.mark.parametrize("name", ["glm-5.2:cloud", "nomic-embed-text:latest", "not-installed:1b"])
def test_rejects_cloud_embedding_and_missing_models(client, prefs, name):
    r = client.post("/api/model", headers=H, json={"model": name})
    assert r.status_code == 422 and r.json()["error"]["code"] == "MODEL_NOT_INSTALLED"
    assert prefs.ollama_model is None


def test_saved_choice_wins_over_the_env_default(settings, prefs):
    prefs.set_ollama_model("qwen3:4b")
    s = dataclasses.replace(settings, llm_provider="ollama")
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{OLLAMA}/api/tags").respond(200, json=TAGS)
        router.post(f"{OLLAMA}/api/chat").respond(200, json={"message": {"content": "{}"}})
        with TestClient(create_app(s, prefs=prefs)) as c:
            assert c.get("/api/models", headers=H).json()["current"] == "qwen3:4b"


def test_offline_ollama_is_reported_and_blocks_switching(settings, prefs):
    s = dataclasses.replace(settings, llm_provider="ollama")
    with respx.mock(assert_all_called=False) as router:
        router.get(f"{OLLAMA}/api/tags").mock(side_effect=httpx.ConnectError("down"))
        router.post(f"{OLLAMA}/api/chat").mock(side_effect=httpx.ConnectError("down"))
        with TestClient(create_app(s, prefs=prefs)) as c:
            d = c.get("/api/models", headers=H).json()
            assert d["status"] == "offline" and d["models"] == []
            r = c.post("/api/model", headers=H, json={"model": "qwen3:4b"})
            assert r.status_code == 503 and r.json()["error"]["code"] == "LLM_OFFLINE"


def test_disabled_provider(settings, prefs):
    with TestClient(create_app(settings, prefs=prefs)) as c:
        assert c.get("/api/models", headers=H).json()["status"] == "disabled"
        r = c.post("/api/model", headers=H, json={"model": "x"})
        assert r.status_code == 409 and r.json()["error"]["code"] == "LLM_DISABLED"


def test_a_corrupt_prefs_file_is_ignored(tmp_path):
    p = tmp_path / "prefs.json"
    p.write_text("{not json")
    assert Preferences(p).ollama_model is None
