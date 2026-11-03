# Tracker — AI Enquiry Assistant

Legend: ✅ done+verified · 🟡 built, check pending · ⬜ not started · 👤 needs the owner

## Parts
| Phase | Topic | Status | Evidence |
| --- | --- | --- | --- |
| 00 | Monorepo, packages, docker-compose | ✅ | `pnpm build/typecheck/lint` green; copied configs/types `diff` identical to PaperTrail; 3 healthy containers, policies noeviction / volatile-lru, PostgreSQL 17.11 |
| 01 | API bootstrap: env, errors, envelope, createApp, health, shutdown | ✅ | `/health` + 404 + malformed-JSON(400)/too-large(413) in envelope; boot fails on missing CORS_ORIGIN; SIGINT shutdown lines; hung connection force-exited at 10s; COPY files identical; typecheck+lint green |
| 02–09 | Logging, Postgres/Prisma, auth, limiter, cache, queue + email, web | ⬜ | |
| 10–14 | Businesses, invites, info sheet, intake + outbox, widget | ⬜ | |
| 15–22 | Model layer, classify, extract, info selection, draft, safety checks, pipeline, cost | ⬜ 👤 NVIDIA key | |
| 23–28 | Inbox, approve/send, Gmail channel, bookings, stats, privacy | ⬜ 👤 Gmail OAuth | |
| 29–33 | Eval set, Prompt Lab iteration + Playbook variants, tests, deploy, ship + pilot | ⬜ 👤 labels, pilot | |

## Next steps
1. Phase 02 (logging, PII redaction).

## Known limits (for README/ADRs)
- _(add as found)_
