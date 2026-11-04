#!/usr/bin/env python3
"""Acceptance test A2: run the parse corpus through the REAL Ollama model and the regex fallback.

    backend/.venv/bin/python scripts/eval_parser.py                      # uses OLLAMA_MODEL from backend/.env
    OLLAMA_MODEL=gemma4:e2b-it-qat backend/.venv/bin/python scripts/eval_parser.py

Prints per-case pass/fail for the LLM path and the regex path, plus latency. Local Ollama only.
"""
import asyncio
import json
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import httpx  # noqa: E402

from app.config import Settings, load_settings  # noqa: E402
from app.services.ai_service import OllamaClient, ParseService  # noqa: E402
from app.services.grounding import ground  # noqa: E402
from app.services.regex_parser import parse_regex  # noqa: E402

CASES = json.loads((ROOT / "backend" / "tests" / "parse_cases.json").read_text())


def summarize(r):
    return {
        "email": r.client_email,
        "currency": r.currency,
        "due_days": r.due_days,
        "items": [[i.name.lower(), i.unit_amount] + ([i.quantity] if i.quantity != 1 else []) for i in r.items],
        "missing": r.missing_fields,
    }


def item_match(got, exp):
    """Names from a model are free text, so compare amounts/quantity exactly and names loosely."""
    if len(got) != len(exp):
        return False
    for g, e in zip(got, exp):
        if g[1:] != e[1:]:
            return False
        gn, en = g[0], e[0]
        if not (gn == en or gn in en or en in gn):
            return False
    return True


def passes(r, exp):
    s = summarize(r)
    return (s["email"], s["currency"], s["due_days"], s["missing"]) == (
        exp["email"], exp["currency"], exp["due_days"], exp["missing"]) and item_match(s["items"], exp["items"])


async def main() -> int:
    s = load_settings()
    model = os.environ.get("OLLAMA_MODEL") or s.ollama_model
    s = Settings(**{**s.__dict__, "ollama_model": model, "llm_timeout_s": float(os.environ.get("LLM_TIMEOUT_S", 20))})
    print(f"model: {model}  timeout: {s.llm_timeout_s}s  cases: {len(CASES)}\n")

    async with httpx.AsyncClient() as http:
        client = OllamaClient(s, http)
        health = await client.health()
        print("ollama health:", health)
        if health != "ok":
            print("Ollama model not available; pull it first (ollama pull", model + ")")
            return 2
        print("warming up...", await client.warm_up())
        svc = ParseService(client)

        llm_ok = fallback = 0
        times = []
        print(f"\n{'id':5} {'llm':5} {'src':6} {'secs':>5}  text")
        for c in CASES:
            t0 = time.perf_counter()
            r = await svc.parse(c["text"])
            dt_s = time.perf_counter() - t0
            times.append(dt_s)
            from_llm = r.source == "llm"
            ok = passes(r, c["expect"]) and from_llm  # a regex-filled answer is not an LLM success
            llm_ok += ok
            fallback += not from_llm
            print(f"{c['id']:5} {'PASS' if ok else 'FAIL':5} {r.source:6} {dt_s:5.1f}  {c['text'][:70]}")
            if not ok:
                print(f"      got: {json.dumps(summarize(r))}\n      exp: {json.dumps(c['expect'])}")

    regex_cases = [c for c in CASES if c["regex"]]
    regex_ok = sum(passes(ground(parse_regex(c["text"]), c["text"], "regex"), c["expect"]) for c in regex_cases)

    print(f"\nLLM path  : {llm_ok}/{len(CASES)} = {100 * llm_ok / len(CASES):.0f}%  ({fallback} cases answered by regex instead of the model)")
    print(f"Regex path: {regex_ok}/{len(regex_cases)} = {100 * regex_ok / len(regex_cases):.0f}%  (regex-capable cases only)")
    print(f"Latency   : median {statistics.median(times):.1f}s  max {max(times):.1f}s")
    print("Target (A2): LLM >= 90%, regex 100%")
    return 0 if llm_ok / len(CASES) >= 0.9 and regex_ok == len(regex_cases) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
