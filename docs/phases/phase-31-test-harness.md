# Phase 31 — Tests: Vitest, Supertest, Testcontainers, Playwright

## 1. Goal

Tests that protect the product's **promises**, not its line count:

- **nothing is sent without a human approval**: no code path to `send-reply` except the approval
  outbox event;
- **no double sends**, even under concurrent approvals or a relay replay;
- **tenancy holds**: another business's ids are 404 on every route;
- **intake dedupes** retried form posts and re-polled emails;
- **the outbox delivers exactly once** per event;
- **retention deletes everything** belonging to an expired message;
- **logs contain no PII**;
- plus a **Playwright golden path** against the real stack with the `fake` provider: widget submit →
  draft appears live → edit → approve → "Sent" → the reply in the dev mailbox.

## 2. What I will understand after this phase

1. How to turn a promise into a test that fails when someone breaks it on purpose.
2. Why integration tests run against the **committed migrations** in a real PostgreSQL, not a mock.
3. How to test "this never happens" (no auto-send) structurally, and behaviourally.
4. How the fake provider makes model-dependent flows deterministic.
5. How to assert something **isn't** in the logs.

## 3. Prerequisites

Phases 00–30 done. Docker running (Testcontainers starts Postgres 17 and Redis).

## 4. Files

```
apps/api/
├── vitest.config.mts                     COPY   @pt-api/vitest.config.mts
├── vitest.integration.config.mts         COPY   @pt-api/vitest.integration.config.mts
├── tsconfig.test.json                    COPY   @pt-api/tsconfig.test.json
├── test/
│   ├── globalSetup.ts                    ADAPT  @pt-api/test/globalSetup.ts   (db name enquiry_test; nothing else changes)
│   ├── setupEnv.ts                       ADAPT  @pt-api/test/setupEnv.ts      (drop S3/webhook vars; + SECRET_BOX_KEY, test Gmail channel vars)
│   ├── helpers/{app,auth,db,queues}.ts   ADAPT  @pt-api/test/helpers/        (orgs → businesses fixtures; info sheet seed)
│   ├── helpers/fakeLlm.ts                ADAPT  @pt-api/test/helpers/fakeLlm.ts (scripted classify/extract/draft answers)
│   ├── helpers/logCapture.ts             NEW    (pino destination capture)
│   ├── helpers/fakeGmail.ts              NEW    (records sends; scripted history/messages for polls)
│   ├── health.int.test.ts                ADAPT  @pt-api/test/health.int.test.ts
│   ├── auth.int.test.ts                  ADAPT  @pt-api/test/auth.int.test.ts
│   ├── roles.int.test.ts                 ADAPT  @pt-api/test/roles.int.test.ts
│   ├── tenancy.cross-org.int.test.ts     ADAPT  @pt-api/test/tenancy.cross-org.int.test.ts (this project's routes)
│   ├── security/injection.int.test.ts    ADAPT  @pt-api/test/security/injection.int.test.ts (customer text as data)
│   ├── security/limits.int.test.ts       ADAPT  @pt-api/test/security/limits.int.test.ts   (intake limiters, body caps)
│   ├── intake.int.test.ts                NEW
│   ├── outbox.int.test.ts                NEW
│   ├── pipeline.int.test.ts              NEW
│   ├── approval.int.test.ts              NEW
│   ├── noAutoSend.test.ts                NEW    (structural: import graph)
│   ├── retention.int.test.ts             NEW
│   └── logs.int.test.ts                  NEW
apps/web/
├── playwright.config.ts                  ADAPT  @pt-web/playwright.config.ts (webServer: api + web + widget host page)
├── e2e/global-setup.ts                   ADAPT  @pt-web/e2e/global-setup.ts
├── e2e/helpers/{signup,fakeLlm}.ts       ADAPT  @pt-web/e2e/helpers/
├── e2e/fixtures/answers/                 NEW    (recorded fake-provider answers for the golden path)
├── e2e/fixtures/widget-host.html         NEW    (a plain page embedding enquiry.js)
├── e2e/auth.spec.ts                      ADAPT  @pt-web/e2e/auth.spec.ts
├── e2e/tenancy.spec.ts                   ADAPT  @pt-web/e2e/tenancy.spec.ts
└── e2e/golden-path.spec.ts               NEW    (the money path of this product)
```

## 5. Concepts

**Promises → tests.**

| Promise | Test | How it would fail |
| --- | --- | --- |
| Nothing sent without approval (structural) | `noAutoSend.test.ts` builds the import graph of `src/` (a small walker over `import`/`require` with the TypeScript resolver) and asserts that the **only** modules importing `services/send.service.ts` are `jobs/processors/sendReply.processor.ts`, and that the only enqueuer of the `send-reply` queue is the `reply.approved` dispatcher in `jobs/outbox/dispatchers.ts` | someone calls `sendReply()` from the approval controller "to save a hop" |
| Nothing sent without approval (behaviour) | `pipeline.int.test.ts` pushes 20 messages through intake → relay → worker with `fakeLlm`, drains every queue, and asserts `fakeGmail.sent.length === 0` and every message is `ready`/`spam`/`needs_attention` | a flag that auto-approves "safe" drafts |
| No double sends | `approval.int.test.ts`: 5 concurrent `POST …/approve` on one message → one 200 and four 409s, one `Reply`; then replay the `reply.approved` outbox row and re-run the `send-reply` job → still one `fakeGmail` send | `jobId` missing, or `sendStatus` not checked |
| Server re-checks edits | approving an edited draft that adds `₹999` not in the info sheet, without `overrideReason` → 422 with the flag; with a reason → 200 and the override in `AuditLog` | trusting the client's flag list |
| Every message reaches a person | provider scripted to throw `ProviderUnavailable` on every attempt → after the last retry the message is `needs_attention`, a DLQ entry exists, and the inbox lists it | a failed job leaving the message `processing` forever |
| Tenancy | `tenancy.cross-org.int.test.ts` (PaperTrail's pattern): for every route with an id, business A's user with business B's id → 404 (not 403: don't confirm existence); and the tenant extension throws for an unscoped query | a raw query without `org_id` |
| Intake dedupe | the same `clientSubmissionId` posted twice concurrently → one `Message`, both responses 202 with the same id; the same Gmail message polled twice → one `Message` (`@@unique([orgId, gmailMessageId])`, `P2002` handled) | a check-then-insert race |
| Intake bot defences | honeypot filled or submitted < 2 s after render → 202 and nothing stored; the limiter's 6th submit → 429; disabled form → 404; origin not allowed → no CORS headers | a defence that returns 400 (it teaches bots what tripped) |
| Outbox exactly once | 3 relays run concurrently over 50 pending events → each dispatched once (`FOR UPDATE SKIP LOCKED`), `dispatchedAt` set; a dispatcher that throws → `attempts++`, `nextAttemptAt` backed off, later success | a relay without row locks |
| Retention cascade | a message older than `retentionDays` with an AI result, model calls, reply and booking → the `retention` job deletes all five kinds; a message at `retentionDays - 1` survives | a child table without `onDelete: Cascade` |
| Erasure | `contacts/erase` removes every message from that contact (email or phone in any format), and the audit entry has a hash, not the contact | an audit diff that leaks the erased value |
| No PII in logs | `logs.int.test.ts` swaps pino's destination for `logCapture`, runs intake → pipeline → approve → send for a message with a known name, phone, email and a unique body sentence, then asserts **none** of those strings (or the phone's last 10 digits) appear in any captured line, at any level | a new `logger.info({ message })` |
| Injection is data | `security/injection.int.test.ts`: a body containing `</customer_message>` reaches the prompt with the closing tag neutralised (assert on the captured fake-provider request) | prompt built with string concatenation |

Every test in this table has been **broken on purpose once** before you trust it. For example, delete
the `jobId` or add a direct `sendReply` import, see it go red, and revert. Record each in
`tasks/lessons.md` if it didn't go red the first time.

**Real migrations.** `globalSetup.ts` (COPY of PaperTrail's apart from the database name) starts
`postgres:17-alpine` and `redis:7-alpine`, runs `prisma migrate deploy` on the committed migrations,
and points the env at them. The integration suite therefore also proves the migrations apply from
zero. `fileParallelism: false`, and each test file truncates its tables in `beforeEach` (the
`helpers/db.ts` `resetDb()` that walks `TENANT_MODELS` plus the account tables, in dependency
order).

**Unit vs integration.** Pure code (`pipeline/checks/*`, `selectInfo`, normalisers, `metrics.ts`, the
giant adapter, prompt rendering, `secretBox`, the import walker) stays in fast Vitest unit tests next to
the file (`*.test.ts`). Anything that touches Prisma, BullMQ or HTTP is `test/*.int.test.ts` with
Supertest on `createApp()`.

**The fake provider.** `fakeLlm.push({ kind: "json", data })` / `{ kind: "text", text }` /
`{ kind: "error", error }` scripts answers in order (PaperTrail's `fake` provider). Tests never call
NVIDIA. The E2E suite uses recorded answers from `e2e/fixtures/answers/`, keyed like the replay
provider, so the golden path is deterministic.

**The golden path (Playwright).**

```
widget-host.html ─ fill form ─► submit ─► "Thanks, we'll reply soon"
inbox (owner, signed in) ─ row appears without reload (SSE) ─► open ─► draft shown, a strong flag highlighted
edit the flagged sentence ─► flag clears on re-check ─► Approve ─► status "Sent ✓"
dev mailbox / fakeGmail endpoint ─► the reply's text equals the edited text, In-Reply-To set (email channel case)
bookings ─► the booking request appears ─► Confirm
```

Run with `LLM_PROVIDER=replay`, the dev Gmail transport (Phase 25's dev mode records instead of
sending), and the compose infrastructure (`postgres redis redis-cache`). The API runs on the runner
via Playwright's `webServer`, as in PaperTrail.

## 6. Steps

1. Copy the configs and `globalSetup.ts`, adapt `setupEnv.ts` and the helpers. Get
   `health.int.test.ts` green: that proves containers + migrations + `createApp()`.
2. Port `auth`, `roles` and `tenancy.cross-org` from PaperTrail. Replace PaperTrail's route list in
   the cross-org test with this project's id routes (messages, replies, bookings, info entries,
   forms, invites, Gmail connection).
3. Write `logCapture.ts`:

   ```ts
   import { Writable } from "node:stream";
   export const captured: string[] = [];
   export const captureStream = new Writable({
     write(chunk, _enc, cb) { captured.push(chunk.toString()); cb(); },
   });
   // logger.ts (Phase 02) exports setLogDestination: setLogDestination(captureStream) in the test's beforeAll
   ```

   Phase 02's `logger.ts` provides `setLogDestination` for exactly this.
4. Write `fakeGmail.ts` (records `send` calls with raw MIME; serves scripted `history.list` and
   `messages.get` responses for polls). Inject it with Phase 25's
   `setGmailTransport(fakeGmail)` (`utils/email/gmailTransport.ts`).
5. Write the new integration tests in the table's order. Then `noAutoSend.test.ts`.
6. Break each promise on purpose once; watch the right test fail; revert.
7. Playwright: adapt the config and helpers, record the golden-path answers once
   (`LLM_PROVIDER=replay` with `--record` semantics from Phase 29), write `golden-path.spec.ts`, then
   port `auth.spec.ts` and `tenancy.spec.ts`.
8. Add scripts: `test`, `test:int`, `test:watch` (API); `e2e` (web).

## 7. Verify

```bash
pnpm --filter api test            # unit: checks, selectors, metrics, adapters, noAutoSend, prompt LOCK
pnpm --filter api test:int        # Testcontainers: starts pg17 + redis, applies migrations, runs suites
docker compose up -d --wait postgres redis redis-cache
pnpm --filter web e2e             # golden path, auth, tenancy
```

Expected:
- every suite green;
- the `test:int` log shows `✓ Migrations applied` before the first test;
- `logs.int.test.ts` reports the number of captured lines (> 0, so it really captured something);
- adding `import { sendReply } from "../services/send.service"` to `approval.controller.ts` turns
  `noAutoSend.test.ts` red with the offending path in the message.

## 8. Definition of done

- [ ] Every promise in the table has a test, and each was broken on purpose once and went red.
- [ ] Integration tests run on real Postgres 17 + Redis with the committed migrations.
- [ ] `noAutoSend` structural test + the 20-message behavioural test both pass.
- [ ] PII log test captures real output and finds none of the planted values.
- [ ] Playwright golden path green with recorded answers; auth and tenancy specs ported.
- [ ] Commit: `test: promise tests, integration suite and golden-path e2e`.

## 9. Interview angle

*"How do you know nothing is ever sent without approval?"* Two tests, two ways. One is structural:
it walks the import graph and fails if anything except the send processor imports the send service,
or anything except the approval dispatcher enqueues a send. The other is behavioural: 20 messages go
through the whole pipeline, and the fake Gmail transport records zero sends until a person approves.
I broke each one on purpose to see it go red. Integration tests run on a real Postgres with the same
migrations a deploy applies, and one test captures the logs and proves no customer phone, email or
message text reaches them.
