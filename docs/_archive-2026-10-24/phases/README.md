# AI Enquiry Assistant — build phases

Follow the phases in order. Each one leaves the app runnable and ends with **Verify** and a
**Definition of done**. Tick a phase here only when every box in its Definition of done is ticked.

Read first:
- [../reference/architecture.md](../reference/architecture.md): what's reused from where;
- [../reference/pipeline-contracts.md](../reference/pipeline-contracts.md): the classify/extract/draft
  contracts and the label format;
- [../reference/safety-checks.md](../reference/safety-checks.md): the code checks on every draft;
- [../reference/copy-map.md](../reference/copy-map.md): every COPY / ADAPT / NEW.

Phase format: **Goal · What I will understand · Prerequisites · Files (tags) · Concepts · Steps ·
Verify · Definition of done · Interview angle.**

## How these guides were checked

- Every `@pt-*`, `@cd-widget/` and `@ec-*` source path exists as of 24 October 2026. PaperTrail is
  implemented through its Phase 37, and its code is the source of truth.
- The foundation phases (00–09) follow the same steps as Prompt Lab's foundation guides
  (`~/Code/prompt-lab/docs/phases/phase-00…09`), with the differences listed in each phase.
- The guides weren't executed as a project. When reality differs from a Verify section, fix it in
  your repo and record the lesson.

## Decisions fixed up front

| Decision | Result |
| --- | --- |
| Architecture | e-commerce → PaperTrail stack: pnpm + Turborepo, Express 5 (CommonJS), MongoDB, Redis ×2, BullMQ, Next.js + TanStack Query |
| Database | MongoDB, not the spec's Postgres, for one architecture across the portfolio (ADR in Phase 29) |
| Tenancy | **Business = PaperTrail org**: owner + staff roles, invites, tenant plugin. Multiple businesses per account come for free |
| Intake | Embeddable widget (from CounselDesk) + the business's Gmail inbox via the Gmail API (read + send, polling the history API) |
| Sending | Only after a human approval: an approval transaction writes an outbox event, the relay sends via the business's Gmail, threaded |
| Models | NVIDIA NIM by default: a cheap model for classify/extract, a stronger one for drafts; OpenAI / Anthropic / Gemini optional |
| Facts | Info sheet only; code safety checks on every draft |
| Evaluation | A labelled message set; the pipeline eval runs the production code path; classify/extract compared in Prompt Lab |

## Status

### Foundation (copied)

- [ ] 00 — [Monorepo, packages, docker-compose](phase-00-monorepo-setup.md)
- [ ] 01 — [API bootstrap](phase-01-api-bootstrap.md)
- [ ] 02 — [Logging with PII redaction](phase-02-logging.md)
- [ ] 03 — [MongoDB and conventions](phase-03-mongo.md)
- [ ] 04 — [Accounts and sessions](phase-04-accounts-sessions.md)
- [ ] 05 — [authenticate, sessions, Google sign-in](phase-05-authenticate-google.md)
- [ ] 06 — [Rate limiting (+ intake limiters)](phase-06-rate-limiting.md)
- [ ] 07 — [Response cache](phase-07-cache.md)
- [ ] 08 — [BullMQ and system email](phase-08-queue-email.md)
- [ ] 09 — [Next.js web foundation](phase-09-web-foundation.md)

### Business and intake

- [ ] 10 — [Businesses, staff, roles (from PaperTrail orgs)](phase-10-businesses-staff.md)
- [ ] 11 — [Business profile and the info sheet](phase-11-info-sheet.md)
- [ ] 12 — [Messages, form intake, outbox](phase-12-intake-messages.md)
- [ ] 13 — [The embeddable contact form widget](phase-13-widget.md)

### AI pipeline

- [ ] 14 — [Model layer (from PaperTrail) + generateText](phase-14-model-layer.md)
- [ ] 15 — [Classify](phase-15-classify.md)
- [ ] 16 — [Extract](phase-16-extract.md)
- [ ] 17 — [Info-sheet selection](phase-17-info-selection.md)
- [ ] 18 — [Draft](phase-18-draft.md)
- [ ] 19 — [Safety checks](phase-19-safety-checks.md)
- [ ] 20 — [The pipeline job, AI results, live updates](phase-20-pipeline.md)

### Human in the loop

- [ ] 21 — [The approval inbox](phase-21-inbox.md)
- [ ] 22 — [Approval, sending, activity log](phase-22-approve-send.md)
- [ ] 23 — [Gmail intake and replies from the business address](phase-23-gmail-channel.md)
- [ ] 24 — [Booking requests](phase-24-bookings.md)
- [ ] 25 — [Stats](phase-25-stats.md)
- [ ] 26 — [Privacy: retention, deletion, masking](phase-26-privacy.md)

### Evaluation and ship

- [ ] 27 — [The labelled message set and the pipeline eval](phase-27-test-set-eval.md)
- [ ] 28 — [Iterate with Prompt Lab; final test run](phase-28-prompt-lab-iteration.md)
- [ ] 29 — [Tests, deploy, README, demo, pilot kit](phase-29-ship-pilot.md)

## Fast track: the weekend version (spec §11)

| Step | Phases | Result |
| --- | --- | --- |
| 1 | 00–03 | API skeleton + Mongo |
| 2 | 11 (info sheet as a JSON file only), 14, 15, 16, 18, 19 | the pipeline as functions |
| 3 | 27 §6.4 (the eval CLI on **40** messages) | category accuracy + invented-number check results |
| 4 | 12 (form endpoint only) + 20 (inline, no queue) + a bare inbox page with Approve (sending simulated) | the demoable loop |
| 5 | README results | something to link |

Then continue from Phase 04. The pipeline functions are the same ones the full app uses.

## Time budget (~15–20 h/week)

| Day | Phases |
| --- | --- |
| 1 | 00–09 (copy-heavy) |
| 2 | 10–13 |
| 3 | 14–16 |
| 4 | 17–20 |
| 5 | 21–22 |
| 6 | 27 (write + label messages) |
| 7 | 28 (iterate, test once) |
| 8 | 23 (Gmail), 24 |
| 9 | 25–26, deploy |
| 10 | 29 (README, demo, outreach) |
