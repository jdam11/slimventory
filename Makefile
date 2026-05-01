.PHONY: dev down test build seed lint hooks-install secrets-scan verify pull publish-public

dev:
	docker compose up --build

down:
	docker compose down

test:
	docker compose run --rm --no-deps --entrypoint /bin/sh \
		-e DB_PASSWORD=test \
		-e SECRET_KEY=test-secret-key-very-long-for-testing-purposes-only \
		-e ADMIN_PASSWORD=admintest1 \
		-e READONLY_PASSWORD=readonlytest1 \
		-e UV_CACHE_DIR=/tmp/uv-cache \
		-v "$(CURDIR)/backend/tests:/app/tests:ro" \
		backend \
		-c "uv sync --extra test && python -m pytest tests/ -v"

seed:
	cd backend && uv run python seed.py

lint:
	docker compose run --rm --no-deps --entrypoint /bin/sh \
		-e DB_PASSWORD=test \
		-e SECRET_KEY=test-secret-key-very-long-for-testing-purposes-only \
		-e ADMIN_PASSWORD=admintest1 \
		-e READONLY_PASSWORD=readonlytest1 \
		-e UV_CACHE_DIR=/tmp/uv-cache \
		-v "$(CURDIR)/backend/app:/app/app:ro" \
		backend \
		-c "uv sync --extra dev && ruff check app/"

hooks-install:
	./scripts/install_git_hooks.sh

secrets-scan:
	./scripts/run_gitleaks.sh git . --no-banner --redact --log-opts="--all"

verify:
	make lint
	make test
	npm --prefix frontend run build
	make secrets-scan

build:
	docker compose build

pull:
	docker compose -f docker-compose.release.yml pull

publish-public:
	@test -n "$(VERSION)" || (echo "Usage: make publish-public VERSION=1.0.0" && exit 1)
	./scripts/publish-public.sh $(VERSION)
