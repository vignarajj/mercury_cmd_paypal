#!/usr/bin/env python3
"""Spike A: prove the PayPal Invoicing v2 sandbox flow and print what PayPal really returns.

Usage:
    python3 scripts/paypal_smoke.py --to buyer-sandbox@personal.example.com
    python3 scripts/paypal_smoke.py --to <buyer email> --amount 12.50 --terms NET_15

Reads backend/.env. Stdlib only (no install). SANDBOX ONLY: refuses any non-sandbox host.
Creates and SENDS one sandbox invoice to --to. Never use a real customer address.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env(path):
    env = {}
    if not os.path.exists(path):
        sys.exit(f"Missing {path}. Copy backend/.env.example to backend/.env and fill it in.")
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def call(method, url, headers, body=None, form=False):
    data = None
    if body is not None:
        data = body.encode() if form else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw


def show(title, status, payload, redact=()):
    if isinstance(payload, dict):
        payload = {k: ("<redacted>" if k in redact else v) for k, v in payload.items()}
    print(f"\n=== {title} -> HTTP {status}")
    print(json.dumps(payload, indent=2) if payload is not None else "(empty body)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--to", required=True, help="sandbox BUYER email (not the merchant)")
    ap.add_argument("--amount", default="12.50")
    ap.add_argument("--terms", default="NET_15", help="payment_term.term_type to test")
    args = ap.parse_args()

    env = load_env(os.path.join(ROOT, "backend", ".env"))
    base = env.get("PAYPAL_API_BASE", "").rstrip("/")
    if "sandbox" not in base:
        sys.exit("Refusing to run: PAYPAL_API_BASE must be a sandbox host.")
    if args.to.lower() == env.get("PAYPAL_MERCHANT_EMAIL", "").lower():
        sys.exit("--to equals PAYPAL_MERCHANT_EMAIL (self-invoice). Use the sandbox buyer email.")

    # 1. token
    basic = base64.b64encode(f"{env['PAYPAL_CLIENT_ID']}:{env['PAYPAL_CLIENT_SECRET']}".encode()).decode()
    st, tok = call("POST", f"{base}/v1/oauth2/token",
                   {"Authorization": f"Basic {basic}", "Content-Type": "application/x-www-form-urlencoded"},
                   "grant_type=client_credentials", form=True)
    show("1. token", st, tok, redact=("access_token",))
    if st != 200:
        sys.exit("Token failed: check client id/secret and that they are SANDBOX credentials.")
    h = {"Authorization": f"Bearer {tok['access_token']}", "Content-Type": "application/json"}

    # 2. create draft
    payload = {
        "detail": {
            "currency_code": "USD",
            "note": "Mercury Cmd smoke test",
            "payment_term": {"term_type": args.terms},
        },
        "primary_recipients": [{"billing_info": {"email_address": args.to}}],
        "items": [{"name": "Smoke test item", "quantity": "1",
                   "unit_amount": {"currency_code": "USD", "value": f"{float(args.amount):.2f}"}}],
    }
    st, created = call("POST", f"{base}/v2/invoicing/invoices", h, payload)
    show("2. create draft", st, created)
    if st not in (200, 201):
        sys.exit("Create failed: read the error above (Invoicing enabled on the app? payment_term name?).")

    invoice_id = None
    if isinstance(created, dict):
        invoice_id = created.get("id") or (created.get("href") or "").rstrip("/").split("/")[-1] or None
    print(f"\n>> invoice_id: {invoice_id}")
    print(">> create response has 'id' field:", isinstance(created, dict) and "id" in created)
    print(">> create response is link object (href):", isinstance(created, dict) and "href" in created)
    if not invoice_id:
        sys.exit("Could not extract invoice id.")

    # 3. send
    # PayPal can 404 (empty body) on /send right after create; retry with backoff.
    for attempt in range(4):
        st, sent = call("POST", f"{base}/v2/invoicing/invoices/{invoice_id}/send", h,
                        {"send_to_recipient": True, "send_to_invoicer": True})
        show(f"3. send (attempt {attempt + 1})", st, sent)
        if st != 404:
            break
        time.sleep(1 + attempt)

    # 4. read back
    st, inv = call("GET", f"{base}/v2/invoicing/invoices/{invoice_id}", h)
    meta = (inv or {}).get("detail", {}).get("metadata", {}) if isinstance(inv, dict) else {}
    print(f"\n=== 4. get invoice -> HTTP {st}")
    print(">> status:", (inv or {}).get("status") if isinstance(inv, dict) else None)
    print(">> detail.metadata keys:", sorted(meta.keys()))
    print(">> recipient_view_url:", meta.get("recipient_view_url"))
    print(">> payer_view_url:", meta.get("payer_view_url"))
    print(">> links rels:", [l.get("rel") for l in (inv or {}).get("links", [])] if isinstance(inv, dict) else None)
    print(">> detail.payment_term:", (inv or {}).get("detail", {}).get("payment_term") if isinstance(inv, dict) else None)
    frag = invoice_id.removeprefix("INV2-").replace("-", "")
    print(f">> fallback URL: https://www.sandbox.paypal.com/invoice/p/#{frag}")
    print("\nNext: open the recipient URL, log in as the sandbox buyer, confirm it renders.")
    print("Then update execution spec section 4 (VERIFY items) with what you saw above.")


if __name__ == "__main__":
    main()
