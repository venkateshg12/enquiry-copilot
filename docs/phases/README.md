# AI Enquiry Assistant — build phases

Follow the phases in order. Each one leaves the app runnable and ends with **Verify** and a
**Definition of done**. Tick a phase here only when every box in its Definition of done is ticked.

Reference projects (read-only): `~/Code/paper-trail` (primary: the e-commerce architecture on
PostgreSQL + Prisma, implemented), `~/Code/e-commerce` (origin), `~/Code/counseldesk` (the widget),
`~/Code/prompt-lab` (evaluation method). Every **COPY / ADAPT / NEW** tag names its exact source with
a shorthand defined in [../reference/inherited-architecture.md](../reference/inherited-architecture.md).
The full list is in [../reference/copy-map.md](../reference/copy-map.md).

## Before you start

1. Read [../reference/architecture.md](../reference/architecture.md) end to end.
2. Read [../reference/inherited-architecture.md](../reference/inherited-architecture.md), then
   `~/Code/paper-trail/docs/reference/ecommerce-architecture.md` for the long version.
3. Before Part B: [../reference/data-model.md](../reference/data-model.md) and
   [../reference/data-handling.md](../reference/data-handling.md).
4. Before Part C: [../reference/pipeline-contracts.md](../reference/pipeline-contracts.md) and
   [../reference/safety-checks.md](../reference/safety-checks.md).
5. Every phase file has the same sections:
   1. **Goal**
   2. **What I will understand after this phase** (interview prep)
   3. **Prerequisites**
   4. **Files** (tree with COPY / ADAPT / NEW tags)
   5. **Concepts**
   6. **Steps**
   7. **Verify** (commands + expected output)
   8. **Definition of done**
   9. **Interview angle**
6. When a library's API in a phase disagrees with current docs, the docs win. Check with Context7
   (`resolve-library-id` → `query-docs`), fix the code, and note it in `tasks/lessons.md`.

## How these guides were checked

- Every `@pt-*`, `@ec-*`, `@cd-widget/`, `@pl-docs/` and `@pb-docs/` source path cited in `docs/`
  exists: the check script at the end of [../reference/copy-map.md](../reference/copy-map.md) ran on
  **2 November 2026** and reported `checked 398 paths, missing 0`. The copy map itself is generated
  from every phase's **Files** section (579 rows).
- Build gotchas found while building the Prompt Engineering Playbook on the same stack (2 Nov 2026)
  are folded into the phases where they bite: TypeScript/ESLint pins (00), `prisma migrate dev`
  needing `&& prisma generate` and `< /dev/null` (03), dynamic worker import (08), cache readiness and
  zombie sockets (07), no `:` in BullMQ job ids (08), retired NVIDIA models and 410/403 mapping (15),
  closing connections in CLI scripts (12).
- **Prisma is pinned to 7.10.1** (npm `latest` is an 8.0 release candidate), as in PaperTrail.
- PaperTrail's web app is on Next.js 15; npm's current major is 16. Phase 09 chooses **16** after
  checking the upgrade guide against the copied files (fallback: `next@^15`).
- The guides were **not executed** as a whole project. When reality differs from a Verify section,
  investigate the difference, fix it in your repo, and record it in `tasks/lessons.md`.

## Decisions fixed up front

| Decision | Result |
| --- | --- |
| Architecture | e-commerce → PaperTrail: pnpm + Turborepo, Express 5 (CommonJS + tsx), Redis ×2, BullMQ, Next.js + TanStack Query |
| Database | **PostgreSQL 17 + Prisma 7.10.1** (the spec's choice and PaperTrail's), UUIDv7, snake_case tables, tenant extension |
| Tenancy | **A business is a PaperTrail org**: owner/admin/reviewer/viewer, invites, live role checks. Names kept (`Org`, `orgId`) so tenancy files stay COPY |
| Intake | Embeddable form widget (from CounselDesk) + the business's Gmail inbox (history API polling) |
| Pipeline | One checkpointed BullMQ job per message: classify → extract → select info → draft → code checks |
| Sending | Only after a human approval: approval transaction + outbox → `send-reply` job → Gmail, threaded |
| Models | NVIDIA NIM: a cheap model for classify/extract, a stronger one for drafts, a fallback for each; `fake` + `replay` providers for tests |
| Facts | Info sheet only; code safety checks on every draft; strong flags need a reason to approve |
| Evaluation | A labelled message set (80–100), dev/test split, the eval runs the production code path; classify/extract compared in Prompt Lab |
| Hosting | Vercel (web), Render (API + worker), Neon (Postgres), two Redis instances |

## Status

### Part A — Foundation (copied)

- [x] 00 — [Monorepo, packages, docker-compose](phase-00-monorepo-setup.md)
- [x] 01 — [API bootstrap: env, errors, envelope, `createApp`, health, shutdown](phase-01-api-bootstrap.md)
- [ ] 02 — [Logging, request ids, PII redaction](phase-02-logging-pii-redaction.md)
- [ ] 03 — [PostgreSQL + Prisma: client, tenant extension, migrations](phase-03-postgres-prisma.md)
- [ ] 04 — [Accounts, sessions, refresh rotation, verification links](phase-04-accounts-sessions.md)
- [ ] 05 — [`authenticate`, `/auth/me`, device sessions, Google sign-in](phase-05-authenticate-google.md)
- [ ] 06 — [Rate limiting (+ intake limiters)](phase-06-rate-limiting.md)
- [ ] 07 — [Response cache](phase-07-response-cache.md)
- [ ] 08 — [BullMQ, DLQ and system email on the Gmail API](phase-08-queue-email.md)
- [ ] 09 — [Next.js web foundation](phase-09-web-foundation.md)

### Part B — Businesses and intake

- [ ] 10 — [Businesses, staff roles, audit log (PaperTrail orgs)](phase-10-businesses-roles.md)
- [ ] 11 — [Staff invitations](phase-11-invites.md)
- [ ] 12 — [Business profile and the info sheet](phase-12-info-sheet.md)
- [ ] 13 — [Messages, form intake, transactional outbox](phase-13-intake-outbox.md)
- [ ] 14 — [The embeddable contact-form widget](phase-14-widget.md)

### Part C — The AI pipeline

- [ ] 15 — [Model layer (PaperTrail's) + plain-text completions](phase-15-model-layer.md)
- [ ] 16 — [Classify](phase-16-classify.md)
- [ ] 17 — [Extract](phase-17-extract.md)
- [ ] 18 — [Info-sheet selection](phase-18-info-selection.md)
- [ ] 19 — [Draft](phase-19-draft.md)
- [ ] 20 — [Safety checks (code, not AI)](phase-20-safety-checks.md)
- [ ] 21 — [The pipeline job, AI results, SSE, DLQ](phase-21-pipeline.md)
- [ ] 22 — [Cost, usage and monthly budgets](phase-22-cost-budgets.md)

### Part D — Human in the loop

- [ ] 23 — [The approval inbox](phase-23-inbox.md)
- [ ] 24 — [Approve, edit, reject, send, activity log](phase-24-approve-send.md)
- [ ] 25 — [Gmail channel: intake and replies from the business address](phase-25-gmail-channel.md)
- [ ] 26 — [Booking requests](phase-26-bookings.md)
- [ ] 27 — [Stats](phase-27-stats.md)
- [ ] 28 — [Privacy: retention, erasure, masking](phase-28-privacy-retention.md)

### Part E — Evaluation and ship

- [ ] 29 — [The labelled message set and the pipeline eval](phase-29-test-set-eval.md)
- [ ] 30 — [Iterate with Prompt Lab, the LLM judge, Playbook variants, the final test run](phase-30-prompt-lab-iteration.md)
- [ ] 31 — [Tests: Vitest, Supertest, Testcontainers, Playwright](phase-31-test-harness.md)
- [ ] 32 — [Docker, CI with the eval gate, observability, deploy](phase-32-docker-ci-deploy.md)
- [ ] 33 — [README, ADRs, demo, pilot kit](phase-33-ship-pilot.md)

## Fast track: the weekend version (spec §11)

| Step | Phases | Result |
| --- | --- | --- |
| 1 | 00, 01, 03 | API skeleton + Postgres |
| 2 | 12 (info sheet as a JSON file only), 15, 16, 17, 19, 20 | the pipeline as pure functions + `try-pipeline.ts` CLI |
| 3 | 29 (the eval CLI on **40** messages) | category accuracy + invented-number check results |
| 4 | 13 (form endpoint, no outbox: inline call), a bare inbox page with Approve (sending simulated) | the demoable loop |
| 5 | README results (generated) | something to link |

Then continue from Phase 02. The pipeline functions are the same ones the full app uses.

## Time budget (~15–20 h/week)

| Days | Phases |
| --- | --- |
| 1–2 | 00–09 (copy-heavy) |
| 3 | 10–14 |
| 4–5 | 15–22 |
| 6 | 23–24 |
| 7 | 29 (write + label messages) |
| 8 | 30 (iterate, test once) |
| 9 | 25–28 |
| 10–11 | 31–33 (tests, deploy, README, demo, outreach) |

## Cross-project links

The Prompt Engineering Playbook's Lessons 5, 6 and 8 read this project's eval reports
(`@pb-docs/phases/phase-28-lesson-05-grounding.md`, `phase-29-lesson-06-steps.md`,
`phase-31-lesson-08-bias-safety.md`). Phase 30 builds the variant prompts and eval sets those lessons
need. They're prompt versions and eval options, never forks of the production pipeline.
