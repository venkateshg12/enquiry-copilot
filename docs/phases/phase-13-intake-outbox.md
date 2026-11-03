# Phase 13 — Messages, form intake, transactional outbox

## 1. Goal

Accept customer messages **without ever losing one**:
- `Message`, `IntakeForm` and `OutboxEvent` tables (migration `intake`);
- forms per business: `GET/POST/PATCH /orgs/:orgId/forms`, `POST …/forms/:id/rotate-key`, each with
  its own public `formKey` and **allowed origins**;
- `POST /intake/form/:formKey`: public, CORS per form, honeypot + minimum fill time, the Phase 06
  intake limiters, a per-business daily cap, Zod validation shared with the widget, and retry dedupe
  by `clientSubmissionId`;
- one transaction writes the `Message` **and** an outbox event `message.received`;
- PaperTrail's **outbox relay** (`FOR UPDATE SKIP LOCKED`) running in the worker. Its dispatcher for
  `message.received` is wired to the pipeline in Phase 21;
- the message **status machine** (`constants/messageStatus.ts`) and a conditional `transitionStatus`.

## 2. What I will understand after this phase

1. The dual-write problem (save + enqueue) and why the outbox solves it.
2. Why the relay claims rows with `FOR UPDATE SKIP LOCKED`, and why delivery is at-least-once.
3. Why bots get a fake success, and why the honeypot is off-screen rather than `display: none`.
4. Why a form key isn't a secret, and what actually protects the endpoint.
5. How a unique index turns a retried submission into a no-op.

## 3. Prerequisites

- Phase 12 done.
- Phase 06's intake limiters exist in `config/rateLimiter.ts` (`intakePunitiveLimiter`,
  `intakeDualLimiter`, `intakeFormLimiter`) and `checkIntakeCap(orgId)` in
  `services/intakeCap.service.ts`.
- Phase 08's worker entry point (`src/worker.ts`) and maintenance queue.

## 4. Files

```
packages/types/src/
├── message.ts                                 NEW    (formSubmissionSchema — shared with the widget; statuses; list query)
├── intakeForm.ts                              NEW    (form create/update schemas, origin validation)
└── events.ts                                  ADAPT  @pt-root/packages/types/src/events.ts  (message.received only)
apps/api/
├── prisma/schema.prisma                       ADAPT  (+ Channel, MessageStatus, Category, OutboxStatus; Message, IntakeForm; OutboxEvent COPY)
├── prisma/migrations/<ts>_intake/             NEW
└── src/
    ├── db/prisma.ts                           ADAPT  (TENANT_MODELS += "Message", "IntakeForm", "OutboxEvent")
    ├── constants/messageStatus.ts             NEW    (transition table)
    ├── constants/env.ts                       (INTAKE_DAILY_CAP already added in Phase 06)
    ├── services/outbox.service.ts             COPY   @pt-api/src/services/outbox.service.ts
    ├── types/outbox.types.ts                  COPY   @pt-api/src/types/outbox.types.ts
    ├── jobs/outbox/relay.ts                   COPY   @pt-api/src/jobs/outbox/relay.ts
    ├── jobs/outbox/dispatchers.ts             ADAPT  @pt-api/src/jobs/outbox/dispatchers.ts  (message.received; no webhooks)
    ├── services/intake.service.ts             NEW
    ├── services/intakeForm.service.ts         NEW
    ├── services/message.service.ts            NEW    (transitionStatus)
    ├── middleware/intakeCors.ts               NEW    (per-form allowed origins, own preflight)
    ├── controllers/{intake,intakeForm}.controller.ts   NEW
    ├── routes/intake.route.ts                 NEW    (/intake/form/:formKey — mounted BEFORE cors() and express.json())
    ├── routes/intakeForm.route.ts             NEW    (/orgs/:orgId/forms)
    ├── worker.ts · index.ts                   ADAPT  @pt-api/src/{worker,index}.ts  (startRelay / stopRelay in the shutdown order)
    └── app.ts                                 ADAPT  (mount order)
apps/api/test/tenancy.routes.ts                ADAPT  (+ form routes)
```

## 5. Concepts

**Fast acknowledgement.** The customer sees "Thanks, we'll get back to you" within ~100 ms. Classify,
extract and draft take seconds and run in the worker (spec: "don't block the form submit"). The
endpoint answers `202 { ok: true }`.

**The dual write.** "Insert the message, then enqueue the pipeline" fails if the process dies between
the two: a message sits in the database that nothing will ever process. "Enqueue, then insert" fails
the other way: a job for a message that doesn't exist. The outbox makes it one write:

```ts
await withTransaction(async (tx) => {
    const message = await tx.message.create({ data: { …, status: "received" } });
    await emit(tx, orgId, "message.received", { messageId: message.id, attempt: 1 });
});
```

The event row commits with the message or not at all. The relay (in the worker) claims committed rows
and dispatches them. If dispatch fails, the row goes back to `pending` with exponential backoff (2 s,
4 s, … capped at 10 min). Delivery is **at-least-once**, so every consumer dedupes. The pipeline job
id is `pipeline-<messageId>-<attempt>` (Phase 21), so a second dispatch of the same event is a BullMQ
no-op.

**Claiming without blocking.** `relay.ts` (COPY) claims one row at a time:
`UPDATE … WHERE id = (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …`, setting `dispatching`
with a 30 s lease. Two relays (two worker replicas) never claim the same row and never wait on each
other. A relay that crashes mid-dispatch leaves a lease that expires, and the row is claimed again.
It's raw SQL, so it bypasses the tenant extension. That's correct, because the relay serves every
business; it sets each event's `orgId` into the request context before dispatching.

**Not yet wired.** The pipeline queue arrives in Phase 21. Until then, `dispatchers.ts` **throws** for
`message.received`:
```ts
case "message.received":
    // Phase 21: pipelineQueue.add(JOB_NAMES.PIPELINE.PROCESS, …, { jobId: `pipeline-${messageId}-${attempt}` })
    throw new Error("pipeline not wired yet (Phase 21)");
```
The events stay `pending` with backoff and dispatch by themselves once Phase 21 lands. Nothing
received during Phases 13–20 is lost, and no event is marked done that wasn't.

**Bots.** Two cheap checks, before any model call and before the daily cap is charged:
- **honeypot**: a field named `company_website`, positioned off-screen (some bots skip
  `display:none` fields), `tabindex=-1`, `autocomplete=off`, inside an `aria-hidden` wrapper.
  Humans never fill it;
- **fill time**: the widget sends `renderedAt`. A submit under **2 s** after render is a bot
  (data-handling.md).

Either check → `202 { ok: true }` exactly like a real submission, and **nothing stored**. Telling a
bot it failed teaches it.

**Form keys aren't secrets.** A `formKey` (22 base62 characters, unique) is in the business's page
source. What protects the endpoint: the per-IP and per-form limiters, the allowed-origins CORS check,
the daily cap, and the fact that the worst a flood can do is fill one business's inbox, not run up a
model bill past the cap. Rotating the key (owner/admin action, confirmed) invalidates old embeds.

**CORS per form.** The global `cors({ origin: CORS_ORIGIN })` in `app.ts` is for the web app. The
intake router is mounted **before** it, with its own `intakeCors`:
- it loads the form by key (cached 60 s), and if `Origin` is in `allowedOrigins` (exact match,
  scheme + host + port), it sets `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, and answers
  `OPTIONS` itself (`Allow-Methods: POST`, `Allow-Headers: content-type, x-enquiry-visitor`,
  `Max-Age: 600`). `X-Enquiry-Visitor` is the widget's visitor id, Phase 06's fairness key;
- no credentials. The widget posts with `credentials: "omit"`;
- in development, `http://localhost:*` is allowed for any form;
- an unknown origin gets no CORS headers, so the browser blocks the response. CORS isn't a defence
  against scripts (curl ignores it). It stops other websites embedding someone else's form.

The intake router also has its own `express.json({ limit: "16kb" })`, mounted before the global 1 MB
parser.

**The daily cap.** `checkIntakeCap(orgId)` from Phase 06 (`INTAKE_DAILY_CAP`, default 300 per
business per day). It's called only for a submission that will be stored (after the bot checks). Over
the cap, the message is **still stored** (a real customer may be among the flood), with status
`needs_attention`, `statusReason = "intake_cap"` and **no outbox event**, so no model runs. Phase 22's
`POST /orgs/:orgId/messages/reprocess-waiting` releases held messages. An audit row `intake.over_daily_cap` (actor `system`, target the
message) tells Phase 23's inbox why it wasn't processed and offers "Process now".

**Retries are no-ops.** The widget generates a `clientSubmissionId` (a UUID) once per submit and
reuses it on retry. `@@unique([orgId, clientSubmissionId])` makes a second insert fail with `P2002`.
`isUniqueViolation` from `db/errors.ts` catches it and the endpoint answers 202 again. The first
transaction already emitted the event, so the pipeline runs once.

**Status machine** (`constants/messageStatus.ts`, from `data-model.md`'s `MessageStatus`):

```ts
export const MESSAGE_TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
    received:        ["processing", "needs_attention", "spam"],
    processing:      ["ready", "needs_attention", "spam"],
    ready:           ["approved", "rejected", "spam", "processing"],   // processing = reprocess (Phase 23)
    needs_attention: ["processing", "rejected", "spam"],
    spam:            ["processing"],                                    // "not spam" → reprocess
    approved:        ["sent", "ready"],                                 // ready = send failed and was reopened (Phase 24)
    sent:            [],
    rejected:        ["processing"],
};
```

`transitionStatus(id, to, { from })` does `prisma.message.updateMany({ where: { id, status: { in: from } }, data: { status: to } })`
and returns `count === 1`. It's a compare-and-set: two reviewers can't both approve, and a slow worker
can't overwrite an approval. Every caller passes the statuses it expects to leave.

## 6. Steps

### 6.1 Schema

Copy `enum OutboxStatus` and `model OutboxEvent` from `@pt-api/prisma/schema.prisma` (statuses
`pending | dispatching | dispatched`, `lockedUntil`, the `(status, next_attempt_at)` index). Add
`Channel`, `MessageStatus`, `Category`, `IntakeForm` and `Message` exactly as in `data-model.md`, with
back-relations on `Org` (`messages`, `intakeForms`, `outboxEvents`). Migrate `--name intake`. Add the
three models to `TENANT_MODELS`.

### 6.2 Shared schema (`@repo/types/message.ts`)

```ts
export const formSubmissionSchema = z.object({
    name: z.string().trim().min(1).max(120),
    contact: z.string().trim().min(5).max(200),        // an email or a phone; split in code
    message: z.string().trim().min(2).max(5000),
    company_website: z.string().max(0).optional(),     // the honeypot: must be empty
    renderedAt: z.number().int().positive(),           // ms epoch, set by the widget on mount
    clientSubmissionId: z.string().uuid(),
});
export type FormSubmission = z.infer<typeof formSubmissionSchema>;
```

The widget (Phase 14) validates with a hand-written equivalent and a test that the two agree.

### 6.3 Intake service

```ts
export const acceptFormSubmission = async (formKey: string, raw: unknown) => {
    const form = await runAsSystem(() => prisma.intakeForm.findUnique({
        where: { formKey }, include: { org: { select: { id: true, timezone: true } } },
    }));
    appAssert(form && form.enabled, NOT_FOUND, "Form not found");

    if (isHoneypotHit(raw) || isTooFast(raw)) return { stored: false };   // fake success
    const input = formSubmissionSchema.parse(raw);                         // a real person's typo → 400 with paths

    const { allowed } = await checkIntakeCap(form.orgId);                  // Phase 06

    return runWithRequestContext({ requestId: getRequestId() ?? randomUUID(), orgId: form.orgId }, async () => {
        try {
            return await withTransaction(async (tx) => {
                const message = await tx.message.create({ data: {
                    orgId: form.orgId, channel: "form", formId: form.id,
                    fromName: input.name, fromContact: input.contact, body: input.message,
                    receivedAt: new Date(), clientSubmissionId: input.clientSubmissionId,
                    status: allowed ? "received" : "needs_attention",
                    statusReason: allowed ? null : "intake_cap",
                } });
                if (allowed) await emit(tx, form.orgId, "message.received", { messageId: message.id, attempt: 1 });
                else await recordAudit({ orgId: form.orgId, actor: { type: "system" },
                    action: "intake.over_daily_cap", target: { type: "message", id: message.id } }, tx);
                return { stored: true };
            });
        } catch (error) {
            if (isUniqueViolation(error)) return { stored: true };            // a retry of the same submission
            throw error;
        }
    });
};
```

`isTooFast` reads `renderedAt` defensively (`typeof raw?.renderedAt === "number" && Date.now() - raw.renderedAt < 2000`).
The honeypot check runs before Zod, because a filled honeypot fails the schema (`max(0)`) and must not
become a 400 that tells the bot why.

### 6.4 Forms

`intakeForm.service.ts`: `createForm(orgId, { name, allowedOrigins })` with
`formKey = randomBase62(22)` (retry once on `P2002`), `updateForm`, `rotateKey`, `listForms`.
`allowedOrigins` entries are validated as origins: `new URL(o).origin === o`, `https:` only except
`http://localhost[:port]`, at most 10. Routes `/orgs/:orgId/forms` behind `forms.manage` (list:
`messages.read`). After any change, `cache.del("cache:intake-form:<formKey>")` (old and new key on
rotate).

### 6.5 Routes and mount order

```ts
// routes/intake.route.ts
export const intakeRouter = Router();
intakeRouter.options("/form/:formKey", intakeCors);
// Phase 06's order: the punitive lock first (a locked IP costs one Redis call), then visitor + IP,
// then the per-form burst limit.
intakeRouter.post("/form/:formKey", intakeCors, intakePunitiveLimiter, intakeDualLimiter, intakeFormLimiter,
    express.json({ limit: "16kb" }), intakeFormHandler);

// app.ts — before cors() and express.json()
app.use("/intake", intakeRouter);
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));
```

The controller always answers `202 ok({ ok: true })` when the service returns, whether or not the
message was stored.

### 6.6 Relay

Copy `relay.ts`, `outbox.service.ts`, `outbox.types.ts`. Adapt `@repo/types/events.ts` to one event
for now:
```ts
export const eventTypeSchema = z.enum(["message.received"]);   // Phase 24 adds "reply.approved"
export const messageReceivedPayloadSchema = z.object({ messageId: z.string().uuid(), attempt: z.number().int().min(1) });
export const eventSchemas = { "message.received": messageReceivedPayloadSchema } as const;
```
`dispatchers.ts`: the `message.received` case throws as shown in §5. Remove the webhook fan-out and
`publishProgress` (Phase 21 publishes inbox updates). In `worker.ts`, call `startRelay()` after the
workers start, and `await stopRelay()` first in the shutdown order (stop claiming before closing
queues and Postgres). That's PaperTrail's order.

The relay is PaperTrail's polling loop (200 ms when busy, 2 s when idle), not a BullMQ job. Dispatch
latency is ~0–2 s, and a loop avoids a job per tick.


**Purge.** Add a rule to Phase 08's `purge-expired`: delete `outbox_events` with
`status = 'dispatched'` and `dispatched_at` older than 7 days (PaperTrail's rule). Pending and failed
rows are never purged.
## 7. Verify

```bash
pnpm --filter api db:migrate:dev --name intake
FORM=$(curl -s -b a.txt -XPOST localhost:5000/orgs/$ORG/forms -H 'content-type: application/json' \
  -d '{"name":"Website","allowedOrigins":["https://codenest.example"]}' | jq -r .data.formKey)

NOW=$(date +%s%3N); ID=$(uuidgen)
body() { echo "{\"name\":\"Ravi\",\"contact\":\"ravi@example.com\",\"message\":\"Python weekend batch fee?\",\"renderedAt\":$(( NOW - 10000 )),\"clientSubmissionId\":\"$ID\"}"; }
curl -s -i -XPOST localhost:5000/intake/form/$FORM -H 'origin: https://codenest.example' \
  -H 'content-type: application/json' -d "$(body)" | grep -E 'HTTP|access-control-allow-origin'
# HTTP/1.1 202 Accepted
# access-control-allow-origin: https://codenest.example
psql $DATABASE_URL -c "select status from messages; select type, status, attempts from outbox_events;"
# received | message.received, pending (attempts climbing: "pipeline not wired yet (Phase 21)")
```

- Same request again (same `clientSubmissionId`) → 202; still one message, one event.
- Honeypot filled → 202, nothing stored. `renderedAt` = now → 202, nothing stored.
- Empty `message` → 400 with `message` in the field errors.
- `origin: https://evil.example` → 202 but **no** `access-control-allow-origin` header (a browser would
  block the response).
- `OPTIONS` from the allowed origin → 204 with the allow headers.
- Unknown form key → 404. Disabled form → 404.
- `INTAKE_DAILY_CAP=2`: the 3rd message is `needs_attention` with `statusReason = "intake_cap"`, has no outbox event, and has an
  `intake.over_daily_cap` audit row.
- Throw inside the transaction after `message.create` (temporary `throw`) → no message and no event.
- Two worker processes (`pnpm --filter api worker` twice): `attempts` increments once per backoff
  step, never twice at once (SKIP LOCKED).
- Rotate the key → the old key → 404.

## 8. Definition of done

- [ ] `intake` migrated; the three models in `TENANT_MODELS`.
- [ ] Form intake: fast 202, validated, bot-filtered with fake success, limited, capped, retry-safe.
- [ ] Message + `message.received` in one transaction; the relay runs in the worker with SKIP LOCKED;
      undispatchable events wait (not lost) until Phase 21.
- [ ] Per-form CORS on the intake router, mounted before the global CORS and JSON parser.
- [ ] `transitionStatus` with the transition table.
- [ ] Forms API with key rotation; routes added to `test/tenancy.routes.ts`.
- [ ] Commit: `feat: form intake, messages and the transactional outbox`.

## 9. Interview angle

*"How do you make sure no customer message is ever lost?"* The message and its "process me" event are
written in one database transaction, so there's no moment where one exists without the other. A relay
in the worker claims committed events with `FOR UPDATE SKIP LOCKED`, so several workers can run without
double-claiming, and dispatches them with backoff. The pipeline job has a deterministic id, so
at-least-once delivery still means one run. Bots get a fake success from a honeypot and a fill-time
check, a retried submit is a no-op thanks to a unique index, and a flood against one business is stored
but not processed, so it can't run up the model bill.
