# Copy map

Every file a phase creates or changes, with its tag, its source and its phase. **Generated** from the
**Files** section of each phase guide (regenerate after editing a guide). Shorthands are defined in
[inherited-architecture.md](inherited-architecture.md).

**COPY** = identical apart from import paths, or a documented exception
([inherited-architecture.md](inherited-architecture.md) lists them). **ADAPT** = only the changes the
phase lists. **NEW** = full code in the phase. A path listed in several phases is created by the first
and changed by the later ones.

## root and other

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `package.json` | ADAPT | `@pt-root/package.json` | 00 |
| `pnpm-workspace.yaml` | COPY | `@pt-root/pnpm-workspace.yaml` | 00 |
| `turbo.json` | COPY | `@pt-root/turbo.json` | 00 |
| `.prettierrc` | COPY | `@pt-root/.prettierrc` | 00 |
| `.gitignore` | COPY | `@pt-root/.gitignore` | 00 |
| `Makefile` | ADAPT | `@pt-root/Makefile` | 00 |
| `docker-compose.yml` | ADAPT | `@pt-root/docker-compose.yml` | 00 |
| `.dockerignore` | COPY | `@pt-root/.dockerignore` | 32 |
| `docker-compose.yml` | ADAPT | `@pt-root/docker-compose.yml` | 32 |
| `docs/DEPLOY.md` | NEW | — | 32 |
| `README.md` | ADAPT | — | 33 |
| `docs/adr/0001-postgresql-prisma-over-mongodb.md` | NEW | — | 33 |
| `docs/adr/0002-one-checkpointed-job-not-a-flow.md` | NEW | — | 33 |
| `docs/adr/0003-outbox-only-send-path.md` | NEW | — | 33 |
| `docs/adr/0004-business-is-an-org-names-kept.md` | NEW | — | 33 |
| `docs/adr/0005-info-sheet-selection-without-rag.md` | NEW | — | 33 |
| `docs/adr/0006-nvidia-per-purpose-models.md` | NEW | — | 33 |
| `docs/adr/0007-widget-dedupe-without-idempotency-middleware.md` | NEW | — | 33 |
| `docs/ARCHITECTURE.md` | NEW | — | 33 |
| `docs/DATA-HANDLING.md` | ADAPT | `@pt-root/docs/DATA-HANDLING.md` | 33 |
| `docs/SECURITY.md` | ADAPT | `@pt-root/docs/SECURITY.md` | 33 |
| `docs/LIMITATIONS.md` | ADAPT | `@pt-root/docs/LIMITATIONS.md` | 33 |
| `docs/EVALS.md` | ADAPT | `@pt-root/docs/EVALS.md` | 33 |
| `docs/demo-script.md` | ADAPT | `@pt-root/docs/demo-script.md` | 33 |
| `docs/{INTERVIEW,PILOT}.md` | NEW | — | 33 |

## packages

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `packages/typescript-config/` | COPY | `@pt-root/packages/typescript-config/` | 00 |
| `packages/eslint-config/` | COPY | `@pt-root/packages/eslint-config/` | 00 |
| `packages/types/package.json` | COPY | `@pt-root/packages/types/package.json` | 00 |
| `packages/types/tsconfig.json` | COPY | `@pt-root/packages/types/tsconfig.json` | 00 |
| `packages/types/src/index.ts` | NEW | — | 00 |
| `packages/types/src/api.ts` | COPY | `@pt-root/packages/types/src/api.ts` | 00 |
| `packages/types/src/id.ts` | COPY | `@pt-root/packages/types/src/id.ts` | 00 |
| `packages/types/src/pagination.ts` | COPY | `@pt-root/packages/types/src/pagination.ts` | 00 |
| `packages/types/src/user.ts` | ADAPT | `@pt-root/packages/types/src/user.ts` | 04 |
| `packages/types/src/cookie.ts` | COPY | `@pt-root/packages/types/src/cookie.ts` | 04 |
| `packages/types/src/index.ts` | ADAPT | — | 04 |
| `packages/types/src/user.ts` | ADAPT | — | 05 |
| `packages/types/src/org.ts` | ADAPT | `@pt-root/packages/types/src/org.ts` | 10 |
| `packages/types/src/org.ts` | ADAPT | `@pt-root/packages/types/src/org.ts` | 11 |
| `packages/types/src/infoSheet.ts` | NEW | — | 12 |
| `packages/types/src/org.ts` | ADAPT | — | 12 |
| `packages/types/src/message.ts` | NEW | — | 13 |
| `packages/types/src/intakeForm.ts` | NEW | — | 13 |
| `packages/types/src/events.ts` | ADAPT | `@pt-root/packages/types/src/events.ts` | 13 |
| `packages/types/src/pipeline.ts` | NEW | — | 16 |
| `packages/types/src/pipeline.ts` | ADAPT | — | 17 |
| `packages/types/src/pipeline.ts` | ADAPT | — | 18 |
| `packages/types/src/pipeline.ts` | ADAPT | — | 19 |
| `packages/types/src/checks.ts` | NEW | — | 20 |
| `packages/types/src/pipeline.ts` | ADAPT | — | 21 |
| `packages/types/src/usage.ts` | NEW | — | 22 |
| `packages/types/src/message.ts` | ADAPT | — | 23 |
| `packages/types/src/reply.ts` | NEW | — | 24 |
| `packages/types/src/events.ts` | ADAPT | — | 24 |
| `packages/types/src/booking.ts` | NEW | — | 26 |
| `packages/types/src/stats.ts` | NEW | — | 27 |
| `packages/types/src/privacy.ts` | NEW | — | 28 |
| `packages/types/src/evalSet.ts` | NEW | — | 29 |
| `packages/types/src/evalReport.ts` | NEW | — | 29 |

## apps/api

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/{package.json,tsconfig.json,eslint.config.mjs,src/index.ts}` | NEW | — | 00 |
| `apps/api/.env.example` | ADAPT | `@pt-api/.env.example` | 01 |
| `apps/api/package.json` | ADAPT | — | 01 |
| `apps/api/package.json` | ADAPT | — | 03 |
| `apps/api/package.json` | ADAPT | — | 08 |
| `apps/api/package.json` | ADAPT | — | 14 |
| `apps/api/samples/info-sheet-large.json` | NEW | — | 18 |
| `apps/api/package.json` | ADAPT | — | 29 |
| `apps/api/vitest.config.mts` | COPY | `@pt-api/vitest.config.mts` | 31 |
| `apps/api/vitest.integration.config.mts` | COPY | `@pt-api/vitest.integration.config.mts` | 31 |
| `apps/api/tsconfig.test.json` | COPY | `@pt-api/tsconfig.test.json` | 31 |
| `apps/api/Dockerfile` | ADAPT | `@pt-api/Dockerfile` | 32 |

## apps/api/prisma

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/prisma.config.ts` | COPY | `@pt-api/prisma.config.ts` | 03 |
| `apps/api/prisma/schema.prisma` | ADAPT | `@pt-api/prisma/schema.prisma` | 03 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 04 |
| `apps/api/prisma/schema.prisma` | ADAPT | `@pt-api/prisma/schema.prisma` | 10 |
| `apps/api/prisma/migrations/<ts>_orgs/migration.sql` | NEW | — | 10 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 11 |
| `apps/api/prisma/migrations/<ts>_invites/` | NEW | — | 11 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 12 |
| `apps/api/prisma/migrations/<ts>_info_sheet/` | NEW | — | 12 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 13 |
| `apps/api/prisma/migrations/<ts>_intake/` | NEW | — | 13 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 21 |
| `apps/api/prisma/migrations/<ts>_pipeline/` | NEW | — | 21 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 22 |
| `apps/api/prisma/migrations/<ts>_usage/` | NEW | — | 22 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 24 |
| `apps/api/prisma/migrations/<ts>_replies/` | NEW | — | 24 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 25 |
| `apps/api/prisma/migrations/<ts>_gmail/` | NEW | — | 25 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 26 |
| `apps/api/prisma/migrations/<ts>_bookings/` | NEW | — | 26 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 28 |
| `apps/api/prisma/migrations/<ts>_retention/` | NEW | — | 28 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 29 |
| `apps/api/prisma/migrations/<ts>_evals/` | NEW | — | 29 |

## apps/api/src

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/src/index.ts` | ADAPT | `@pt-api/src/index.ts` | 01 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 01 |
| `apps/api/src/worker.ts` | NEW | — | 01 |
| `apps/api/src/constants/env.ts` | ADAPT | `@pt-api/src/constants/env.ts` | 01 |
| `apps/api/src/constants/https.ts` | COPY | `@pt-api/src/constants/https.ts` | 01 |
| `apps/api/src/constants/appErrorCode.ts` | ADAPT | `@pt-api/src/constants/appErrorCode.ts` | 01 |
| `apps/api/src/utils/errors/{appError,appAssert,catchError,index}.ts` | COPY | `@pt-api/src/utils/errors/` | 01 |
| `apps/api/src/utils/api/{apiEnvelope,index}.ts` | COPY | `@pt-api/src/utils/api/` | 01 |
| `apps/api/src/middleware/notFound.ts` | COPY | `@pt-api/src/middleware/notFound.ts` | 01 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | `@pt-api/src/middleware/errorHandler.ts` | 01 |
| `apps/api/src/utils/requestContext.ts` | ADAPT | `@pt-api/src/utils/requestContext.ts` | 02 |
| `apps/api/src/utils/logger.ts` | ADAPT | `@pt-api/src/utils/logger.ts` | 02 |
| `apps/api/src/utils/pii.ts` | ADAPT | `@pt-api/src/utils/pii.ts` | 02 |
| `apps/api/src/middleware/requestId.ts` | COPY | `@pt-api/src/middleware/requestId.ts` | 02 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 02 |
| `apps/api/src/app.ts` | ADAPT | — | 02 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | — | 02 |
| `apps/api/src/index.ts · worker.ts` | ADAPT | — | 02 |
| `apps/api/src/utils/pii.test.ts` | NEW | — | 02 |
| `apps/api/src/db/prisma.ts` | ADAPT | `@pt-api/src/db/prisma.ts` | 03 |
| `apps/api/src/db/prisma.test.ts` | NEW | — | 03 |
| `apps/api/src/db/errors.ts` | COPY | `@pt-api/src/db/errors.ts` | 03 |
| `apps/api/src/config/db.ts` | COPY | `@pt-api/src/config/db.ts` | 03 |
| `apps/api/src/utils/db/transaction.ts` | COPY | `@pt-api/src/utils/db/transaction.ts` | 03 |
| `apps/api/src/utils/db/cursor.ts` | COPY | `@pt-api/src/utils/db/cursor.ts` | 03 |
| `apps/api/src/utils/db/index.ts` | ADAPT | `@pt-api/src/utils/db/index.ts` | 03 |
| `apps/api/src/scripts/ensure-database.ts` | COPY | `@pt-api/src/scripts/ensure-database.ts` | 03 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 03 |
| `apps/api/src/app.ts` | ADAPT | — | 03 |
| `apps/api/src/index.ts` | ADAPT | — | 03 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 04 |
| `apps/api/src/constants/verificationLinkType.ts` | COPY | `@pt-api/src/constants/verificationLinkType.ts` | 04 |
| `apps/api/src/types/auth.types.ts` | COPY | `@pt-api/src/types/auth.types.ts` | 04 |
| `apps/api/src/types/user.types.ts` | COPY | `@pt-api/src/types/user.types.ts` | 04 |
| `apps/api/src/types/session.types.ts` | COPY | `@pt-api/src/types/session.types.ts` | 04 |
| `apps/api/src/types/verificationLink.types.ts` | COPY | `@pt-api/src/types/verificationLink.types.ts` | 04 |
| `apps/api/src/types/express.d.ts` | ADAPT | `@pt-api/src/types/express.d.ts` | 04 |
| `apps/api/src/utils/auth/{bcrypt,cookies,jwt,verificationToken,index}.ts` | COPY | `@pt-api/src/utils/auth/` | 04 |
| `apps/api/src/utils/date/{date,index}.ts` | COPY | `@pt-api/src/utils/date/` | 04 |
| `apps/api/src/services/auth.service.ts` | ADAPT | `@pt-api/src/services/auth.service.ts` | 04 |
| `apps/api/src/controllers/auth.controller.ts` | ADAPT | `@pt-api/src/controllers/auth.controller.ts` | 04 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | `@pt-api/src/routes/auth.route.ts` | 04 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | — | 04 |
| `apps/api/src/app.ts` | ADAPT | — | 04 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 05 |
| `apps/api/src/middleware/authenticate.ts` | ADAPT | `@pt-api/src/middleware/authenticate.ts` | 05 |
| `apps/api/src/middleware/requireAdmin.ts` | COPY | `@pt-api/src/middleware/requireAdmin.ts` | 05 |
| `apps/api/src/services/auth.service.ts` | ADAPT | — | 05 |
| `apps/api/src/controllers/auth.controller.ts` | ADAPT | — | 05 |
| `apps/api/src/controllers/session.controller.ts` | COPY | `@pt-api/src/controllers/session.controller.ts` | 05 |
| `apps/api/src/controllers/googleAuth.controller.ts` | ADAPT | `@pt-api/src/controllers/googleAuth.controller.ts` | 05 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | — | 05 |
| `apps/api/src/routes/session.route.ts` | ADAPT | `@pt-api/src/routes/session.route.ts` | 05 |
| `apps/api/src/app.ts` | ADAPT | — | 05 |
| `apps/api/src/config/redis.ts` | COPY | `@pt-api/src/config/redis.ts` | 06 |
| `apps/api/src/config/rateLimiter.ts` | ADAPT | `@pt-api/src/config/rateLimiter.ts` | 06 |
| `apps/api/src/constants/rateLimiter.constant.ts` | ADAPT | `@pt-api/src/constants/rateLimiter.constant.ts` | 06 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 06 |
| `apps/api/src/types/rateLimiter.types.ts` | COPY | `@pt-api/src/types/rateLimiter.types.ts` | 06 |
| `apps/api/src/utils/rateLimiter/circuitBreaker.ts` | COPY | `@pt-api/src/utils/rateLimiter/circuitBreaker.ts` | 06 |
| `apps/api/src/utils/rateLimiter/ipExtractor.ts` | COPY | `@pt-api/src/utils/rateLimiter/ipExtractor.ts` | 06 |
| `apps/api/src/utils/rateLimiter/luaScript.ts` | COPY | `@pt-api/src/utils/rateLimiter/luaScript.ts` | 06 |
| `apps/api/src/utils/rateLimiter/memoryStore.ts` | COPY | `@pt-api/src/utils/rateLimiter/memoryStore.ts` | 06 |
| `apps/api/src/utils/rateLimiter/redisStore.ts` | COPY | `@pt-api/src/utils/rateLimiter/redisStore.ts` | 06 |
| `apps/api/src/utils/rateLimiter/index.ts` | COPY | `@pt-api/src/utils/rateLimiter/index.ts` | 06 |
| `apps/api/src/services/intakeCap.service.ts` | NEW | — | 06 |
| `apps/api/src/middleware/rateLimiter.ts` | COPY | `@pt-api/src/middleware/rateLimiter.ts` | 06 |
| `apps/api/src/middleware/visitorId.ts` | COPY | `@pt-api/src/middleware/visitorId.ts` | 06 |
| `apps/api/src/types/express.d.ts` | ADAPT | — | 06 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | `@pt-api/src/routes/auth.route.ts` | 06 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 06 |
| `apps/api/src/utils/cache/cache.ts` | ADAPT | `@pt-api/src/utils/cache/cache.ts` | 07 |
| `apps/api/src/utils/cache/index.ts` | COPY | `@pt-api/src/utils/cache/index.ts` | 07 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 07 |
| `apps/api/src/middleware/authenticate.ts` | ADAPT | `@pt-api/src/middleware/authenticate.ts` | 07 |
| `apps/api/src/services/auth.service.ts` | ADAPT | `@pt-api/src/services/auth.service.ts` | 07 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 07 |
| `apps/api/src/index.ts` | ADAPT | `@pt-api/src/index.ts` | 07 |
| `apps/api/src/constants/queue.ts` | ADAPT | `@pt-api/src/constants/queue.ts` | 08 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 08 |
| `apps/api/src/config/gmail.ts` | COPY | `@pt-api/src/config/gmail.ts` | 08 |
| `apps/api/src/services/gmail.service.ts` | COPY | `@pt-api/src/services/gmail.service.ts` | 08 |
| `apps/api/src/controllers/gmailAuth.controller.ts` | COPY | `@pt-api/src/controllers/gmailAuth.controller.ts` | 08 |
| `apps/api/src/routes/gmail.route.ts` | COPY | `@pt-api/src/routes/gmail.route.ts` | 08 |
| `apps/api/src/utils/email/emailTemplates.ts` | ADAPT | `@pt-api/src/utils/email/emailTemplates.ts` | 08 |
| `apps/api/src/utils/email/html_templates.ts` | ADAPT | `@pt-api/src/utils/email/html_templates.ts` | 08 |
| `apps/api/src/utils/email/devMailbox.ts` | COPY | `@pt-api/src/utils/email/devMailbox.ts` | 08 |
| `apps/api/src/utils/email/index.ts` | COPY | `@pt-api/src/utils/email/index.ts` | 08 |
| `apps/api/src/jobs/redis/connection.ts` | COPY | `@pt-api/src/jobs/redis/connection.ts` | 08 |
| `apps/api/src/jobs/interfaces/jobPayload.ts` | ADAPT | `@pt-api/src/jobs/interfaces/jobPayload.ts` | 08 |
| `apps/api/src/jobs/queues/email.queue.ts` | COPY | `@pt-api/src/jobs/queues/email.queue.ts` | 08 |
| `apps/api/src/jobs/queues/deadLetter.queue.ts` | COPY | `@pt-api/src/jobs/queues/deadLetter.queue.ts` | 08 |
| `apps/api/src/jobs/queues/maintenance.queue.ts` | COPY | `@pt-api/src/jobs/queues/maintenance.queue.ts` | 08 |
| `apps/api/src/jobs/producers/email.producer.ts` | ADAPT | `@pt-api/src/jobs/producers/email.producer.ts` | 08 |
| `apps/api/src/jobs/processors/email.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/email.processor.ts` | 08 |
| `apps/api/src/jobs/processors/purgeExpired.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/purgeExpired.processor.ts` | 08 |
| `apps/api/src/jobs/workers/email.worker.ts` | ADAPT | `@pt-api/src/jobs/workers/email.worker.ts` | 08 |
| `apps/api/src/jobs/workers/maintenance.worker.ts` | ADAPT | `@pt-api/src/jobs/workers/maintenance.worker.ts` | 08 |
| `apps/api/src/jobs/deadLetter.ts` | ADAPT | `@pt-api/src/jobs/deadLetter.ts` | 08 |
| `apps/api/src/jobs/dashboard/bull-board.ts` | ADAPT | `@pt-api/src/jobs/dashboard/bull-board.ts` | 08 |
| `apps/api/src/services/auth.service.ts` | ADAPT | — | 08 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | — | 08 |
| `apps/api/src/worker.ts` | ADAPT | `@pt-api/src/worker.ts` | 08 |
| `apps/api/src/index.ts` | ADAPT | — | 08 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 08 |
| `apps/api/src/db/prisma.ts` | ADAPT | `@pt-api/src/db/prisma.ts` | 10 |
| `apps/api/src/constants/permissions.ts` | ADAPT | `@pt-api/src/constants/permissions.ts` | 10 |
| `apps/api/src/middleware/resolveOrg.ts` | ADAPT | `@pt-api/src/middleware/resolveOrg.ts` | 10 |
| `apps/api/src/middleware/requireOrgRole.ts` | COPY | `@pt-api/src/middleware/requireOrgRole.ts` | 10 |
| `apps/api/src/services/org.service.ts` | ADAPT | `@pt-api/src/services/org.service.ts` | 10 |
| `apps/api/src/services/member.service.ts` | COPY | `@pt-api/src/services/member.service.ts` | 10 |
| `apps/api/src/services/audit.service.ts` | COPY | `@pt-api/src/services/audit.service.ts` | 10 |
| `apps/api/src/services/deletion.service.ts` | NEW | — | 10 |
| `apps/api/src/utils/actor.ts` | ADAPT | `@pt-api/src/utils/actor.ts` | 10 |
| `apps/api/src/controllers/{org,member}.controller.ts` | ADAPT | `@pt-api/src/controllers/{org,member}.controller.ts` | 10 |
| `apps/api/src/routes/{org,member}.route.ts` | ADAPT | `@pt-api/src/routes/{org,member}.route.ts` | 10 |
| `apps/api/src/types/express.d.ts` | ADAPT | — | 10 |
| `apps/api/src/scripts/check-tenancy.ts` | NEW | — | 10 |
| `apps/api/src/app.ts` | ADAPT | — | 10 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 11 |
| `apps/api/src/services/invite.service.ts` | ADAPT | `@pt-api/src/services/invite.service.ts` | 11 |
| `apps/api/src/controllers/invite.controller.ts` | ADAPT | `@pt-api/src/controllers/invite.controller.ts` | 11 |
| `apps/api/src/routes/invite.route.ts` | ADAPT | `@pt-api/src/routes/invite.route.ts` | 11 |
| `apps/api/src/routes/org.route.ts` | ADAPT | — | 11 |
| `apps/api/src/config/rateLimiter.ts` | ADAPT | `@pt-api/src/config/rateLimiter.ts` | 11 |
| `apps/api/src/jobs/producers/email.producer.ts` | ADAPT | `@pt-api/src/jobs/producers/email.producer.ts` | 11 |
| `apps/api/src/jobs/processors/email.processor.ts` | ADAPT | — | 11 |
| `apps/api/src/constants/queue.ts` | ADAPT | — | 11 |
| `apps/api/src/utils/email/{emailTemplates,html_templates}.ts` | ADAPT | `@pt-api/src/utils/email/` | 11 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 12 |
| `apps/api/src/services/org.service.ts` | ADAPT | — | 12 |
| `apps/api/src/services/infoSheet.service.ts` | NEW | — | 12 |
| `apps/api/src/controllers/infoSheet.controller.ts` | NEW | — | 12 |
| `apps/api/src/routes/infoSheet.route.ts` | NEW | — | 12 |
| `apps/api/src/scripts/seed-demo-business.ts` | NEW | — | 12 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 13 |
| `apps/api/src/constants/messageStatus.ts` | NEW | — | 13 |
| `apps/api/src/services/outbox.service.ts` | COPY | `@pt-api/src/services/outbox.service.ts` | 13 |
| `apps/api/src/types/outbox.types.ts` | COPY | `@pt-api/src/types/outbox.types.ts` | 13 |
| `apps/api/src/jobs/outbox/relay.ts` | COPY | `@pt-api/src/jobs/outbox/relay.ts` | 13 |
| `apps/api/src/jobs/outbox/dispatchers.ts` | ADAPT | `@pt-api/src/jobs/outbox/dispatchers.ts` | 13 |
| `apps/api/src/services/intake.service.ts` | NEW | — | 13 |
| `apps/api/src/services/intakeForm.service.ts` | NEW | — | 13 |
| `apps/api/src/services/message.service.ts` | NEW | — | 13 |
| `apps/api/src/middleware/intakeCors.ts` | NEW | — | 13 |
| `apps/api/src/controllers/{intake,intakeForm}.controller.ts` | NEW | — | 13 |
| `apps/api/src/routes/intake.route.ts` | NEW | — | 13 |
| `apps/api/src/routes/intakeForm.route.ts` | NEW | — | 13 |
| `apps/api/src/worker.ts · index.ts` | ADAPT | `@pt-api/src/{worker,index}.ts` | 13 |
| `apps/api/src/app.ts` | ADAPT | — | 13 |
| `apps/api/src/routes/widget.route.ts` | NEW | — | 14 |
| `apps/api/src/app.ts` | ADAPT | — | 14 |
| `apps/api/src/ai/types.ts` | ADAPT | `@pt-api/src/ai/types.ts` | 15 |
| `apps/api/src/ai/errors.ts` | COPY | `@pt-api/src/ai/errors.ts` | 15 |
| `apps/api/src/ai/reliability.ts` | COPY | `@pt-api/src/ai/reliability.ts` | 15 |
| `apps/api/src/ai/modelJson.ts` | COPY | `@pt-api/src/ai/modelJson.ts` | 15 |
| `apps/api/src/ai/breakers.ts` | COPY | `@pt-api/src/ai/breakers.ts` | 15 |
| `apps/api/src/ai/concurrency.ts` | COPY | `@pt-api/src/ai/concurrency.ts` | 15 |
| `apps/api/src/ai/llm.ts` | ADAPT | `@pt-api/src/ai/llm.ts` | 15 |
| `apps/api/src/ai/providers/nvidia.ts` | ADAPT | `@pt-api/src/ai/providers/nvidia.ts` | 15 |
| `apps/api/src/ai/providers/fake.ts` | ADAPT | `@pt-api/src/ai/providers/fake.ts` | 15 |
| `apps/api/src/ai/providers/replay.ts` | ADAPT | `@pt-api/src/ai/providers/replay.ts` | 15 |
| `apps/api/src/ai/prompts/index.ts` | ADAPT | `@pt-api/src/ai/prompts/index.ts` | 15 |
| `apps/api/src/constants/llm.ts` | ADAPT | `@pt-api/src/constants/llm.ts` | 15 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 15 |
| `apps/api/src/scripts/try-llm.ts` | NEW | — | 15 |
| `apps/api/src/ai/prompts/delimit.ts` | NEW | — | 16 |
| `apps/api/src/ai/prompts/delimit.test.ts` | NEW | — | 16 |
| `apps/api/src/ai/prompts/classify.v1.ts` | NEW | `@pt-api/src/ai/prompts/classify.v1.ts` | 16 |
| `apps/api/src/ai/prompts/index.ts` | ADAPT | — | 16 |
| `apps/api/src/pipeline/repair.ts` | NEW | — | 16 |
| `apps/api/src/pipeline/classify.ts` | NEW | — | 16 |
| `apps/api/src/pipeline/classify.test.ts` | NEW | — | 16 |
| `apps/api/src/scripts/try-pipeline.ts` | NEW | — | 16 |
| `apps/api/src/ai/prompts/extract.v1.ts` | NEW | — | 17 |
| `apps/api/src/ai/prompts/index.ts` | ADAPT | — | 17 |
| `apps/api/src/pipeline/localTime.ts` | NEW | — | 17 |
| `apps/api/src/pipeline/postExtract.ts` | NEW | — | 17 |
| `apps/api/src/pipeline/postExtract.test.ts` | NEW | — | 17 |
| `apps/api/src/pipeline/extract.ts` | NEW | — | 17 |
| `apps/api/src/scripts/try-pipeline.ts` | ADAPT | — | 17 |
| `apps/api/src/pipeline/renderInfo.ts` | NEW | — | 18 |
| `apps/api/src/pipeline/selectInfo.ts` | NEW | — | 18 |
| `apps/api/src/pipeline/selectInfo.test.ts` | NEW | — | 18 |
| `apps/api/src/pipeline/textMatch.ts` | NEW | — | 18 |
| `apps/api/src/scripts/try-pipeline.ts` | ADAPT | — | 18 |
| `apps/api/src/ai/prompts/draftSections.ts` | NEW | — | 19 |
| `apps/api/src/ai/prompts/draft.v1.ts` | NEW | — | 19 |
| `apps/api/src/ai/prompts/index.ts` | ADAPT | — | 19 |
| `apps/api/src/pipeline/language.ts` | NEW | — | 19 |
| `apps/api/src/pipeline/postDraft.ts` | NEW | — | 19 |
| `apps/api/src/pipeline/draft.ts` | NEW | — | 19 |
| `apps/api/src/pipeline/draft.test.ts` | NEW | — | 19 |
| `apps/api/src/scripts/try-pipeline.ts` | ADAPT | — | 19 |
| `apps/api/src/pipeline/localTime.ts` | ADAPT | — | 20 |
| `apps/api/src/pipeline/checks/mentions.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/recognisers.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/allowed.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/numbers.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/phrases.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/length.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/sensitive.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/injection.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/index.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/__tests__/recognisers.test.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/__tests__/phrases.test.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/__tests__/sensitive.test.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/__tests__/runChecks.test.ts` | NEW | — | 20 |
| `apps/api/src/pipeline/checks/__tests__/fixtures/{planted,clean}.ts` | NEW | — | 20 |
| `apps/api/src/scripts/try-pipeline.ts` | ADAPT | — | 20 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 21 |
| `apps/api/src/constants/queue.ts` | ADAPT | `@pt-api/src/constants/queue.ts` | 21 |
| `apps/api/src/constants/messageStatus.ts` | NEW | `@pt-api/src/constants/documentStatus.ts` | 21 |
| `apps/api/src/pipeline/processMessage.ts` | NEW | — | 21 |
| `apps/api/src/services/message.service.ts` | ADAPT | `@pt-api/src/services/document.service.ts` | 21 |
| `apps/api/src/services/aiResult.service.ts` | NEW | — | 21 |
| `apps/api/src/services/modelCall.service.ts` | NEW | — | 21 |
| `apps/api/src/services/dlq.service.ts` | ADAPT | `@pt-api/src/services/dlq.service.ts` | 21 |
| `apps/api/src/controllers/{dlq,events,message}.controller.ts` | ADAPT | `@pt-api/src/controllers/{dlq,events}.controller.ts` | 21 |
| `apps/api/src/routes/{dlq,events,message}.route.ts` | ADAPT | `@pt-api/src/routes/{dlq,events}.route.ts` | 21 |
| `apps/api/src/jobs/queues/{pipeline,deadLetter}.queue.ts` | NEW | `@pt-api/src/jobs/queues/deadLetter.queue.ts` | 21 |
| `apps/api/src/jobs/producers/pipeline.producer.ts` | NEW | — | 21 |
| `apps/api/src/jobs/processors/processMessage.processor.ts` | NEW | — | 21 |
| `apps/api/src/jobs/workers/pipeline.worker.ts` | NEW | `@pt-api/src/jobs/workers/document.worker.ts` | 21 |
| `apps/api/src/jobs/deadLetter.ts` | ADAPT | `@pt-api/src/jobs/deadLetter.ts` | 21 |
| `apps/api/src/jobs/outbox/dispatchers.ts` | ADAPT | — | 21 |
| `apps/api/src/utils/events/{pubsub,sse,streamLimiter}.ts` | ADAPT | `@pt-api/src/utils/events/` | 21 |
| `apps/api/src/worker.ts` | ADAPT | — | 21 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 22 |
| `apps/api/src/constants/pricing.ts` | ADAPT | `@pt-api/src/constants/pricing.ts` | 22 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 22 |
| `apps/api/src/utils/cost.ts` | COPY | `@pt-api/src/utils/cost.ts` | 22 |
| `apps/api/src/ai/llm.ts` | ADAPT | — | 22 |
| `apps/api/src/services/budget.service.ts` | ADAPT | `@pt-api/src/services/quota.service.ts` | 22 |
| `apps/api/src/services/usage.service.ts` | ADAPT | `@pt-api/src/services/usage.service.ts` | 22 |
| `apps/api/src/services/modelCall.service.ts` | ADAPT | — | 22 |
| `apps/api/src/jobs/processors/processMessage.processor.ts` | ADAPT | — | 22 |
| `apps/api/src/controllers/usage.controller.ts` | ADAPT | `@pt-api/src/controllers/usage.controller.ts` | 22 |
| `apps/api/src/routes/usage.route.ts` | ADAPT | `@pt-api/src/routes/usage.route.ts` | 22 |
| `apps/api/src/routes/message.route.ts` | ADAPT | — | 22 |
| `apps/api/src/jobs/producers/email.producer.ts` | ADAPT | `@pt-api/src/jobs/producers/email.producer.ts` | 22 |
| `apps/api/src/utils/email/emailTemplates.ts` | ADAPT | — | 22 |
| `apps/api/src/services/message.service.ts` | ADAPT | — | 23 |
| `apps/api/src/services/infoSheet.service.ts` | ADAPT | — | 23 |
| `apps/api/src/controllers/message.controller.ts` | ADAPT | — | 23 |
| `apps/api/src/routes/message.route.ts` | ADAPT | — | 23 |
| `apps/api/src/scripts/seed-messages.ts` | NEW | — | 23 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 24 |
| `apps/api/src/services/audit.service.ts` | COPY | `@pt-api/src/services/audit.service.ts` | 24 |
| `apps/api/src/services/outbox.service.ts` | COPY | `@pt-api/src/services/outbox.service.ts` | 24 |
| `apps/api/src/services/approval.service.ts` | NEW | — | 24 |
| `apps/api/src/services/send.service.ts` | NEW | — | 24 |
| `apps/api/src/services/editExport.service.ts` | NEW | — | 24 |
| `apps/api/src/utils/text/wordDiff.ts (+ .test.ts)` | NEW | — | 24 |
| `apps/api/src/jobs/queues/sendReply.queue.ts` | NEW | `@pt-api/src/jobs/queues/maintenance.queue.ts` | 24 |
| `apps/api/src/jobs/processors/sendReply.processor.ts` | NEW | — | 24 |
| `apps/api/src/jobs/workers/sendReply.worker.ts` | NEW | `@pt-api/src/jobs/workers/email.worker.ts` | 24 |
| `apps/api/src/jobs/outbox/dispatchers.ts` | ADAPT | `@pt-api/src/jobs/outbox/dispatchers.ts` | 24 |
| `apps/api/src/constants/queue.ts` | ADAPT | — | 24 |
| `apps/api/src/constants/appErrorCode.ts` | ADAPT | — | 24 |
| `apps/api/src/controllers/reply.controller.ts` | NEW | — | 24 |
| `apps/api/src/routes/message.route.ts` | ADAPT | — | 24 |
| `apps/api/src/utils/crypto/secretBox.ts` | ADAPT | `@pt-api/src/utils/crypto/secretBox.ts` | 25 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 25 |
| `apps/api/src/config/gmail.ts` | ADAPT | `@pt-api/src/config/gmail.ts` | 25 |
| `apps/api/src/utils/email/mime.ts` | NEW | `@pt-api/src/services/gmail.service.ts` | 25 |
| `apps/api/src/services/gmail.service.ts` | ADAPT | — | 25 |
| `apps/api/src/utils/email/parseInbound.ts (+ .test.ts)` | NEW | — | 25 |
| `apps/api/src/utils/oauthState.ts` | NEW | — | 25 |
| `apps/api/src/services/gmailChannel.service.ts` | NEW | — | 25 |
| `apps/api/src/controllers/gmailChannel.controller.ts` | NEW | — | 25 |
| `apps/api/src/routes/gmailChannel.route.ts` | NEW | — | 25 |
| `apps/api/src/jobs/queues/gmailPoll.queue.ts · processors/gmailPoll.processor.ts · workers/gmailPoll.worker.ts` | NEW | — | 25 |
| `apps/api/src/services/send.service.ts` | ADAPT | — | 25 |
| `apps/api/src/utils/email/gmailTransport.ts` | NEW | — | 25 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 25 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 26 |
| `apps/api/src/utils/date/zoned.ts (+ .test.ts)` | NEW | — | 26 |
| `apps/api/src/pipeline/templates/bookingReplies.ts (+ .test.ts)` | NEW | — | 26 |
| `apps/api/src/services/booking.service.ts` | NEW | — | 26 |
| `apps/api/src/jobs/processors/processMessage.processor.ts` | ADAPT | — | 26 |
| `apps/api/src/services/approval.service.ts` | ADAPT | — | 26 |
| `apps/api/src/controllers/booking.controller.ts · routes/booking.route.ts` | NEW | — | 26 |
| `apps/api/src/services/stats.service.ts` | NEW | `@pt-api/src/services/quality.service.ts` | 27 |
| `apps/api/src/services/topEdits.service.ts` | NEW | — | 27 |
| `apps/api/src/utils/ratio.ts` | COPY | `@pt-api/src/utils/ratio.ts` | 27 |
| `apps/api/src/utils/text/wordDiff.ts` | ADAPT | — | 27 |
| `apps/api/src/controllers/stats.controller.ts · routes/stats.route.ts` | NEW | — | 27 |
| `apps/api/src/services/approval.service.ts` | ADAPT | — | 27 |
| `apps/api/src/services/booking.service.ts` | ADAPT | — | 27 |
| `apps/api/src/jobs/processors/sendReply.processor.ts` | ADAPT | — | 27 |
| `apps/api/src/jobs/processors/processMessage.processor.ts` | ADAPT | — | 27 |
| `apps/api/src/scripts/seed-stats.ts` | NEW | — | 27 |
| `apps/api/src/utils/pii.ts` | ADAPT | — | 28 |
| `apps/api/src/services/audit.service.ts` | ADAPT | — | 28 |
| `apps/api/src/services/deletion.service.ts` | ADAPT | `@pt-api/src/services/deletion.service.ts` | 28 |
| `apps/api/src/services/privacy.service.ts` | NEW | — | 28 |
| `apps/api/src/jobs/processors/retention.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/retention.processor.ts` | 28 |
| `apps/api/src/jobs/processors/purgeExpired.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/purgeExpired.processor.ts` | 28 |
| `apps/api/src/worker.ts` | ADAPT | — | 28 |
| `apps/api/src/controllers/privacy.controller.ts · routes/privacy.route.ts` | NEW | — | 28 |
| `apps/api/src/routes/message.route.ts` | ADAPT | — | 28 |
| `apps/api/src/test/deletion.int.test.ts` | NEW | — | 28 |
| `apps/api/src/ai/prompts/classify.v2.ts · extract.v2.ts · draft.v2.ts …` | NEW | — | 30 |
| `apps/api/src/ai/prompts/draft-ungrounded.v1.ts · draft-facts-no-rule.v1.ts · draft-undefended.v1.ts · giant.v1.ts` | NEW | — | 30 |
| `apps/api/src/ai/prompts/judge.v1.ts` | NEW | — | 30 |
| `apps/api/src/ai/prompts/index.ts` | ADAPT | — | 30 |
| `apps/api/src/instrument.ts` | ADAPT | `@pt-api/src/instrument.ts` | 32 |
| `apps/api/src/utils/tracing.ts` | ADAPT | `@pt-api/src/utils/tracing.ts` | 32 |
| `apps/api/src/routes/widget.route.ts` | ADAPT | — | 32 |
| `apps/api/src/scripts/seed-demo.ts` | NEW | — | 33 |

## apps/api/evals

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/evals/fixtures/codenest.json` | NEW | — | 12 |
| `apps/api/evals/cache/` | NEW | — | 15 |
| `apps/api/evals/prompt-lab/classify.v1.md` | NEW | — | 16 |
| `apps/api/evals/prompt-lab/extract.v1.md` | NEW | — | 17 |
| `apps/api/evals/prompt-lab/extract.task.json` | NEW | — | 17 |
| `apps/api/evals/prompt-lab/draft.v1.md` | NEW | — | 19 |
| `apps/api/evals/messages.jsonl` | NEW | — | 29 |
| `apps/api/evals/split.ts` | NEW | — | 29 |
| `apps/api/evals/LABELLING.md` | NEW | — | 29 |
| `apps/api/evals/sets/planted-drafts.jsonl` | NEW | — | 29 |
| `apps/api/evals/labels-second-pass.jsonl` | NEW | — | 29 |
| `apps/api/evals/reviews/<runId>.jsonl` | NEW | — | 29 |
| `apps/api/evals/reports/` | NEW | — | 29 |
| `apps/api/evals/run.ts` | ADAPT | `@pt-api/evals/run.ts` | 29 |
| `apps/api/evals/metrics.ts (+ metrics.test.ts)` | ADAPT | `@pt-api/evals/metrics.ts` | 29 |
| `apps/api/evals/report.ts` | NEW | — | 29 |
| `apps/api/evals/review.ts` | NEW | — | 29 |
| `apps/api/evals/agreement.ts` | NEW | — | 29 |
| `apps/api/evals/update-readme.ts` | ADAPT | `@pt-api/evals/update-readme.ts` | 29 |
| `apps/api/evals/export-prompt-lab.ts` | NEW | — | 30 |
| `apps/api/evals/prompt-lab/{enquiry-classify,enquiry-extract}/{task.json,examples.jsonl,prompts/*.md}` | NEW | — | 30 |
| `apps/api/evals/adapters/giant.ts (+ test)` | NEW | — | 30 |
| `apps/api/evals/judge.ts` | NEW | — | 30 |
| `apps/api/evals/variance.ts` | ADAPT | `@pt-api/evals/variance.ts` | 30 |
| `apps/api/evals/sets/injection.jsonl` | NEW | — | 30 |
| `apps/api/evals/sets/bias-pairs.jsonl` | NEW | — | 30 |
| `apps/api/evals/sets/bias-pairs.README.md` | NEW | — | 30 |
| `apps/api/evals/EXPERIMENT.md` | NEW | — | 30 |
| `apps/api/evals/FROZEN.json` | NEW | — | 30 |
| `apps/api/evals/run.ts` | ADAPT | — | 30 |
| `apps/api/evals/metrics.ts` | ADAPT | — | 30 |
| `apps/api/evals/gate.ts` | ADAPT | `@pt-api/evals/gate.ts` | 32 |
| `apps/api/evals/baseline.json` | NEW | — | 32 |

## apps/api/test

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/test/tenancy.routes.ts` | NEW | — | 10 |
| `apps/api/test/tenancy.routes.ts` | ADAPT | — | 11 |
| `apps/api/test/tenancy.routes.ts` | ADAPT | — | 12 |
| `apps/api/test/tenancy.routes.ts` | ADAPT | — | 13 |
| `apps/api/test/fixtures/llm/` | NEW | — | 15 |
| `apps/api/test/globalSetup.ts` | ADAPT | `@pt-api/test/globalSetup.ts` | 31 |
| `apps/api/test/setupEnv.ts` | ADAPT | `@pt-api/test/setupEnv.ts` | 31 |
| `apps/api/test/helpers/{app,auth,db,queues}.ts` | ADAPT | `@pt-api/test/helpers/` | 31 |
| `apps/api/test/helpers/fakeLlm.ts` | ADAPT | `@pt-api/test/helpers/fakeLlm.ts` | 31 |
| `apps/api/test/helpers/logCapture.ts` | NEW | — | 31 |
| `apps/api/test/helpers/fakeGmail.ts` | NEW | — | 31 |
| `apps/api/test/health.int.test.ts` | ADAPT | `@pt-api/test/health.int.test.ts` | 31 |
| `apps/api/test/auth.int.test.ts` | ADAPT | `@pt-api/test/auth.int.test.ts` | 31 |
| `apps/api/test/roles.int.test.ts` | ADAPT | `@pt-api/test/roles.int.test.ts` | 31 |
| `apps/api/test/tenancy.cross-org.int.test.ts` | ADAPT | `@pt-api/test/tenancy.cross-org.int.test.ts` | 31 |
| `apps/api/test/security/injection.int.test.ts` | ADAPT | `@pt-api/test/security/injection.int.test.ts` | 31 |
| `apps/api/test/security/limits.int.test.ts` | ADAPT | `@pt-api/test/security/limits.int.test.ts` | 31 |
| `apps/api/test/intake.int.test.ts` | NEW | — | 31 |
| `apps/api/test/outbox.int.test.ts` | NEW | — | 31 |
| `apps/api/test/pipeline.int.test.ts` | NEW | — | 31 |
| `apps/api/test/approval.int.test.ts` | NEW | — | 31 |
| `apps/api/test/noAutoSend.test.ts` | NEW | — | 31 |
| `apps/api/test/retention.int.test.ts` | NEW | — | 31 |
| `apps/api/test/logs.int.test.ts` | NEW | — | 31 |

## apps/web

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/web/README.md` | NEW | — | 00 |
| `apps/web/package.json` | ADAPT | `@pt-web/package.json` | 09 |
| `apps/web/next.config.ts` | ADAPT | `@pt-web/next.config.ts` | 09 |
| `apps/web/tsconfig.json` | COPY | `@pt-web/tsconfig.json` | 09 |
| `apps/web/postcss.config.mjs` | COPY | `@pt-web/postcss.config.mjs` | 09 |
| `apps/web/components.json` | COPY | `@pt-web/components.json` | 09 |
| `apps/web/eslint.config.mjs` | COPY | `@pt-web/eslint.config.mjs` | 09 |
| `apps/web/.env.example` | NEW | — | 09 |
| `apps/web/src/constants/env.ts` | COPY | `@pt-web/src/constants/env.ts` | 09 |
| `apps/web/src/utils/appError.ts` | COPY | `@pt-web/src/utils/appError.ts` | 09 |
| `apps/web/src/types/{index,api.types,auth.types,user.types,ui.types}.ts` | COPY | `@pt-web/src/types/` | 09 |
| `apps/web/src/lib/api.ts` | ADAPT | `@pt-web/src/lib/api.ts` | 09 |
| `apps/web/src/lib/queryClient.ts` | ADAPT | `@pt-web/src/lib/queryClient.ts` | 09 |
| `apps/web/src/lib/serverStatus.ts` | COPY | `@pt-web/src/lib/serverStatus.ts` | 09 |
| `apps/web/src/lib/errorMessage.ts` | COPY | `@pt-web/src/lib/errorMessage.ts` | 09 |
| `apps/web/src/lib/utils.ts` | COPY | `@pt-web/src/lib/utils.ts` | 09 |
| `apps/web/src/lib/google/{google.d.ts,loadGsi.ts}` | COPY | `@pt-web/src/lib/google/` | 09 |
| `apps/web/src/store/{auth.store,server.store}.ts` | COPY | `@pt-web/src/store/` | 09 |
| `apps/web/src/api/{auth,session}.ts` | COPY | `@pt-web/src/api/` | 09 |
| `apps/web/src/hooks/auth/*.ts` | COPY | `@pt-web/src/hooks/auth/` | 09 |
| `apps/web/src/hooks/account/useAccountSessions.ts` | COPY | `@pt-web/src/hooks/account/useAccountSessions.ts` | 09 |
| `apps/web/src/components/ui/*` | COPY | `@pt-web/src/components/ui/` | 09 |
| `apps/web/src/components/common/{QueryDevtools,RouteFallback,ServerWakeNotice}.tsx` | COPY | `@pt-web/src/components/common/` | 09 |
| `apps/web/src/components/auth/{AuthLoader,RequireAuth,GuestOnly,GoogleSignInButton}.tsx` | COPY | — | 09 |
| `apps/web/src/components/layout/RoleGuard.tsx` | COPY | `@pt-web/src/components/layout/RoleGuard.tsx` | 09 |
| `apps/web/src/app/layout.tsx` | ADAPT | `@pt-web/src/app/layout.tsx` | 09 |
| `apps/web/src/app/providers.tsx` | COPY | `@pt-web/src/app/providers.tsx` | 09 |
| `apps/web/src/app/globals.css` | COPY | `@pt-web/src/app/globals.css` | 09 |
| `apps/web/src/app/page.tsx` | ADAPT | `@pt-web/src/app/page.tsx` | 09 |
| `apps/web/src/app/(public)/layout.tsx` | COPY | `@pt-web/src/app/(public)/layout.tsx` | 09 |
| `apps/web/src/app/(public)/{login,register,password/forgot}/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(public)/auth/verify/[token]/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(public)/password/reset/[token]/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(app)/layout.tsx` | ADAPT | `@pt-web/src/app/(app)/layout.tsx` | 09 |
| `apps/web/src/app/(app)/inbox/page.tsx` | NEW | — | 09 |
| `apps/web/src/app/(app)/account/page.tsx` | COPY | `@pt-web/src/app/(app)/account/page.tsx` | 09 |
| `apps/web/src/api/org.ts` | ADAPT | `@pt-web/src/api/org.ts` | 10 |
| `apps/web/src/store/org.store.ts` | COPY | `@pt-web/src/store/org.store.ts` | 10 |
| `apps/web/src/hooks/org/useCurrentOrg.ts` | ADAPT | `@pt-web/src/hooks/org/useCurrentOrg.ts` | 10 |
| `apps/web/src/components/layout/OrgSwitcher.tsx` | ADAPT | `@pt-web/src/components/layout/OrgSwitcher.tsx` | 10 |
| `apps/web/src/app/(app)/layout.tsx` | ADAPT | `@pt-web/src/app/(app)/layout.tsx` | 10 |
| `apps/web/src/app/(app)/onboarding/page.tsx` | NEW | — | 10 |
| `apps/web/src/app/(app)/settings/team/page.tsx` | ADAPT | `@pt-web/src/app/(app)/settings/members/page.tsx` | 10 |
| `apps/web/src/api/org.ts` | ADAPT | `@pt-web/src/api/org.ts` | 11 |
| `apps/web/src/app/invites/page.tsx` | ADAPT | `@pt-web/src/app/invites/[token]/page.tsx` | 11 |
| `apps/web/src/app/(app)/settings/team/InvitesPanel.tsx` | ADAPT | `@pt-web/src/app/(app)/settings/members/page.tsx` | 11 |
| `apps/web/src/api/infoSheet.ts` | NEW | — | 12 |
| `apps/web/src/hooks/infoSheet/{useInfoEntries,useSaveInfoEntry,useDeleteInfoEntry,useReorderInfoEntries,useImportInfoSheet}.ts` | NEW | — | 12 |
| `apps/web/src/app/(app)/settings/business/page.tsx` | NEW | — | 12 |
| `apps/web/src/app/(app)/settings/info-sheet/page.tsx` | NEW | — | 12 |
| `apps/web/src/components/infoSheet/{EntryList,EntrySheet,ImportDialog,AiPreview}.tsx` | NEW | — | 12 |
| `apps/web/src/api/intakeForm.ts` | NEW | — | 14 |
| `apps/web/src/hooks/intakeForm/{useForms,useSaveForm,useRotateFormKey}.ts` | NEW | — | 14 |
| `apps/web/src/app/(app)/settings/website-form/page.tsx` | NEW | — | 14 |
| `apps/web/src/api/usage.ts · hooks/usage/useUsage.ts` | ADAPT | `@pt-web/src/api/usage.ts` | 22 |
| `apps/web/src/components/layout/UsageMeter.tsx` | ADAPT | `@pt-web/src/components/layout/UsageMeter.tsx` | 22 |
| `apps/web/src/app/(app)/settings/usage/page.tsx` | NEW | — | 22 |
| `apps/web/src/api/message.ts` | NEW | `@pt-web/src/api/document.ts` | 23 |
| `apps/web/src/hooks/messages/useMessages.ts` | ADAPT | `@pt-web/src/hooks/documents/useDocuments.ts` | 23 |
| `apps/web/src/hooks/messages/useMessage.ts` | ADAPT | `@pt-web/src/hooks/documents/useDocument.ts` | 23 |
| `apps/web/src/hooks/messages/useInboxEvents.ts` | ADAPT | `@pt-web/src/hooks/documents/useOrgEvents.ts` | 23 |
| `apps/web/src/hooks/messages/{useMessageCounts,useChecksPreview,useReprocess}.ts` | NEW | — | 23 |
| `apps/web/src/hooks/common/useShortcuts.ts` | NEW | `@pt-web/src/app/(app)/documents/[id]/page.tsx` | 23 |
| `apps/web/src/lib/messageStatus.ts` | ADAPT | `@pt-web/src/lib/documentStatus.ts` | 23 |
| `apps/web/src/app/(app)/inbox/page.tsx` | ADAPT | `@pt-web/src/app/(app)/inbox/page.tsx` | 23 |
| `apps/web/src/components/inbox/StatusTabs.tsx · CategoryChip.tsx · FlagDot.tsx` | NEW | — | 23 |
| `apps/web/src/components/inbox/MessageList.tsx · MessageRow.tsx` | NEW | — | 23 |
| `apps/web/src/components/inbox/MessageDetail.tsx · CustomerMessage.tsx · AttentionBanner.tsx` | NEW | — | 23 |
| `apps/web/src/components/inbox/ExtractedDetails.tsx` | ADAPT | `@pt-web/src/components/review/FieldRow.tsx` | 23 |
| `apps/web/src/components/inbox/UsedFacts.tsx · AttemptHistory.tsx` | NEW | — | 23 |
| `apps/web/src/components/inbox/CheckBanners.tsx` | ADAPT | `@pt-web/src/components/review/IssueBanners.tsx` | 23 |
| `apps/web/src/components/inbox/DraftEditor.tsx` | NEW | — | 23 |
| `apps/web/src/components/inbox/ActionBar.tsx · ShortcutHelp.tsx` | NEW | — | 23 |
| `apps/web/src/api/reply.ts · hooks/reply/{useApprove,useReject,useMarkSpam,useCheckDraft}.ts` | NEW | — | 24 |
| `apps/web/src/components/inbox/ApproveDialog.tsx` | ADAPT | `@pt-web/src/components/review/ApproveDialog.tsx` | 24 |
| `apps/web/src/components/inbox/ActivityTab.tsx` | ADAPT | `@pt-web/src/components/review/AuditTab.tsx` | 24 |
| `apps/web/src/app/(app)/settings/page.tsx` | ADAPT | — | 24 |
| `apps/web/src/app/(app)/settings/channels/page.tsx` | NEW | — | 25 |
| `apps/web/src/components/layout/ReauthBanner.tsx` | NEW | — | 25 |
| `apps/web/src/api/booking.ts · hooks/booking/{useBookings,usePrepareBookingReply,useApproveBookingReply,useSetBookingStatus}.ts` | NEW | — | 26 |
| `apps/web/src/app/(app)/bookings/page.tsx` | NEW | — | 26 |
| `apps/web/src/components/bookings/{WeekView,BookingTable,BookingActions,ClashHint}.tsx` | NEW | — | 26 |
| `apps/web/src/api/stats.ts · hooks/stats/useStats.ts` | NEW | — | 27 |
| `apps/web/src/app/(app)/stats/page.tsx` | ADAPT | `@pt-web/src/app/(app)/quality/page.tsx` | 27 |
| `apps/web/src/components/stats/{KpiTiles,CategoryBar,ReplyTimeTrend,FlagsBar,TopEditsTable,OverridesTable}.tsx` | NEW | — | 27 |
| `apps/web/src/app/(app)/settings/privacy/page.tsx` | NEW | — | 28 |
| `apps/web/src/components/privacy/{RetentionForm,EraseContactDialog,DataStatement}.tsx` | NEW | — | 28 |
| `apps/web/src/lib/mask.ts` | NEW | — | 28 |
| `apps/web/playwright.config.ts` | ADAPT | `@pt-web/playwright.config.ts` | 31 |
| `apps/web/e2e/global-setup.ts` | ADAPT | `@pt-web/e2e/global-setup.ts` | 31 |
| `apps/web/e2e/helpers/{signup,fakeLlm}.ts` | ADAPT | `@pt-web/e2e/helpers/` | 31 |
| `apps/web/e2e/fixtures/answers/` | NEW | — | 31 |
| `apps/web/e2e/fixtures/widget-host.html` | NEW | — | 31 |
| `apps/web/e2e/auth.spec.ts` | ADAPT | `@pt-web/e2e/auth.spec.ts` | 31 |
| `apps/web/e2e/tenancy.spec.ts` | ADAPT | `@pt-web/e2e/tenancy.spec.ts` | 31 |
| `apps/web/e2e/golden-path.spec.ts` | NEW | — | 31 |
| `apps/web/Dockerfile` | ADAPT | `@pt-web/Dockerfile` | 32 |
| `apps/web/next.config.ts` | ADAPT | `@pt-web/next.config.ts` | 32 |
| `apps/web/sentry.{client,server}.config.ts` | ADAPT | `@pt-web/sentry.{client,server}.config.ts` | 32 |

## apps/widget

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/widget/README.md` | NEW | — | 00 |
| `apps/widget/package.json` | ADAPT | `@cd-widget/package.json` | 14 |
| `apps/widget/tsconfig.json` | COPY | `@cd-widget/tsconfig.json` | 14 |
| `apps/widget/eslint.config.js` | COPY | `@cd-widget/eslint.config.js` | 14 |
| `apps/widget/vite.config.ts` | ADAPT | `@cd-widget/vite.config.ts` | 14 |
| `apps/widget/index.html` | ADAPT | `@cd-widget/index.html` | 14 |
| `apps/widget/src/main.ts` | ADAPT | `@cd-widget/src/main.ts` | 14 |
| `apps/widget/src/form.ts` | NEW | — | 14 |
| `apps/widget/src/validate.ts` | NEW | — | 14 |
| `apps/widget/src/validate.test.ts` | NEW | — | 14 |
| `apps/widget/src/api.ts` | ADAPT | `@cd-widget/src/api.ts` | 14 |
| `apps/widget/src/styles.ts` | ADAPT | `@cd-widget/src/styles.ts` | 14 |
| `apps/widget/src/ui.ts` | ADAPT | `@cd-widget/src/ui.ts` | 14 |
| `apps/widget/vite.config.ts` | ADAPT | — | 32 |

## .github

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | ADAPT | `@pt-root/.github/workflows/ci.yml` | 32 |
| `.github/workflows/eval.yml` | ADAPT | `@pt-root/.github/workflows/eval.yml` | 32 |


## Not copied (from inherited-architecture.md)

| Not copied | Why |
| --- | --- |
| PaperTrail documents, PDF pages, storage (R2/MinIO), validators for invoices, line items | Different domain. The *method* (deterministic checks after the model, grounded confidence) is reused for the safety checks |
| API keys, webhooks, idempotency-key middleware | No machine clients. Widget retries are deduped by `clientSubmissionId`, a unique index, not a middleware |
| The cheap-model cascade and extraction cache | Messages are unique; a cache would never hit. The "cheap model for classify/extract" choice is a per-purpose model setting instead |
| Quotas on pages, fair scheduling lanes | One kind of job, small; a monthly cost budget is enough |
| CounselDesk RAG and embeddings | The info sheet is small. Selection is by type + keyword (Phase 18). Retrieval is a later improvement |

## Path check

Every `@…/` source path cited in `docs/` (outside the archive) must exist. Run from the repo root:

```bash
#!/usr/bin/env bash
# docs/reference/copy-map.md: check every cited source path exists.
declare -A ROOT=(
  [@ec-root]=~/Code/e-commerce [@ec-api]=~/Code/e-commerce/apps/backends/mongo [@ec-web]=~/Code/e-commerce/apps/client
  [@pt-root]=~/Code/paper-trail [@pt-api]=~/Code/paper-trail/apps/api [@pt-web]=~/Code/paper-trail/apps/web
  [@cd-widget]=~/Code/counseldesk/apps/widget
  [@pl-docs]=~/Code/prompt-lab/docs [@pb-docs]=~/Code/prompt-engineering-playbook/docs
)
missing=0; checked=0
while IFS= read -r ref; do
  key=${ref%%/*}; rest=${ref#*/}; base=${ROOT[$key]:-}
  [ -z "$base" ] && continue
  case "$rest" in *...*|*\<*) continue ;; esac              # placeholders, not paths
  # strip trailing punctuation; keep a ")" that closes a "(" in the path, e.g. app/(public)
  while [[ "$rest" =~ [\),\;:.]$ ]]; do
    opens=${rest//[^(]/}; closes=${rest//[^)]/}
    [[ "$rest" == *")" && ${#opens} -ge ${#closes} ]] && break
    rest=${rest%?}
  done
  [ -z "$rest" ] && rest=.
  # expand {a,b} lists; escape ( ) [ ] so eval and globbing leave them literal
  esc=$(printf '%s' "$rest" | sed -e 's/[][()]/\\&/g')
  for p in $(eval "echo $base/$esc"); do
    checked=$((checked+1))
    if [[ "$p" == *"*"* ]]; then compgen -G "$p" >/dev/null && continue
    else [ -e "$p" ] && continue; fi
    echo "MISSING $ref → $p"; missing=$((missing+1))
  done
done < <(grep -rhoE '@(ec|pt|cd|pl|pb)-[a-z]+/[^ `|]*' docs --include=*.md --exclude-dir=_archive-2026-10-24 | sort -u)
echo "checked $checked paths, missing $missing"
[ $missing -eq 0 ]
```
