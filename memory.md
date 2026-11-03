# memory.md — short build memory

## What this is
AI Enquiry Assistant: classify → extract → draft → code checks → human approval → send. Express 5 +
PostgreSQL 17/Prisma 7.10.1 + Redis ×2 + BullMQ API, Next.js web, one-file widget. Built phase by phase
from `docs/phases/`. Rules in `CLAUDE.md`. Status in `tracker.md`.

## Environment
- Same machine setup as the Playbook (see `~/Code/prompt-engineering-playbook/memory.md`): Node from
  `.nvmrc` via nvm, Docker Desktop on Windows started first, `prisma migrate dev < /dev/null` in scripts.
- NVIDIA retired llama-3.x on 26 Aug 2026 (410): pick current model ids in Phase 15, never assume.

## Decisions / deviations
- Phase 00: `.gitignore` is PaperTrail's minus the `/CLAUDE.md` line (this repo checks CLAUDE.md in) plus `apps/api/src/generated/`; `.prettierignore` copied too. Playbook's docker containers were stopped (not removed) to free 5432/6379/6380; `docker start playbook-postgres playbook-redis playbook-redis-cache` brings them back (stop ours first).

## Built so far
- Phase 00: monorepo, 3 shared packages, docker-compose (postgres 17, redis, redis-cache), api placeholder.
- Phase 01: Express 5 bootstrap (env, error trio, envelope, createApp, /health, ordered shutdown, worker.ts stub). Port 5000 is also used by Playbook dev API — verify the API with PORT=5050 and 127.0.0.1.
- Phase 02: pino logger (swappable sink `setLogDestination`), requestId, pii masks. `.env` (gitignored) has a generated CONTACT_HASH_SALT. `pii.test.ts` is written but vitest arrives in Phase 31 (tsconfig excludes tests).
- Phase 03: Prisma 7.10.1 + tenant extension; `pnpm --filter api db:migrate:dev --name x < /dev/null`. prisma.ts carries a temporary `@ts-expect-error` (no models yet) — remove in Phase 04.
