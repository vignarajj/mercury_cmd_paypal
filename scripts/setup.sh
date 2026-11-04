#!/usr/bin/env bash
# One-shot setup: Python venv + deps, npm deps, config files with a generated shared token.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' \
  || { echo "Python 3.12+ is required (found: $("$PY" --version 2>&1)). Set PYTHON=/path/to/python3.12"; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ is required."; exit 1; }

echo "==> Backend: virtualenv and dependencies"
"$PY" -m venv backend/.venv
backend/.venv/bin/pip install -q --upgrade pip
backend/.venv/bin/pip install -q -r backend/requirements-dev.txt

echo "==> Frontend: npm install"
(cd frontend && npm install --no-audit --no-fund --loglevel=error)

echo "==> Config"
[ -f backend/.env ] || cp backend/.env.example backend/.env
if grep -q '^MERCURY_TOKEN=change-me' backend/.env; then
  TOKEN="$(openssl rand -hex 16)"
  sed -i.bak "s/^MERCURY_TOKEN=.*/MERCURY_TOKEN=${TOKEN}/" backend/.env && rm -f backend/.env.bak
fi
TOKEN="$(grep '^MERCURY_TOKEN=' backend/.env | cut -d= -f2-)"
printf 'VITE_API_BASE=http://127.0.0.1:47891\nVITE_MERCURY_TOKEN=%s\n' "$TOKEN" > frontend/.env.local

cat <<'MSG'

Setup done. Two things left:
  1. Edit backend/.env and fill in PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_EMAIL
     (PayPal SANDBOX app with Invoicing enabled; see README "PayPal sandbox setup").
  2. Optional AI: ollama pull gemma4:e2b-it-qat   (without it, Mercury uses its rule-based parser)

Then run:  make dev-web   (browser, no Rust needed)   or   make dev   (desktop app)
MSG
