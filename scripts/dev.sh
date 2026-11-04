#!/usr/bin/env bash
# Start the backend and the frontend together; Ctrl+C stops both.   usage: scripts/dev.sh [desktop|web]
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-desktop}"

[ -f backend/.env ] || { echo "backend/.env is missing. Run: make setup"; exit 1; }
for v in PAYPAL_CLIENT_ID PAYPAL_CLIENT_SECRET; do
  grep -Eq "^${v}=.+" backend/.env || { echo "backend/.env: ${v} is empty. Fill in your PayPal sandbox credentials."; exit 1; }
done
[ -x backend/.venv/bin/uvicorn ] || { echo "Backend dependencies missing. Run: make setup"; exit 1; }
if [ "$MODE" = desktop ]; then command -v cargo >/dev/null || { echo "Rust is required for desktop mode (https://rustup.rs). Or run: make dev-web"; exit 1; }; fi

( cd backend && exec .venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 47891 ) &
BACKEND=$!
trap 'kill "$BACKEND" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 40); do
  curl -sf http://127.0.0.1:47891/api/health >/dev/null && break
  kill -0 "$BACKEND" 2>/dev/null || { echo "Backend exited. Check the error above."; exit 1; }
  sleep 0.5
done
echo "Backend ready on http://127.0.0.1:47891"

cd frontend
if [ "$MODE" = web ]; then
  echo "Open http://localhost:1420"
  npm run dev:web
else
  echo "Desktop app starting. Press Cmd+Shift+Space from any app to open the palette."
  npm run tauri dev
fi
