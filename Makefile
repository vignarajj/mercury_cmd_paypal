.PHONY: setup dev dev-web backend test test-backend test-frontend smoke eval

setup:            ## venv, deps, config + generated token
	./scripts/setup.sh

dev:              ## backend + desktop app (needs Rust)
	./scripts/dev.sh desktop

dev-web:          ## backend + browser UI at http://localhost:1420 (no Rust)
	./scripts/dev.sh web

backend:          ## backend only, with auto-reload
	cd backend && .venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 47891 --reload

test: test-backend test-frontend  ## all automated tests

test-backend:
	cd backend && .venv/bin/python -m pytest -q

test-frontend:
	cd frontend && npx tsc --noEmit && npx vitest run

smoke:            ## real PayPal sandbox round trip: make smoke TO=<sandbox buyer email>
	@test -n "$(TO)" || (echo "Usage: make smoke TO=<sandbox buyer email>"; exit 1)
	python3 scripts/paypal_smoke.py --to $(TO)

eval:             ## run the parse corpus against the real local model
	backend/.venv/bin/python scripts/eval_parser.py
