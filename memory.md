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
- Phase 03: Prisma 7.10.1 + tenant extension; `pnpm --filter api db:migrate:dev --name x < /dev/null`.
- Phase 04: User/Session/VerificationLink + /auth register|login|refresh|logout|verify|resend. No email until Phase 08: dev verification link is logged at debug (LOG_LEVEL=debug). `.env` has generated JWT secrets. Verify DB scratch: `truncate users cascade`.
- Phase 05: authenticate/requireAdmin/session/Google/reset. 👤 owner: create a Google OAuth *Web* client id (.env has a placeholder; real sign-in untested). No jq on this machine — use python for JSON in checks. Reset token is in the POST body.
- Phase 06: limiters + checkIntakeCap. inviteSourceLimiter deferred to Phase 10 (needs req.orgId; marked in config/rateLimiter.ts). `/auth/dev/latest-link` omitted until Phase 08 (devMailbox).
- Phase 07: cache (utils/cache) COPY contains console.warn — the only allowed console.* in src. Domain-bump `// Phase NN:` comments are added where the intake/pipeline/approval services are written (13/21/24), the files don't exist yet. First /health after boot may say redis:down until the client is ready.
- Phase 08: queues email/dead-letter/maintenance, purge hourly, worker.ts (standalone health on PORT||WORKER_PORT). Phase 08 is 🟡: 👤 owner must set GMAIL_CLIENT_ID/SECRET and authorize once (http://localhost:5000/api/auth/gmail) to get GMAIL_REFRESH_TOKEN; until then mail goes to the dev mailbox (/auth/dev/latest-link?email=). Phase 02 'no console.*' rule: only COPY files cache.ts/email.worker log lines were converted; cache.ts keeps its console.warn.
