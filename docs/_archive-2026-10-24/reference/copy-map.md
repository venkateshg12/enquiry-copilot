# Copy map

Every file that comes from an existing project, its tag and its phase. Shorthands:
[architecture.md](architecture.md).

**COPY** = byte-identical (`diff -q` prints nothing). **ADAPT** = only the listed changes. **NEW** =
full code in the phase.

## Root, packages

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `turbo.json`, `pnpm-workspace.yaml`, `.gitignore`, `.prettierrc`, `.prettierignore`, `.dockerignore` | COPY | `@pt-root/` | 00 |
| `package.json`, `Makefile`, `docker-compose.yml` | ADAPT (names; no MinIO) | `@pt-root/` | 00 |
| `packages/typescript-config/*`, `packages/eslint-config/*` | COPY | `@pt-root/packages/` | 00 |
| `packages/types/src/{api,cookie,objectId,pagination,user,org}.ts` | COPY / ADAPT | `@pt-root/packages/types/src/` | 01–10 |
| `packages/types/src/{business,infoSheet,message,pipeline,reply,booking}.ts` | NEW | — | 11–24 |

## apps/api foundation (copied as in Prompt Lab's Phases 00–08, plus tenancy)

| Path (`apps/api/`) | Tag | Source | Phase |
| --- | --- | --- | --- |
| `src/{app,index,worker}.ts`, `src/constants/env.ts` | ADAPT | `@pt-api/src/` | 01 (grows) |
| `src/utils/{errors,api}/*`, `src/middleware/{errorHandler,notFound,requestId}.ts`, `src/constants/https.ts` | COPY | `@pt-api/src/` | 01–02 |
| `src/utils/{logger,requestContext}.ts` | ADAPT (redaction for message PII) | `@pt-api/src/utils/` | 02 |
| `src/config/db.ts`, `src/utils/db/{transaction,cursor,tenantPlugin}.ts` | COPY | `@pt-api/src/` | 03 / 10 |
| auth: `src/utils/auth/*`, `src/models/{user,session,verificationLink}.model.ts`, `src/services/auth.service.ts`, `src/controllers/{auth,session,googleAuth}.controller.ts`, `src/routes/{auth,session}.route.ts`, `src/middleware/{authenticate,requireAdmin}.ts` | COPY | `@pt-api/src/` | 04–05 |
| rate limiter: `src/utils/rateLimiter/*`, `src/middleware/{rateLimiter,visitorId}.ts`, `src/config/{redis,rateLimiter}.ts` | COPY / ADAPT (intake limiters) | `@pt-api/src/` | 06 |
| `src/utils/cache/*` | ADAPT (domains) | `@pt-api/src/utils/cache/` | 07 |
| `src/jobs/{redis,queues/email.queue,producers/email.producer,workers/email.worker,processors/email.processor,dashboard}/…`, `src/config/gmail.ts`, `src/services/gmail.service.ts`, `src/controllers/gmailAuth.controller.ts`, `src/routes/gmail.route.ts`, `src/utils/email/*` | COPY / ADAPT | `@pt-api/src/` | 08 |
| tenancy: `src/models/{org,membership,invite}.model.ts`, `src/services/{org,member,invite}.service.ts`, `src/middleware/{resolveOrg,requireOrgRole,authorize}.ts`, `src/constants/permissions.ts` | ADAPT (org → business vocabulary, permissions) | `@pt-api/src/` | 10 |
| outbox: `src/models/outboxEvent.model.ts`, `src/services/outbox.service.ts`, `src/jobs/outbox/{relay,dispatchers}.ts` | COPY / ADAPT (dispatchers) | `@pt-api/src/` | 12 |
| `src/utils/crypto/secretBox.ts`, `src/utils/pii.ts` | COPY / ADAPT | `@pt-api/src/utils/` | 23 / 26 |
| AI: `src/ai/{types,errors,reliability,modelJson,breakers,concurrency,llm}.ts`, `src/ai/providers/{nvidia,fake,replay}.ts`, `src/constants/{llm,pricing}.ts`, `src/utils/cost.ts` | COPY / ADAPT (purposes, generateText) | `@pt-api/src/` | 14 |
| `src/utils/events/{pubsub,sse,streamLimiter}.ts` | ADAPT (channel per business) | `@pt-api/src/utils/events/` | 20 |
| `test/{globalSetup,setupEnv}.ts`, `test/helpers/*`, `vitest*.mts` | ADAPT | `@pt-api/` | 29 |

## apps/web, apps/widget

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/web/**` foundation (lib, store, types, ui, auth, guards, (public) screens, account) | COPY / ADAPT (branding; org switcher → business switcher) | `@pt-web/` | 09 / 10 |
| `apps/widget/{vite.config.ts,tsconfig.json,package.json}` | ADAPT (name, output `enquiry.js`) | `@cd-widget/` | 13 |
| `apps/widget/src/{styles,ui}.ts` | ADAPT (form instead of chat) | `@cd-widget/src/` | 13 |

## Not copied

| From | Why not |
| --- | --- |
| PaperTrail documents, PDF, storage, extraction validators, webhooks, API keys, evals | different domain (the eval *method* is reused in Phase 27) |
| CounselDesk RAG, embeddings, chat SSE | the info sheet is small; full text fits the prompt (retrieval is a later improvement, Phase 17) |
