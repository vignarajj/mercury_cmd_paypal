#!/usr/bin/env bash
# Regenerate README and cover screenshots from the real UI (dev-only showcase scenes) with headless Chrome.
#   scripts/shots.sh          needs Google Chrome (or set CHROME=/path/to/chrome)
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "Chrome not found. Set CHROME=/path/to/chrome"; exit 1; }
OUT=docs/img
URL=http://localhost:1420
STARTED=""

if ! curl -sf "$URL" >/dev/null; then
  ( cd frontend && npm run dev:web >/dev/null 2>&1 ) & STARTED=$!
  trap '[ -n "$STARTED" ] && kill "$STARTED" 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -sf "$URL" >/dev/null && break; sleep 0.5; done
fi

shot() { # scene theme height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=760,"$3" --virtual-time-budget=3500 \
    --screenshot="$OUT/$1-$2.png" "$URL/?shots=$1&theme=$2" >/dev/null 2>&1
  echo "  $OUT/$1-$2.png"
}

for theme in dark light; do
  shot empty   "$theme" 430
  shot reading "$theme" 290
  shot preview "$theme" 650
  shot sent    "$theme" 335
  shot paid    "$theme" 335
done

# Devpost / README cover (3:2) composed from the screenshots above
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1500,1000 --virtual-time-budget=2000 \
  --screenshot="$OUT/cover.png" "file://$PWD/frontend/brand/cover.html" >/dev/null 2>&1
echo "  $OUT/cover.png"
