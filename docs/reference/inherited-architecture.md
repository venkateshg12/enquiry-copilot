# The inherited architecture (e-commerce → PaperTrail → Enquiry Assistant)

This project copies the e-commerce backend's architecture in the **PostgreSQL + Prisma** form that
PaperTrail implemented. PaperTrail is the primary source: everything that touches the database, the
model layer, the outbox, tenancy and the web app comes from its **implemented** code. e-commerce is the
origin and is cited where a file is database-free and unchanged. The long explanation of each piece is
`~/Code/paper-trail/docs/reference/ecommerce-architecture.md`. Read it once before Phase 01.

## Path shorthands (used in every phase)

| Shorthand | Real path |
| --- | --- |
| `@ec-root/` | `~/Code/e-commerce/` |
| `@ec-api/` | `~/Code/e-commerce/apps/backends/mongo/` |
| `@ec-web/` | `~/Code/e-commerce/apps/client/` |
| `@pt-root/` | `~/Code/paper-trail/` |
| `@pt-api/` | `~/Code/paper-trail/apps/api/` (Express 5 + Prisma 7.10.1, implemented through Phase 43) |
| `@pt-web/` | `~/Code/paper-trail/apps/web/` (Next.js App Router, implemented) |
| `@cd-widget/` | `~/Code/counseldesk/apps/widget/` (the embeddable script) |
| `@pl-docs/` | `~/Code/prompt-lab/docs/` (the evaluation method and task format) |
| `@pb-docs/` | `~/Code/prompt-engineering-playbook/docs/` (Lessons 5, 6 and 8 read this project's evals) |

Tags: **COPY** = identical apart from import paths (`diff` it). **ADAPT** = start from the source,
change only what the phase lists. **NEW** = written here, full code in the phase.

## The pieces

| Piece | Source | Why it exists | Here |
| --- | --- | --- | --- |
| Strict layering | `@ec-api/src`, `@pt-api/src` | Rules live in services, testable without HTTP | Same |
| `createApp()` / `index.ts` / `worker.ts` | `@pt-api/src/{app,index,worker}.ts` | Supertest imports the app; workers run in-process in dev, separately in prod | Same |
| Env at boot, error trio, envelope | `@pt-api/src/constants/env.ts`, `utils/errors`, `utils/api` | Fail at deploy, one error shape | Same; adds `NVIDIA_API_KEY`, `SECRET_BOX_KEY`, Gmail channel vars |
| pino + request context + redaction | `@pt-api/src/utils/{logger,requestContext}.ts` | Traceable logs, no PII | Redacts `body`, `fromContact`, `fromName`, `draft`, `finalText`, `phone`, `email` |
| Prisma client, tenant extension, `runAsSystem` | `@pt-api/src/db/prisma.ts` | Every tenant query scoped to the caller's org | **COPY** with `TENANT_MODELS` changed to this project's tables |
| db helpers | `@pt-api/src/db/errors.ts`, `src/utils/db/{transaction,cursor}.ts` | One way to run a transaction; cursor lists | COPY |
| Auth (JWT + DB sessions + refresh rotation with reuse detection, Google, verify, reset) | `@pt-api/src/{services/auth.service.ts,utils/auth,middleware/authenticate.ts,controllers/{auth,googleAuth,session}.controller.ts}` | Real logout; stolen refresh tokens kill the session | COPY (staff accounts register and verify) |
| Orgs, memberships, invites, `resolveOrg`, `requireOrgRole`, permissions | `@pt-api/src/{services/{org,member,invite}.service.ts,middleware/{resolveOrg,requireOrgRole,authorize}.ts,constants/permissions.ts}` | Role read live; cross-tenant access impossible | A business **is** an org; permissions list ADAPTED |
| Audit log | `@pt-api/src/services/audit.service.ts` | Who did what | The activity log: approvals, edits, overrides, bookings |
| Rate limiter (Lua, punitive, dual bucket, breaker, IP extractor, `visitorId`) | `@pt-api/src/utils/rateLimiter/*`, `middleware/{rateLimiter,visitorId}.ts` | Public endpoints without abuse | Adds per-form intake limiters (IP + form + visitor) |
| Two Redis, three configs | `@pt-root/docker-compose.yml`, `@pt-api/src/config/redis.ts` | Queue never evicts; cache must | Same |
| Cache (versioned, single-flight, never throws) | `@pt-api/src/utils/cache` | O(1) invalidation | Versioned domains `inbox`, `stats`; per-entity keys `cache:session:<id>`, `cache:info:<orgId>` |
| BullMQ, Bull Board, DLQ, replay | `@pt-api/src/jobs/{queues,workers,processors,producers,deadLetter.ts,dashboard}` | Retries, visibility, no lost jobs | Queues listed in architecture.md §4 |
| System email via Gmail API | `@pt-api/src/{config/gmail.ts,services/gmail.service.ts,jobs/processors/email.processor.ts}` | Verify/reset/invite mail off the request path | Same (one system sender) |
| Transactional outbox + relay (`FOR UPDATE SKIP LOCKED`) | `@pt-api/src/{services/outbox.service.ts,jobs/outbox/{relay,dispatchers}.ts}` | No lost or phantom side effects | `message.received` → pipeline; `reply.approved` → send |
| Sealed secrets | `@pt-api/src/utils/crypto/secretBox.ts` | Encrypted at rest with a key outside the DB | Per-business Gmail refresh tokens |
| PII masking | `@pt-api/src/utils/pii.ts` | Mask before display/log | **ADAPT** in Phase 02: PaperTrail's only masks bank account numbers; adds `maskPhone`, `maskEmail`, `contactRef` for logs and drafts (used by Phase 20, extended in Phase 28) |
| Model layer (NVIDIA, fake, replay, breakers, concurrency, reliability, JSON repair) | `@pt-api/src/ai/*` | One reliable `complete()` | Purposes `classify | extract | draft | judge`; adds plain-text completion for drafts |
| Cost + usage + budgets | `@pt-api/src/{utils/cost.ts,constants/pricing.ts,services/{usage,quota}.service.ts}` | Know and cap spend | Per-business monthly model budget |
| SSE + pub/sub + stream limiter | `@pt-api/src/utils/events/{pubsub,sse,streamLimiter}.ts` | Live inbox without polling | Channel per org |
| Eval harness | `@pt-api/evals/{run,metrics,gate,variance,compare}.ts` | Measured, not guessed | Messages instead of PDFs |
| Next.js web foundation | `@pt-web/src/{lib,store,app/providers.tsx,components/{auth,layout,ui,common},hooks/auth,app/(public)}` | Silent refresh, guards, primitives | Same, plus the inbox screens. **Next.js 16** (npm current; PaperTrail is on 15): Phase 09 checked the upgrade guide against the copied files; fallback is `next@^15` |
| Widget | `@cd-widget/` | One-file embeddable script | A contact form instead of chat |
| Tests (Vitest, Supertest, Testcontainers Postgres + Redis, Playwright) | `@pt-api/{vitest*.mts,test/*}`, `@pt-web/e2e` | Real migrations in tests | Phase 31 |
| Dockerfile, CI | `@pt-api/Dockerfile`, `@pt-root/.github/workflows/{ci,eval}.yml` | Same build everywhere; eval gate | Phase 32 |

## Version pins that differ from "latest"

| Package | Pin | Why |
| --- | --- | --- |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | exactly `7.10.1` | npm `latest` is an 8.0 RC (PaperTrail ADR 0010) |
| `googleapis` | PaperTrail's `^184` | the copied Gmail files compile unchanged; npm's current major is 189 |
| `typescript` | `5.9.2` at the root, `^6.0.3` in `apps/api` (as PaperTrail) | a bare `pnpm add -D typescript` installs 7 |
| `eslint` | `^9` | the copied `@repo/eslint-config` is ESLint 9; newer plugins want 10 |
| `next` | `^16` | Phase 09 (fallback 15) |

## Documented COPY exceptions

A COPY file stays identical to its source except for these deliberate, commented hunks:
- `middleware/authenticate.ts`: Phase 05's `setRequestContext({ userId })` line (log context).
- `utils/logger.ts` is ADAPT anyway; its `setLogDestination` sink (Phase 02) exists for Phase 31.
- `providers/replay.ts`: the cache key includes the system prompt (Phase 15), because the draft
  prompt's system text carries the info sheet.

## Deliberately not copied

| Not copied | Why |
| --- | --- |
| PaperTrail documents, PDF pages, storage (R2/MinIO), validators for invoices, line items | Different domain. The *method* (deterministic checks after the model, grounded confidence) is reused for the safety checks |
| API keys, webhooks, idempotency-key middleware | No machine clients. Widget retries are deduped by `clientSubmissionId`, a unique index, not a middleware |
| The cheap-model cascade and extraction cache | Messages are unique; a cache would never hit. The "cheap model for classify/extract" choice is a per-purpose model setting instead |
| Quotas on pages, fair scheduling lanes | One kind of job, small; a monthly cost budget is enough |
| CounselDesk RAG and embeddings | The info sheet is small. Selection is by type + keyword (Phase 18). Retrieval is a later improvement |
