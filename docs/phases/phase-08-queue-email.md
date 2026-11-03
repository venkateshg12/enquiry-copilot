# Phase 08 — BullMQ, DLQ and system email on the Gmail API

## 1. Goal

Copy PaperTrail's queue foundation and its **system** email sender:
- one ioredis connection for BullMQ on the `noeviction` instance;
- the queue / producer / worker / processor split, with deterministic job ids;
- the email queue sending verification and password-reset mail through the **Gmail API**;
- an in-memory dev mailbox, so sign-up works before Gmail is authorized;
- a **dead-letter queue** and the `onFinalFailure` hook, so a job that has used all its attempts is
  kept with everything needed to replay it;
- a **maintenance** queue with `purge-expired` (hourly), registered with `upsertJobScheduler`;
- Bull Board behind Basic auth, off unless switched on;
- `worker.ts`, imported by the API in dev (`RUN_WORKERS_IN_API=true`) and run standalone in
  production.

Then resolve Phases 04 and 05's `// Phase 08:` comments: registration, resend-verification and
forgot-password enqueue their emails instead of logging the link.

## 2. What I will understand after this phase

1. Queue, producer, worker, processor: what each owns and why they're separate files.
2. Deterministic job ids: why the same token can't be emailed twice.
3. Retryable vs `UnrecoverableError`: which Gmail failures deserve five attempts and which deserve one.
4. Why job payloads carry ids and tokens but never message content.
5. Two kinds of email in this app, and why they must never be confused.
6. Why PostgreSQL needs a purge job, and why reads never depend on it having run.
7. How one `worker.ts` serves both "in the API process" and "its own process".

## 3. Prerequisites

- Phase 07 done.
- The Gmail sender setup in `~/Code/e-commerce/docs/gmail-api-email-sender.md`. Reuse the existing
  Google Cloud project and OAuth client; you need `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REDIRECT_URI` and, after the one-time authorization below, `GMAIL_REFRESH_TOKEN`.

## 4. Files

```
apps/api/src/
├── constants/
│   ├── queue.ts                          ADAPT  @pt-api/src/constants/queue.ts      (EMAIL, DEAD_LETTER, MAINTENANCE only)
│   └── env.ts                            ADAPT  (+ GMAIL_*, ENABLE_QUEUE_DASHBOARD, QUEUE_DASHBOARD_*, RUN_WORKERS_IN_API, WORKER_PORT)
├── config/gmail.ts                       COPY   @pt-api/src/config/gmail.ts
├── services/gmail.service.ts             COPY   @pt-api/src/services/gmail.service.ts
├── controllers/gmailAuth.controller.ts   COPY   @pt-api/src/controllers/gmailAuth.controller.ts
├── routes/gmail.route.ts                 COPY   @pt-api/src/routes/gmail.route.ts  (mounted at /api/auth/gmail, as PaperTrail)
├── utils/email/
│   ├── emailTemplates.ts                 ADAPT  @pt-api/src/utils/email/emailTemplates.ts  (verify + reset only; branding)
│   ├── html_templates.ts                 ADAPT  @pt-api/src/utils/email/html_templates.ts  (branding)
│   ├── devMailbox.ts                     COPY   @pt-api/src/utils/email/devMailbox.ts
│   └── index.ts                          COPY   @pt-api/src/utils/email/index.ts
├── jobs/
│   ├── redis/connection.ts               COPY   @pt-api/src/jobs/redis/connection.ts
│   ├── interfaces/jobPayload.ts          ADAPT  @pt-api/src/jobs/interfaces/jobPayload.ts  (VerifyEmail + PasswordReset only)
│   ├── queues/email.queue.ts             COPY   @pt-api/src/jobs/queues/email.queue.ts
│   ├── queues/deadLetter.queue.ts        COPY   @pt-api/src/jobs/queues/deadLetter.queue.ts
│   ├── queues/maintenance.queue.ts       COPY   @pt-api/src/jobs/queues/maintenance.queue.ts
│   ├── producers/email.producer.ts       ADAPT  @pt-api/src/jobs/producers/email.producer.ts
│   ├── processors/email.processor.ts     ADAPT  @pt-api/src/jobs/processors/email.processor.ts  (verify + reset)
│   ├── processors/purgeExpired.processor.ts  ADAPT  @pt-api/src/jobs/processors/purgeExpired.processor.ts (sessions + links)
│   ├── workers/email.worker.ts           ADAPT  @pt-api/src/jobs/workers/email.worker.ts
│   ├── workers/maintenance.worker.ts     ADAPT  @pt-api/src/jobs/workers/maintenance.worker.ts  (PURGE_EXPIRED only)
│   ├── deadLetter.ts                     ADAPT  @pt-api/src/jobs/deadLetter.ts       (generic: copy to the DLQ; no document logic)
│   └── dashboard/bull-board.ts           ADAPT  @pt-api/src/jobs/dashboard/bull-board.ts  (this project's queues)
├── services/auth.service.ts              ADAPT  resolve the Phase 04/05 `// Phase 08:` comments
├── routes/auth.route.ts                  ADAPT  + GET /auth/dev/latest-link (non-production only, as PaperTrail)
├── worker.ts                             ADAPT  @pt-api/src/worker.ts  (email + maintenance; initSchedulers; health server)
├── index.ts                              ADAPT  start workers in-process unless RUN_WORKERS_IN_API=false; close them on shutdown
└── app.ts                                ADAPT  Bull Board at /admin/queues behind Basic auth (as @pt-api/src/app.ts)
apps/api/package.json                     ADAPT  + "worker": "tsx watch src/worker.ts", "start:worker"
```

```bash
pnpm --filter api add bullmq@^5.80.9 googleapis @bull-board/api@^8.1.2 @bull-board/express@^8.1.2
```

Use the `googleapis` major PaperTrail pins (`^184`) so the COPY files compile unchanged. npm's
current major is 189: upgrade later, deliberately, against the Gmail sender's tests.

## 5. Concepts

**Four files per job type.**
- The **queue** declares a name and default options (attempts, backoff, retention of finished jobs).
- The **producer** is the only thing services call. It knows job names and ids.
- The **worker** pulls jobs and routes by `job.name`, with concurrency and a rate limiter (2 emails/s,
  inside Gmail's sending limits).
- The **processor** does the work and owns the retry decision.

A service never imports BullMQ, so a test can replace the producer with a spy.

**Deterministic job ids.** `jobId: reset-<userId>-<tokenHash>`. BullMQ ignores an `add` whose id
already exists, so a double-clicked "send reset link" queues one email. PaperTrail keys on the raw
token. Here the id uses a **SHA-256 of the token**, because job ids are visible in Bull Board and in
Redis. The payload still has to carry the raw token, which is exactly why the dashboard is guarded.
**Custom job ids never contain `:`.** BullMQ uses `:` in its own Redis keys and rejects most custom
ids that contain one (the Playbook build hit this with `<broadcastId>:<subscriberId>`). Every id in
this project joins its parts with `-`: `pipeline-<messageId>-<attempt>`, `reply-<replyId>`,
`invite-<inviteId>`, `gmail-reauth-<orgId>-<day>`.

**Retry or give up.** The processor rethrows failures a later attempt can fix:
- Gmail 429 or 5xx;
- network errors.

BullMQ then backs off exponentially (3 s, 6 s, 12 s, …, 5 attempts). It throws `UnrecoverableError`
for failures that need a human:
- `invalid_grant` (the refresh token was revoked or expired);
- Gmail not configured;
- a malformed payload or a rejected address.

A bad token fails one job once, instead of five times for every queued email.

**Idempotent processors.** A retry may run after a first attempt that did succeed but didn't report
back. The verify processor re-reads the user and skips if they're already verified. The reset processor
skips if the user is gone. Gmail has no idempotency key, so "skip if done" is the guard.

**The dead-letter queue.** Only the **last** attempt counts. `onFinalFailure(job, err)` runs from
every worker's `failed` event and returns early unless `attemptsMade >= attempts` or the error is
unrecoverable. Then it copies `{queue, name, jobId, data, failedReason, failedAt}` into
`dead-letter-queue` with `jobId: dead-<id>`, never removed automatically. PaperTrail's version also
marks the document failed and emits an outbox event. Here that business step belongs to the pipeline
(Phase 21: the message becomes `needs_attention`), so this phase copies only the generic half and
leaves a `// Phase 21:` hook. Replaying a dead job means re-adding `data` to its original queue under a
new id (Phase 21 adds the endpoint).

**Two kinds of email.**

| | System email (this phase) | Customer replies (Phase 25) |
| --- | --- | --- |
| From | the app's own sender (`GMAIL_SENDER_NAME` + the address in `config/gmail.ts`) | **the business's own Gmail address** |
| Sends | verification, password reset, later staff invites (11) and budget warnings (22) | approved replies only |
| Auth | one refresh token in env (`GMAIL_REFRESH_TOKEN`), scope `gmail.send` | one **sealed** refresh token per business, scopes `gmail.readonly` + `gmail.send` |
| Code | `config/gmail.ts`, `services/gmail.service.ts` (COPY) | a separate OAuth client and service, reusing only the MIME builder |

A customer must never get a reply from the app's no-reply address, and a password reset must never
come from a business's address. Keeping them in different modules with different OAuth clients makes
that a structural guarantee, not a convention.

**Payloads carry ids, never content.** Job data sits in Redis and is readable in Bull Board. System
emails carry a user id, an address and a token, because that's unavoidable. No later job (pipeline,
send-reply) will ever carry a message body or a draft: they carry `messageId` / `replyId` and read the
rest from Postgres (architecture.md §8, data-handling.md).

**Purge.** PostgreSQL has no TTL indexes. `purge-expired` runs hourly at :15 and deletes expired
`sessions` and `verification_links` inside `runAsSystem()`. Later phases add their rows: invites (11),
dispatched outbox rows (13), audit retention (28). Correctness never depends on it: every read of
these rows already filters on `expiresAt`. The purge only keeps the tables small.

**Schedulers.** `queue.upsertJobScheduler(id, repeat, template)` is idempotent: the API and the
standalone worker can both call it on boot without creating duplicates. It replaces the older
`repeat` option on `add`.

**One worker module, two ways to run it.** `index.ts` imports `./worker` and calls `initSchedulers()`
unless `RUN_WORKERS_IN_API=false`, so `pnpm dev` is one process. In production the API sets it to
`false` and `pnpm start:worker` runs `worker.ts` directly. Only then (`require.main === module`) does
it connect the database, start a small health server on `PORT`/`WORKER_PORT`, and own the signal
handlers. When imported, the API drives shutdown and calls `closeWorkers()`. Registering signal
handlers in both would let a SIGTERM exit before in-flight HTTP requests finish.

**Bull Board.** Job payloads include reset and verification tokens. The dashboard is mounted only when
`ENABLE_QUEUE_DASHBOARD=true`. Boot fails if it's on without `QUEUE_DASHBOARD_USER`/`PASSWORD`. It sits
behind Basic auth compared with a timing-safe digest. It's mounted **before** `globalLimiter` and the
JSON parser, as in PaperTrail.

## 6. Steps

1. **Constants.** `constants/queue.ts`:
   ```ts
   export const QUEUE_NAMES = {
       EMAIL: 'email-queue',
       DEAD_LETTER: 'dead-letter-queue',
       MAINTENANCE: 'maintenance-queue',
       // Phase 21: PIPELINE · Phase 24: SEND_REPLY · Phase 25: GMAIL_POLL
   } as const;

   export const JOB_NAMES = {
       EMAIL: {
           VERIFY_EMAIL: 'send_verify_email',
           PASSWORD_RESET: 'send_password_reset',
           // Phase 11: ORG_INVITE · Phase 22: BUDGET_WARNING
       },
       MAINTENANCE: {
           PURGE_EXPIRED: 'purge-expired',
           // Phase 28: RETENTION_SWEEP   (the outbox relay, Phase 13, is a polling loop in the worker, not a job)
       },
   } as const;
   ```
2. **Env.** Copy PaperTrail's Gmail block (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_NAME`, `GMAIL_OAUTH_SETUP`, all optional
   so the server boots before authorization), the queue-dashboard block, and
   `RUN_WORKERS_IN_API = getEnv("RUN_WORKERS_IN_API", "true")`, `WORKER_PORT = getEnv("WORKER_PORT", "8080")`.
   `.env.example`: `GMAIL_SENDER_NAME="AI Enquiry Assistant"`.
3. **Gmail.** Copy `config/gmail.ts`, `services/gmail.service.ts`, the controller and the route
   unchanged, and mount `app.use("/api/auth/gmail", gmailRoutes)` as PaperTrail does. The authorize
   routes exist outside production only (or with `GMAIL_OAUTH_SETUP=true`). The test-send route never
   exists in production. Run the one-time authorization: open
   `http://localhost:5000/api/auth/gmail`, consent, and copy the refresh token from the server log into
   `.env`. The sender **address** is a constant in `config/gmail.ts` on purpose: a caller can never
   choose it.
4. **Templates.** `emailTemplates.ts`: keep `getVerificationEmail` and `getPasswordResetEmail`. Delete
   the invite, webhook, budget and quota templates; Phases 11 and 22 add back the two they need.
   Change the product name in both files. The links must still point at the web routes PaperTrail
   uses: `${CLIENT_URL}/auth/verify/<token>` and `${CLIENT_URL}/password/reset/<token>`. Phase 09
   copies those pages.
5. **Jobs.** Copy `redis/connection.ts` and the three queue files. ADAPT:
   - `jobPayload.ts`: `VerifyEmailPayload`, `PasswordResetPayload` only.
   - `email.producer.ts`: `sendVerifyEmail` / `sendVerifyMail` alias / `sendPasswordReset`, with
     hashed job ids:
     ```ts
     import { createHash } from "node:crypto";
     // Job ids are visible in Bull Board and Redis, so they carry a hash of the token, never the token.
     const tokenId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

     static async sendPasswordReset(payload: PasswordResetPayload) {
         return emailQueue.add(JOB_NAMES.EMAIL.PASSWORD_RESET, payload, {
             jobId: `reset-${payload.userId}-${tokenId(payload.resetToken)}`,
         });
     }
     ```
   - `email.processor.ts`: keep `deliver()` (dev mailbox fallback, the retry/unrecoverable split),
     `processVerifyEmail`, `processPasswordReset`. Delete the other processors.
   - `email.worker.ts`: the two cases; keep `concurrency: 5`, `limiter: { max: 2, duration: 1000 }`;
     add `emailWorker.on("failed", (job, err) => void onFinalFailure(job, err))`.
   - `purgeExpired.processor.ts`:
     ```ts
     export async function processPurgeExpired(now = new Date()) {
         return runAsSystem(async () => {
             const [sessions, verificationLinks] = await Promise.all([
                 prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
                 prisma.verificationLink.deleteMany({ where: { expiresAt: { lt: now } } }),
                 // Phase 11: invites · Phase 13: dispatched outbox rows · Phase 28: audit log retention
             ]);
             return { sessions: sessions.count, verificationLinks: verificationLinks.count };
         });
     }
     ```
     Deleting expired sessions directly (not through `revokeSessions`) is the one allowed exception.
     An expired session already fails `authenticate`'s database check, and its cache key lives at
     most 60 s.
   - `maintenance.worker.ts`: the `PURGE_EXPIRED` case only, `concurrency: 1`.
   - `deadLetter.ts`:
     ```ts
     /** Called from every worker's "failed" event. Only the LAST attempt counts: earlier ones are backoff. */
     export const onFinalFailure = async (job: Job | undefined, err: Error): Promise<void> => {
         if (!job) return;
         const isUnrecoverable = err.name === "UnrecoverableError";
         if (!isUnrecoverable && job.attemptsMade < (job.opts.attempts ?? 1)) return;
         // Phase 21: for pipeline jobs, mark the message needs_attention (in a transaction) before this.
         await deadLetterQueue.add("dead", {
             queue: job.queueName, name: job.name, jobId: job.id, data: job.data,
             failedReason: err.message.slice(0, 2000), failedAt: new Date().toISOString(),
         }, { jobId: `dead-${job.id}` });
     };
     ```
   - `bull-board.ts`: the email, dead-letter and maintenance queues.
6. **`worker.ts`.** Start from PaperTrail's and keep:
   - `initSchedulers()` with only
     `maintenanceQueue.upsertJobScheduler("purge-expired", { pattern: "15 * * * *" }, { name: JOB_NAMES.MAINTENANCE.PURGE_EXPIRED })`;
   - `closeWorkers()` closing the email and maintenance workers;
   - `createHealthServer()` reporting database, redis and `workers: { email, maintenance }`;
   - the `require.main === module` block.

   Remove the relay, pub/sub, call recorder and Sentry lines (Phases 13, 21, 22 and 32).
7. **`index.ts`.** After `connectDB()`:
   ```ts
   let workers: typeof import("./worker") | null = null;
   if (RUN_WORKERS_IN_API !== "false") {
       // Dynamic on purpose: the workers start when ./worker is loaded. A static
       // `import … from "./worker"` would start them even with RUN_WORKERS_IN_API=false
       // (found building the Playbook, 2 Nov 2026).
       workers = await import("./worker");
       await workers.initSchedulers();
       logger.info("[startup] in-process workers and schedulers initialized");
   } else {
       logger.info("[startup] RUN_WORKERS_IN_API=false — workers run in the standalone process");
   }
   ```
   Shutdown: `server.close` → `workers?.closeWorkers()` → `cache.close()` → `disconnectDB()`. The
   workers start on import, so the dynamic `import("./worker")` is what runs them, and only when the
   flag allows. There is no static import of `./worker` anywhere in `index.ts` or `app.ts`.
8. **Auth.** Replace each `// Phase 08:` comment in `auth.service.ts`:
   - registration and resend-verification: `await EmailProducer.sendVerifyMail({ userId, email, verificationToken })`;
   - forgot-password: `await EmailProducer.sendPasswordReset({ userId, email, resetToken })`.

   Each call goes **after** the database write commits, never inside a transaction: a job queued for
   a rolled-back user would email a link that can't work. Add PaperTrail's non-production
   `GET /auth/dev/latest-link?email=` to `auth.route.ts`. Phase 31's tests and Playwright read
   verification links from it.
9. **Bull Board.** Copy PaperTrail's `queueDashboardAuth`, `matchesSecret` and the mount block into
   `createApp()`, before `requestId`.
10. `package.json`: `"worker": "tsx watch src/worker.ts"`, `"start:worker": "node dist/worker.js"`.

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev
# [startup] in-process workers and schedulers initialized

# 1. Without GMAIL_REFRESH_TOKEN (dev): the email lands in the dev mailbox.
curl -s -X POST localhost:5000/auth/register -H 'content-type: application/json' \
  -d '{"name":"Asha","email":"asha@example.com","password":"correct-horse-9","confirmPassword":"correct-horse-9"}' > /dev/null
curl -s "localhost:5000/auth/dev/latest-link?email=asha@example.com" | jq -r .email.link
# http://localhost:3000/auth/verify/<token>
# API log: [dev] email not sent (Gmail not authorized)
# (Outside production the dev mailbox is the one place the link is visible. It's never mounted in production.)

# 2. Deterministic ids: re-adding the same job is a no-op.
pnpm --filter api exec tsx -e 'import("./src/jobs/producers/email.producer").then(async ({ EmailProducer }) => {
  const p = { userId: "00000000-0000-7000-8000-000000000001", email: "a@example.com", resetToken: "t".repeat(64) };
  const a = await EmailProducer.sendPasswordReset(p); const b = await EmailProducer.sendPasswordReset(p);
  console.log(a.id === b.id, a.id); process.exit(0) })'
# true reset-00000000-…-<32 hex chars>      (no token in the id)

# 3. With GMAIL_REFRESH_TOKEN set: the email arrives in a real inbox; the job is "completed".
ENABLE_QUEUE_DASHBOARD=true QUEUE_DASHBOARD_USER=admin QUEUE_DASHBOARD_PASSWORD=change-me pnpm --filter api dev
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/admin/queues                       # 401
curl -s -o /dev/null -w "%{http_code}\n" -u admin:change-me localhost:5000/admin/queues/   # 200

# 4. Unrecoverable: set GMAIL_REFRESH_TOKEN=garbage, request a reset.
#    Bull Board: the job failed after 1 attempt (not 5), and dead-letter-queue has dead-<id>.

# 5. Purge: create an expired session row in psql, then run the processor once.
docker exec -it enquiry-postgres psql -U enquiry -d enquiry \
  -c "update sessions set expires_at = now() - interval '1 day' where id = '<id>';"
pnpm --filter api exec tsx -e 'import("./src/jobs/processors/purgeExpired.processor").then(async m => { console.log(await m.processPurgeExpired()); process.exit(0) })'
# { sessions: 1, verificationLinks: 0 }

# 6. Standalone worker
RUN_WORKERS_IN_API=false pnpm --filter api dev      # API: "workers run in the standalone process"
pnpm --filter api worker                            # worker health server on :8080
curl -s localhost:8080/health | jq .workers         # { "email": true, "maintenance": true }

# 7. COPY files unchanged
for f in config/gmail.ts services/gmail.service.ts controllers/gmailAuth.controller.ts routes/gmail.route.ts \
         utils/email/devMailbox.ts jobs/redis/connection.ts jobs/queues/{email,deadLetter,maintenance}.queue.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
pnpm --filter api typecheck && pnpm --filter api lint
```

Check the Postgres user and database names against Phase 00's `docker-compose.yml`. The ones above
assume `enquiry`.

## 8. Definition of done

- [ ] Verification and reset emails go through the queue; nothing in `auth.service.ts` sends mail inline.
- [ ] No `// Phase 08:` comments remain.
- [ ] Job ids for token emails contain a hash of the token, never the token.
- [ ] A revoked Gmail token fails a job once and lands it in the dead-letter queue.
- [ ] `purge-expired` is scheduled with `upsertJobScheduler` and deletes expired sessions and links.
- [ ] Bull Board is off by default, refuses to boot half-configured, and asks for Basic auth.
- [ ] `RUN_WORKERS_IN_API=false` + `pnpm worker` runs the same jobs in a separate process.
- [ ] COPY files are identical to PaperTrail's.
- [ ] Commit: `feat(api): BullMQ, dead-letter queue, system email via Gmail, purge job`.

## 9. Interview angle

*"Why put a password-reset email on a queue?"* So the request doesn't wait on Gmail and doesn't fail
when Gmail hiccups. The queue retries with backoff, and a deterministic job id means a retried request
can't send two emails. Failures that need a person, like a revoked token, are unrecoverable, so they
fail once and land in the dead-letter queue instead of retrying five times.

*"Which address does a customer reply come from?"* The business's own Gmail, connected with its own
OAuth grant and sealed per business. System mail uses the app's sender, in a different module with a
different OAuth client. That separation is structural: there's no code path where one could become the
other.

*"What's in your job payloads?"* Ids, plus the unavoidable token for an auth email. Never a customer
message or a draft. Redis and the queue dashboard are readable by more people and tools than the
database, so content stays in Postgres, and jobs read it by id.
