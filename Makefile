.PHONY: up down logs test test-int eval eval-gate db-migrate lint typecheck build help

help:
	@echo "Available commands:"
	@echo "  make up          - Start the infrastructure (postgres, redis, redis-cache)"
	@echo "  make down        - Stop the infrastructure"
	@echo "  make logs        - Tail infrastructure logs"
	@echo "  make test        - Run unit tests"
	@echo "  make test-int    - Run integration tests (requires Docker)"
	@echo "  make eval        - Run the pipeline eval"
	@echo "  make eval-gate   - Run eval baseline regression gate"
	@echo "  make db-migrate  - Apply PostgreSQL migrations (prisma migrate deploy)"
	@echo "  make lint        - Run workspace linter"
	@echo "  make typecheck   - Run workspace TypeScript checks"
	@echo "  make build       - Build all workspace packages and apps"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

test:
	pnpm --filter api test

test-int:
	pnpm --filter api test:int

eval:
	pnpm --filter api eval

eval-gate:
	pnpm --filter api eval:gate

db-migrate:
	pnpm --filter api db:migrate

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build
