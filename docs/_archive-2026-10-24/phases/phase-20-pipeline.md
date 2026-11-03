# Phase 20 — The pipeline job, AI results, live updates

## 1. Goal

Run classify → extract → draft → checks for every received message, in the background, reliably:
- the outbox relay (Phase 12) enqueues `pipeline:<messageId>:<runId>`;
- one **pipeline job** runs the four steps in order, saving an **AI result** per step (with
  `promptVersion`, model, cost, latency, raw output) and moving the message `received → processing →
  needs_approval` (or `spam`, or `failed`);
- step results are **resumable**: a retried job skips the steps already saved for this run;
- `extractInMemory`-style **`processMessage()`** is shared with the eval (Phase 27);
- **SSE** updates the inbox live (PaperTrail's pub/sub, per business);
- "Re-run AI" from the inbox creates a new run.

## 2. What I will understand after this phase

1. Why one job with resumable steps (not a flow of four jobs) is enough here.
2. How deterministic ids plus per-step upserts make retries cheap and safe.
3. Which failures retry, which degrade (a missing draft still reaches the inbox), and which fail the
   message.
4. Why the eval must call the same `processMessage()`.

## 3. Prerequisites

Phase 19 done.

## 4. Files

```
packages/types/src/pipeline.ts                  ADAPT (+ AiResult, steps)
apps/api/src/
├── models/aiResult.model.ts                    NEW
├── pipeline/processMessage.ts                  NEW   (the shared core: steps with injected persistence)
├── jobs/queues/pipeline.queue.ts               NEW   (shape of @pt-api/src/jobs/queues/email.queue.ts)
├── jobs/processors/pipeline.processor.ts       NEW
├── jobs/workers/pipeline.worker.ts             NEW
├── jobs/outbox/dispatchers.ts                  ADAPT (message.received → pipelineQueue)
├── jobs/deadLetter.ts                          ADAPT @pt-api/src/jobs/deadLetter.ts   (onFinalFailure → message failed)
├── utils/events/{pubsub,sse,streamLimiter}.ts  ADAPT @pt-api/src/utils/events/       (channel en:events:<orgId>; message progress)
├── routes/{events,message}.route.ts            ADAPT (GET /events, POST /messages/:id/rerun)
└── worker.ts                                   ADAPT (close pipelineWorker)
```

## 5. Concepts

**One job, resumable steps.** PaperTrail used a BullMQ flow because pages run in parallel. Here the
steps are strictly sequential and short (seconds), so one job is simpler. Each step:
1. checks for an existing `AiResult { messageId, runId, step }` → reuse it (a retry after a crash in
   draft doesn't re-pay classify and extract);
2. otherwise calls the step and **upserts** the result (unique on `{ messageId, runId, step }`).

**Failure policy.**

| Failure | Policy |
| --- | --- |
| `ProviderUnavailable` (both models down) in any step | throw → backoff (4 attempts, 10 s → 80 s, jitter) |
| `SchemaViolation` after the one repair (classify/extract) | the step is saved as `status: "failed"`; the **pipeline continues** with what it has: no classify → category "other", no extract → empty details. The draft still runs |
| draft fails after retries | the message reaches `needs_approval` **without a draft**; the inbox shows "Write a reply" (the human path always exists) |
| malformed payload / message deleted | `UnrecoverableError` |
| final failure of the whole job | message `failed` + DLQ row (PaperTrail's `onFinalFailure`) + Sentry if configured; "Retry" in the inbox |

The principle: **degrade towards the human, never towards silence.** A customer message must always
reach the inbox.

**Spam stop.** `shouldStopAsSpam` → message `spam`, no extract or draft. The inbox's spam folder lets
staff rescue a false positive with "Not spam → process".

**Timing.** The spec's target is under 15 s from message to draft. Record `pipelineMs` on the message
(job start → `needs_approval`) and queue wait (`createdAt` → job start). Phase 25 shows p50/p95.

**Same core everywhere.** `processMessage(msg, deps)` takes the message, the business (profile + info
entries) and a `deps` object (`generateJson`, `generateText`, a `save` callback). The worker passes a
Mongo-saving `save`; the eval passes an in-memory one. The prompts, checks and order are identical:
PaperTrail's `extractInMemory` lesson.

## 6. Steps

### 6.1 AI result model

```ts
const aiResultSchema = new mongoose.Schema({
    orgId: { type: Schema.Types.ObjectId, required: true },
    messageId: { type: Schema.Types.ObjectId, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    step: { type: String, enum: ["classify", "extract", "draft", "checks"], required: true },
    status: { type: String, enum: ["ok", "failed", "skipped"], required: true },
    output: Schema.Types.Mixed,              // classify/extract JSON, draft {text,…}, checks {flags, maskedText}
    rawOutput: String,                       // the model's raw text, for debugging (redacted from logs)
    issues: [Schema.Types.Mixed],            // extract post-check issues
    promptVersion: String, modelKey: String, fellBack: Boolean,
    tokensIn: Number, tokensOut: Number, costUsdMicros: Number, latencyMs: Number,
    infoEntryIds: [Schema.Types.ObjectId], infoSheetVersion: Number,
    error: { code: String, message: String },
}, { timestamps: true });
aiResultSchema.index({ messageId: 1, runId: 1, step: 1 }, { unique: true });
aiResultSchema.plugin(tenantPlugin);
```

(Use `modelKey`, never `model`: the Mongoose `Document.model()` clash from PaperTrail's lessons.)

### 6.2 `processMessage`

```ts
export const processMessage = async (msg: MessageCtx, biz: BusinessCtx, deps: PipelineDeps) => {
    const step = async <T>(name: Step, run: () => Promise<StepOutcome<T>>) => (await deps.load(name)) ?? deps.save(name, await run());

    const classify = await step("classify", () => safeStep(() => classifyMessage({ body: msg.body, channel: msg.channel, subject: msg.subject, messageId: msg.id })));
    const category = classify.status === "ok" ? classify.output.category : "other";
    if (classify.status === "ok" && shouldStopAsSpam(classify.output)) return { outcome: "spam" as const, category };

    const extract = await step("extract", () => safeStep(() => extractDetails({ ...msg, business: biz, services: biz.services })));
    const details = extract.status === "ok" ? extract.output.details : emptyDetails();

    const draft = await step("draft", () => safeStep(() => draftReply({ msg, biz, category, details, language: classify.output?.language })));
    if (draft.status !== "ok") return { outcome: "needs_approval" as const, category, details, draft: null };

    const checks = await step("checks", async () => ({ status: "ok", output: runChecks({ draft: draft.output.text, entries: biz.entriesById(draft.output.infoEntryIds), message: msg, details, tz: biz.timezone }) }));
    return { outcome: "needs_approval" as const, category, details, draft: draft.output, checks: checks.output };
};
```

`safeStep` converts a `SchemaViolation` (after the step's own repair) into `{ status: "failed" }` and
**rethrows** `ProviderUnavailable` (so the job backs off).

### 6.3 Processor

1. Parse the payload, inside `runWithRequestContext({ orgId, messageId })`.
2. Load the message; check that `runId` matches.
3. `transitionStatus(received → processing)`.
4. Run `processMessage` with Mongo `load`/`save`.
5. On completion:
   - set `category`, `flags` (denormalised) and `pipelineMs`;
   - `transitionStatus(processing → needs_approval | spam)`;
   - `publishProgress(orgId, { messageId, status })`;
   - booking side effects (Phase 24) on `booking` + details.

Worker concurrency 8 (the leases pace the provider). Queue: `attempts: 4`,
`backoff: { type: "exponential", delay: 10_000, jitter: 0.5 }`.

### 6.4 Re-run

`POST /messages/:id/rerun` (`messages.reply`), allowed from `needs_approval`, `failed`, `spam`, `held`:
a new `runId`, `transitionStatus(→ received)` + `emit("message.received")` in one transaction. The
inbox shows the latest run's results and keeps old runs in a "history" tab.

### 6.5 SSE

Copy PaperTrail's pub/sub, SSE and stream limiter. The channel is `en:events:<orgId>` and the message
is `{ messageId, status, category?, flags?, at }`, with no customer text (PII never goes over pub/sub).
`GET /events?orgId=` for the inbox.

## 7. Verify

1. Submit a form message → within seconds `needs_approval`, with 4 AI results (classify, extract,
   draft, checks), each with prompt version, model and cost. The inbox stream received the status
   change.
2. Kill the worker after classify → restart → the job resumes, classify is **not** called again (check
   `aiCalls`).
3. Fake provider: classify JSON invalid twice → classify `failed`, category "other", the draft still
   produced.
4. Draft provider down permanently → `needs_approval` without a draft.
5. A spam message → `spam`; one model call only.
6. Re-run → a new run id; the old results kept; the latest shown.
7. `pipelineMs` recorded; on the demo setup under 15 s at p95 for 20 messages (measure, then write it
   down).

## 8. Definition of done

- [ ] Resumable pipeline with per-step results and the degrade-to-human policy.
- [ ] `processMessage` shared (the eval uses it in Phase 27).
- [ ] Live inbox updates; re-run with new run ids; DLQ on final failure.
- [ ] Commit: `feat: background AI pipeline`.

## 9. Interview angle

*"What happens when the AI fails?"* Steps degrade towards the human. A failed classify becomes "other",
a failed extract gives empty details, a failed draft means staff write the reply themselves, so a
customer message always reaches the inbox. Steps are saved as they finish, so a retry never pays twice,
and the eval runs the exact same function.
