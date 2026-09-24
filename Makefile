.DEFAULT_GOAL := help

NPM ?= npm
DC ?= docker compose

COMPOSE_FILE ?= docker-compose.yml
STAGING_COMPOSE_FILE ?= docker-compose.staging.yml
POSTGRES_COMPOSE_FILE ?= docker-compose.postgres.yml

WEB_PACKAGE ?= @patchwork/web

# Immutable image versioning (#109)
GIT_SHA ?= $(shell git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)
GIT_SHA_FULL ?= $(shell git rev-parse HEAD 2>/dev/null || echo unknown)
GIT_BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
BUILD_VERSION ?= 0.9.0
IMAGE_TAG ?= $(BUILD_VERSION)-$(GIT_SHA)
CI_RUN_ID ?= local

# Explicit operator environment for verified manifest rollback
STAGING_ENV_FILE ?=

.PHONY: \
	help \
	install env-init \
	dev dev-web dev-api dev-api-postgres dev-indexer dev-moderation \
	db-up db-down db-migrate make-db-migrate db-seed db-reset \
	lint typecheck test test-integration test-web-e2e check build \
	quality \
	deploy-network deploy-build deploy-up deploy-down deploy-restart deploy-ps deploy-logs deploy-pull deploy-db-migrate \
	compose-config \
	staging-network staging-build staging-up staging-down staging-ps staging-logs staging-smoke staging-db-migrate \
	image-tag image-build rollback

help: ## Show available make targets
	@awk 'BEGIN {FS = ":.*##"; printf "\nPatchwork Make targets\n\n"} /^[a-zA-Z0-9_.-]+:.*##/ {printf "  %-24s %s\n", $$1, $$2} END {printf "\n"}' $(MAKEFILE_LIST)

install: ## Install all monorepo dependencies
	$(NPM) ci

env-init: ## Create .env from .env.example if it does not exist
	@if [ -f .env ]; then \
		echo ".env already exists (no changes made)."; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
	fi

dev: dev-web ## Start web app (default local dev surface)

dev-web: ## Start web app (Vite)
	$(NPM) run dev:web

dev-api: ## Start API with PostgreSQL and real AT OAuth
	$(NPM) run dev:api

dev-api-postgres: ## Start API in postgres mode
	$(NPM) run dev:api:postgres

dev-indexer: ## Start indexer service
	$(NPM) run dev:indexer

dev-moderation: ## Start moderation worker
	$(NPM) run dev:moderation

db-up: ## Start local Postgres for development
	$(NPM) run db:up

db-down: ## Stop local Postgres for development
	$(NPM) run db:down

db-migrate: ## Run versioned API database migrations
	$(NPM) run db:migrate

make-db-migrate: db-migrate ## Alias target for db-migrate

db-seed: ## Seed local Postgres with deterministic data
	$(NPM) run db:seed

db-reset: db-down db-up db-seed ## Recreate and reseed local Postgres

lint: ## Run lint checks across workspaces
	$(NPM) run lint

typecheck: ## Run TypeScript checks across workspaces
	$(NPM) run typecheck

test: ## Run unit/integration tests across workspaces
	$(NPM) run test

test-integration: ## Run all PostgreSQL tests in a disposable database
	$(NPM) run test:integration

test-web-e2e: ## Run Playwright browser E2E tests for web app
	$(NPM) run test:e2e -w $(WEB_PACKAGE)

check: ## Run the default local gate (lint + typecheck + test)
	$(NPM) run check

quality: check ## Run merge-readiness quality gate

build: ## Build all workspaces
	$(NPM) run build

deploy-network: ## Ensure external Docker network "web" exists
	@docker network inspect web >/dev/null 2>&1 || docker network create web

compose-config: ## Validate production compose file
	$(DC) -f $(COMPOSE_FILE) config >/dev/null

deploy-build: ## Build production Docker images from compose file
	$(DC) -f $(COMPOSE_FILE) build

deploy-up: deploy-network ## Start production stack (detached, with build)
	$(DC) -f $(COMPOSE_FILE) up -d --build

deploy-down: ## Stop production stack
	$(DC) -f $(COMPOSE_FILE) down

deploy-restart: ## Restart production stack services
	$(DC) -f $(COMPOSE_FILE) restart

deploy-ps: ## Show production stack container status
	$(DC) -f $(COMPOSE_FILE) ps

deploy-logs: ## Tail production stack logs
	$(DC) -f $(COMPOSE_FILE) logs -f --tail=200

deploy-pull: ## Pull latest upstream images referenced by compose file
	$(DC) -f $(COMPOSE_FILE) pull

deploy-db-migrate: deploy-network ## Run DB migrations via production API container
	$(DC) -f $(COMPOSE_FILE) up -d postgres
	$(DC) -f $(COMPOSE_FILE) run --build --rm patchwork-api-migrations
	$(DC) -f $(COMPOSE_FILE) run --build --rm patchwork-indexer-migrations
	$(DC) -f $(COMPOSE_FILE) run --build --rm patchwork-moderation-migrations

# ---------------------------------------------------------------------------
# Staging environment (#108)
# ---------------------------------------------------------------------------

staging-network: ## Ensure external Docker network "staging-web" exists
	@docker network inspect staging-web >/dev/null 2>&1 || docker network create staging-web

staging-build: ## Build staging Docker images
	$(DC) -f $(STAGING_COMPOSE_FILE) build \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg CI_RUN_ID=$(CI_RUN_ID)

staging-up: staging-network ## Start staging stack (detached, with build)
	$(DC) -f $(STAGING_COMPOSE_FILE) up -d --build

staging-down: ## Stop staging stack
	$(DC) -f $(STAGING_COMPOSE_FILE) down

staging-ps: ## Show staging stack container status
	$(DC) -f $(STAGING_COMPOSE_FILE) ps

staging-logs: ## Tail staging stack logs
	$(DC) -f $(STAGING_COMPOSE_FILE) logs -f --tail=200

staging-db-migrate: staging-network ## Run DB migrations via staging API container
	$(DC) -f $(STAGING_COMPOSE_FILE) up -d postgres
	$(DC) -f $(STAGING_COMPOSE_FILE) run --build --rm patchwork-api-migrations
	$(DC) -f $(STAGING_COMPOSE_FILE) run --build --rm patchwork-indexer-migrations
	$(DC) -f $(STAGING_COMPOSE_FILE) run --build --rm patchwork-moderation-migrations

staging-smoke: ## Run smoke checks against staging endpoints
	@echo "Running staging smoke checks..."
	@PASS=0; FAIL=0; \
	for svc in api:4000 spool:4100 thimble:4200; do \
		name=$${svc%%:*}; port=$${svc##*:}; \
		url="http://patchwork-staging-$${name}:$${port}/health/ready"; \
		if curl -sf --max-time 5 "$$url" > /dev/null 2>&1; then \
			echo "  PASS: $$name /health/ready"; \
			PASS=$$((PASS + 1)); \
		else \
			echo "  FAIL: $$name /health/ready"; \
			FAIL=$$((FAIL + 1)); \
		fi; \
	done; \
	echo "Smoke results: $$PASS passed, $$FAIL failed"; \
	if [ "$$FAIL" -gt 0 ]; then \
		echo "ERROR: Smoke checks failed -- promotion to production blocked."; \
		exit 1; \
	fi; \
	echo "All smoke checks passed -- promotion eligible."

# ---------------------------------------------------------------------------
# Immutable image versioning (#109)
# ---------------------------------------------------------------------------

image-tag: ## Print the immutable image tag for this build
	@echo "$(IMAGE_TAG)"

image-build: ## Build Docker images with immutable tags and OCI labels
	docker build --target api-runtime \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg CI_RUN_ID=$(CI_RUN_ID) \
		-t patchwork-api:$(IMAGE_TAG) .
	docker build --target indexer-runtime \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg CI_RUN_ID=$(CI_RUN_ID) \
		-t patchwork-spool:$(IMAGE_TAG) .
	docker build --target moderation-runtime \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg CI_RUN_ID=$(CI_RUN_ID) \
		-t patchwork-thimble:$(IMAGE_TAG) .
	docker build --target web-runtime \
		--build-arg GIT_SHA=$(GIT_SHA) \
		--build-arg GIT_BRANCH=$(GIT_BRANCH) \
		--build-arg BUILD_VERSION=$(BUILD_VERSION) \
		--build-arg CI_RUN_ID=$(CI_RUN_ID) \
		-t patchwork-web:$(IMAGE_TAG) .

rollback: ## Restore the previous verified staging manifest (STAGING_ENV_FILE required)
	@test -n "$(STAGING_ENV_FILE)" || { echo "Set STAGING_ENV_FILE to the operator environment file."; exit 1; }
	bash scripts/rollback-staging-digests.sh "$(STAGING_ENV_FILE)" "$(STAGING_COMPOSE_FILE)"
