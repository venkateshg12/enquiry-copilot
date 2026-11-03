# Phase 12 — Messages, form intake, outbox

## 1. Goal

Accept customer messages without ever losing one:
- `POST /intake/form/:formKey`: public, CORS-limited to the business's allowed origins, with
  honeypot + fill-time checks, the three intake limiters (Phase 06) and Zod validation shared with the
  widget;
- a **Message** model with a status machine;
- a write that saves the message **and** an outbox event `message.received` in **one transaction**
  (PaperTrail's outbox + relay, copied), so the pipeline is always enqueued eventually;
- spam-flood protection: over the per-business daily cap, messages are saved as `held` (no AI).

## 2. What I will understand after this phase

1. Why the form endpoint answers fast (202) and processes in the background.
2. The dual-write problem and why the outbox solves it here.
3. How honeypot and fill-time checks work, and why they reply "success" to bots.
4. The message status machine and its conditional transitions.

## 3. Prerequisites

Phase 11 done.

## 4. Files

```
packages/types/src/message.ts                   NEW   (formSubmissionSchema — shared with the widget; statuses)
apps/api/src/
├── models/message.model.ts                     NEW
├── constants/messageStatus.ts                  NEW   (transition table)
├── services/intake.service.ts                  NEW
├── services/message.service.ts                 NEW   (transitionStatus, list with cursor, get)
├── models/outboxEvent.model.ts                 COPY  @pt-api/src/models/outboxEvent.model.ts
├── services/outbox.service.ts                  ADAPT @pt-api/src/services/outbox.service.ts   (event types below)
├── jobs/outbox/relay.ts                        COPY  @pt-api/src/jobs/outbox/relay.ts
├── jobs/outbox/dispatchers.ts                  ADAPT @pt-api/src/jobs/outbox/dispatchers.ts   (message.received → pipeline; reply.approved → send, Phase 22)
├── middleware/intakeCors.ts                    NEW   (per-business allowed origins)
├── routes/intake.route.ts · controllers/intake.controller.ts   NEW
├── routes/message.route.ts                     NEW   (GET /messages, GET /messages/:id)
└── worker.ts · index.ts                        ADAPT (startRelay / stopRelay in the shutdown order)
```

## 5. Concepts

**Fast acknowledgement.** The customer sees "Thanks, we'll get back to you" within ~100 ms. AI
processing (several seconds) happens in the worker. The spec's "don't block the form submit".

**The outbox, again.** `save message` + `enqueue pipeline` is a dual write: crash between them and the
message sits unprocessed forever. PaperTrail's solution is copied unchanged:

```ts
await withTransaction(async (session) => {
    const [message] = await MessageModel.create([{ … status: "received" }], { session });
    await emit(session, orgId, "message.received", { messageId: String(message._id), runId: String(runId) });
});
// relay (worker) → pipelineQueue.add("process", …, { jobId: `pipeline:${messageId}:${runId}` })
```

At-least-once dispatch plus a deterministic job id = exactly one pipeline run per message (per run id;
a "re-run AI" button creates a new run id, Phase 21).

**Bots.** Two cheap checks before any limiter is charged a model call:
- **honeypot**: a visually hidden `company_website` field (the widget sets `tabindex=-1`,
  `autocomplete=off`). Humans leave it empty; naive bots fill it;
- **fill time**: the widget sends `renderedAt`. A submission under 3 s after render is a bot.

Either check → respond `202 { ok: true }` exactly like a real submission, and **store nothing**.
Telling the bot it failed teaches it.

**Form keys.** Each business has a public `formKey` (`fk_` + 16 base62 characters, rotatable) that
identifies it in the widget. It's not a secret: it's in the page source. Abuse protection comes from
the limiters, the allowed-origins CORS check and the per-business cap, not from hiding the key.
Rotating it invalidates old embeds (so it's an owner action with a confirmation).

**Statuses.**

```
received → processing → needs_approval → approved → sent
                      ↘ spam            ↘ rejected
received → held (over the daily cap; "Process" button → received)
processing → failed (pipeline final failure; "Retry" → received with a new runId)
needs_approval → needs_approval (draft edited / re-drafted)
sent → (follow-ups arrive as NEW messages, linked by threadId)
```

All transitions go through `transitionStatus(orgId, id, to, { from })`, a conditional
`findOneAndUpdate` (PaperTrail's pattern). Two staff members can't both approve; the worker can't
overwrite an approval.

## 6. Steps

### 6.1 Shared schema (`@repo/types/message.ts`)

```ts
export const formSubmissionSchema = z.object({
    name: z.string().trim().min(1).max(120),
    contact: z.string().trim().min(5).max(200),          // email or phone; classified in code
    message: z.string().trim().min(2).max(4000),
    company_website: z.string().max(0).optional(),        // honeypot: must be empty
    renderedAt: z.number().int(),                          // ms epoch from the widget
    pageUrl: z.string().url().max(500).optional(),
});
```

### 6.2 Model

```ts
const messageSchema = new mongoose.Schema({
    orgId: { type: Schema.Types.ObjectId, required: true },
    channel: { type: String, enum: ["form", "email"], required: true },
    fromName: String,
    fromEmail: String,
    fromPhone: String,
    subject: String,
    body: { type: String, required: true, maxlength: 20_000 },
    receivedAt: { type: Date, required: true },
    status: { type: String, enum: MESSAGE_STATUSES, default: "received" },
    statusHistory: [{ status: String, at: Date, by: Schema.Types.ObjectId, note: String, _id: false }],
    runId: Schema.Types.ObjectId,                          // the pipeline run responsible (Phase 20)
    category: String,                                      // denormalised from the latest classify, for list filters
    flags: [String],                                       // denormalised check flags (Phase 19)
    threadKey: String,                                     // Gmail threadId, or a form thread id
    externalId: String,                                    // Gmail message id (dedupe, Phase 23)
    pageUrl: String,
    assignedTo: Schema.Types.ObjectId,
}, { timestamps: true });
messageSchema.index({ orgId: 1, status: 1, receivedAt: -1, _id: -1 });
messageSchema.index({ orgId: 1, receivedAt: -1, _id: -1 });
messageSchema.index({ orgId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: "string" } } });
messageSchema.plugin(tenantPlugin);
```

### 6.3 Intake service

```ts
export const acceptFormSubmission = async (formKey: string, raw: unknown, meta: { ip: string; origin?: string }) => {
    const business = await runAsSystem(() => OrgModel.findOne({ "settings.formKey": formKey }).select("_id settings").lean());
    appAssert(business, NOT_FOUND, "Form not found");

    const parsed = formSubmissionSchema.safeParse(raw);
    if (!parsed.success) {
        // A honeypot failure looks like a validation error to the schema; check it separately so bots get a fake 202.
        if (isHoneypotHit(raw)) return { accepted: true, stored: false };
        throw parsed.error;                                   // a real user with a bad field: 400 with field paths
    }
    if (Date.now() - parsed.data.renderedAt < 3000) return { accepted: true, stored: false };

    const { email, phone } = splitContact(parsed.data.contact, business.settings.defaultPhoneCountry);
    const overCap = !(await getDefaultStore().increment(`${INTAKE_BUSINESS_PREFIX}:${formKey}`, ONE_DAY_MS, INTAKE_BUSINESS_DAILY_CAP)).allowed;

    return runWithRequestContext({ requestId: getRequestId() ?? randomUUID(), orgId: String(business._id) }, () =>
        withTransaction(async (session) => {
            const runId = new Types.ObjectId();
            const [message] = await MessageModel.create([{
                orgId: business._id, channel: "form", fromName: parsed.data.name, fromEmail: email, fromPhone: phone,
                body: parsed.data.message, receivedAt: new Date(), pageUrl: parsed.data.pageUrl,
                status: overCap ? "held" : "received", runId, threadKey: `form:${randomUUID()}`,
                statusHistory: [{ status: overCap ? "held" : "received", at: new Date() }],
            }], { session });
            if (!overCap) await emit(session, business._id, "message.received", { messageId: String(message._id), runId: String(runId) });
            return { accepted: true, stored: true, messageId: message._id };
        })
    );
};
```

### 6.4 Route and CORS

```ts
intakeRouter.post("/form/:formKey", intakeCors, intakeIpLimiter, intakeVisitorLimiter, express.json({ limit: "16kb" }), intakeFormHandler);
```

`intakeCors` reads the business's `allowedOrigins` (set in `/settings/channels`; `localhost` allowed in
development) and answers preflights itself. An origin that isn't allowed gets no CORS headers, so the
browser blocks the response. That's not a security boundary against scripts, just against other sites
embedding the form. The controller always answers `202 { ok: true }` on acceptance (stored or not).

The global `express.json()` in `app.ts` must not run first with a bigger limit: mount the intake router
**before** it, as PaperTrail mounts raw-body routes.

### 6.5 Outbox wiring

Copy the model, service and relay. `dispatchers.ts` handles `message.received` → `pipelineQueue.add`
(the queue arrives in Phase 20; until then, log). Add `startRelay()` / `stopRelay()` per PaperTrail's
`worker.ts` / `index.ts`.

### 6.6 Messages API

`GET /messages?status&category&flag&cursor` (cursor pagination, Phase 03 helpers) and
`GET /messages/:id`, with `messages.read`.

## 7. Verify

```bash
FK=<formKey from the demo business>
curl -s -XPOST localhost:5000/intake/form/$FK -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d "{\"name\":\"Ravi\",\"contact\":\"ravi@example.com\",\"message\":\"Python weekend batch fee?\",\"renderedAt\":$(( $(date +%s%3N) - 10000 ))}"
# 202 {"ok":true}; db.messages has it (status received); db.outboxevents has message.received → dispatched
```

- Honeypot filled → 202 and **nothing stored**. `renderedAt` = now → 202, nothing stored.
- An empty `message` → 400 with the field path.
- 6 posts in 10 minutes from one visitor → 429.
- Set the cap to 2 → the 3rd message is stored as `held`, with no outbox event.
- Throw after `MessageModel.create` inside the transaction → no message, no event.
- An unknown form key → 404.

## 8. Definition of done

- [ ] Form intake is fast, validated, bot-filtered, limited and capped.
- [ ] Message + outbox event in one transaction; the relay runs in the worker.
- [ ] A status machine with conditional transitions.
- [ ] Commit: `feat: form intake, messages and outbox`.

## 9. Interview angle

*"How do you make sure no customer message is lost?"* The message and its "process me" event are
written in one transaction, and a relay dispatches events with retries and deterministic job ids. Bots
are filtered by a honeypot and timing check that look like success to them, and a flood against one
business is held rather than processed, so it can't run up the AI bill.
