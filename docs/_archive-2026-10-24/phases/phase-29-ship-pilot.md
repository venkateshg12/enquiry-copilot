# Phase 29 — Tests, deploy, README, demo, pilot kit

## 1. Goal

- **Tests** that protect the promises:
  - nothing is sent without approval;
  - no invented facts slip past the checks;
  - tenancy holds;
  - every message reaches a human;
  - no double sends;
  - PII stays out of logs.
- **Deploy**: Vercel (web), Render (API + worker), Atlas, two Redis instances; the widget served from
  the API; the demo business seeded.
- **README** per spec §12, ADRs, LIMITATIONS, a 1–2 minute **demo video/GIF**, the resume bullet, and
  the interview prep.
- A **pilot kit** (spec §10): an outreach message, a setup checklist, a before/after measurement plan,
  and a one-page pilot agreement outline.

## 2. What I will understand after this phase

1. Which tests encode the product's promises.
2. What the production topology looks like and why the worker is separate.
3. How to run a small, honest pilot and turn it into a case study.

## 3. Prerequisites

Phase 28 done.

## 4. Files

```
apps/api/
├── vitest.config.mts · vitest.integration.config.mts        COPY   @pt-api/
├── test/{globalSetup,setupEnv}.ts · test/helpers/*          ADAPT  @pt-api/test/      (no MinIO; LLM_PROVIDER=fake)
├── test/{intake,pipeline,approval,send,tenancy,privacy,gmail}.int.test.ts   NEW
└── Dockerfile                                               ADAPT  @pt-api/Dockerfile (no poppler)
apps/web/{playwright.config.ts, e2e/*.spec.ts}               NEW
.github/workflows/ci.yml                                     ADAPT  @pt-root/.github/workflows/ci.yml   (+ widget build; no PaperTrail eval job)
docs/adr/0001-mongodb-not-postgres.md · 0002-business-equals-org.md · 0003-approval-outbox-only-send-path.md ·
0004-code-checks-for-facts.md · 0005-gmail-api-vs-imap.md · 0006-nvidia-default-cheap-and-draft-tiers.md   NEW
docs/{LIMITATIONS,INTERVIEW,PILOT}.md                        NEW
README.md                                                    ADAPT (final)
```

## 5. Concepts

**Promises → tests.**

| Promise | Test |
| --- | --- |
| Nothing sent without approval | no code path calls `send.service` except the `reply.approved` dispatcher (a test greps the import graph: only `dispatchers.ts` imports it); an integration test processes 20 messages through the pipeline and asserts 0 sends until approvals |
| No double sends | concurrent approvals → one reply; a relay crash/replay → one send (the fake transport counts) |
| Invented facts caught | planted-draft recall 100 % (Phase 19/27 fixtures in CI) |
| Server re-checks edits | approving an edited text with a new price via the API → 422 without a reason |
| Every message reaches a human | provider down → `needs_approval` without a draft; classify garbage → "other" + a draft |
| Tenancy | the cross-business suite (PaperTrail pattern): every id route with another business's ids → 404 |
| No PII in logs | process messages with a log capture; assert no body, email or phone substrings appear |
| Intake bot defences | honeypot / fast submit → 202 + nothing stored; the 6th submission → 429; over the cap → `held` |
| Gmail threading | `parseInbound` fixtures; `sendReply` builds `In-Reply-To`/`References`/`threadId` (fetch stubbed) |

**E2E (Playwright, compose stack, fake provider):** widget submit on a test host page → the inbox shows
it live → a flagged span is highlighted → edit → approve → "Sent ✓" (the fake transport records it) →
the booking appears in `/bookings` → confirm → the confirmation draft → approve.

**Topology.**
- Render web service: `RUN_WORKERS_IN_API=false`.
- Render background worker: the pipeline, relay, send, Gmail polls, retention.
- Atlas: a least-privilege user.
- Redis: queue/limiter `noeviction` plus cache `volatile-lru`.
- Vercel: the dashboard.
- The widget: served by the API at `/widget/enquiry.js`.

Cookies across Vercel/Render: the copied `SameSite=None; Secure` config, with PaperTrail's caveat
(strict browsers block third-party cookies; a custom domain fixes it).

**Pilot, honestly** (spec §10):
- pick one business you can visit;
- promise small: "faster, consistent replies; you approve everything";
- measure **two weeks before** (reply time, missed messages) and **two weeks after**;
- charge only after it shows value;
- agree in writing who pays AI usage, how customer data is handled (`DATA-HANDLING.md`), and the
  retention period;
- with permission, the before/after becomes the case study and the resume bullet's optional clause.

## 6. Steps

1. Tests: copy PaperTrail's harness (Testcontainers Mongo rs + Redis), write the integration tests in the
   table, then the Playwright golden path. CI = PaperTrail's `ci.yml` minus its eval job, plus
   `pnpm --filter widget build` and the planted-draft check tests.
2. Docker/compose: PaperTrail's multi-stage, non-root API image without poppler; compose profile `app`
   (api, worker, web).
3. Deploy:
   - Atlas (`db:indexes`), Redis ×2;
   - Render API + worker, with env:
     - JWT secrets, `TOKEN_SECRET_KEY`;
     - the system Gmail;
     - `BUSINESS_GMAIL_REDIRECT_URI`;
     - NVIDIA keys/models;
     - `TRUSTED_PROXY_CIDRS=127.0.0.1/32`;
   - Vercel web;
   - seed the demo business (`demo: true`) with the info sheet and 15 sample messages processed into the
     inbox;
   - a **read-only demo login** (viewer role) for visitors: they see the inbox, flags, bookings and
     stats, but can't approve, send or change settings.
4. README per spec §12:
   1. the one-liner with the human-approval rule;
   2. a GIF (widget submit → draft appears with a highlighted flag → edit → approve → sent);
   3. the results table (Phase 28);
   4. the pipeline diagram;
   5. prompt design decisions;
   6. top mistakes and fixes;
   7. privacy and safety;
   8. how to run it;
   9. pilot results (if any, with permission).

   Then "Built on" (PaperTrail / e-commerce / CounselDesk / Prompt Lab) and links to the demo and the
   published Prompt Lab runs.
5. ADRs (half a page each) and `LIMITATIONS.md`:
   - one demo business;
   - labels written by one person, with a self-agreement figure;
   - Gmail restricted-scope verification for public launch;
   - polling latency (≤ 60 s);
   - no calendar sync;
   - no WhatsApp;
   - the checks can over-flag plain numbers;
   - NVIDIA costs as reference prices;
   - Hinglish coverage limited to what the test set contains.
6. `INTERVIEW.md`: answer each spec §14 question from your own numbers (≤ 5 sentences each).
7. `PILOT.md`:
   - an outreach message (3 sentences, in person first);
   - a setup checklist (info sheet with the owner, tone guide, widget install, Gmail connect,
     retention, staff accounts);
   - the measurement plan;
   - an agreement outline.
8. The resume bullet (spec §13), numbers only from the README table:
   > Built an AI enquiry assistant (Next.js, TypeScript, Express, MongoDB, BullMQ) that classifies
   > small-business customer messages, extracts booking details and drafts replies from the business's
   > own info sheet with human approval; on [N] labelled test messages it reached [X]% category accuracy,
   > [Y]% of drafts approved without edits and zero invented prices after adding code-level fact checks
   > [; piloted with a local business, cutting average reply time from [A] to [B]].
9. Tick every phase, write the review in `tasks/todo.md`, and tag `v1.0.0`.

## 7. Verify

- CI green; deliberately breaking a promise fails a test (e.g. calling `send.service` from the approval
  controller directly → the import-graph test fails).
- The live demo: viewer login works; widget submissions on the demo page appear for the owner account.
- README numbers equal the Phase 28 exports; the resume bullet equals the README.

## 8. Definition of done

- [ ] Promise tests + E2E green in CI.
- [ ] Deployed with a seeded demo business and a read-only demo login.
- [ ] README, ADRs, LIMITATIONS, INTERVIEW and PILOT docs; a demo video/GIF.
- [ ] Tag `v1.0.0`; 2–3 local businesses approached for a pilot.

## 9. Interview angle

Lead with the rule: *"The AI never sends anything on its own and never invents facts."* Then show how
the architecture enforces it:
- the only send path is an approval transaction's outbox event;
- code checks every number against the info sheet, including numbers a human typed;
- a test fails if anyone adds another way to send.

Finish with the measured numbers and, if you have one, the pilot's before/after reply time.
