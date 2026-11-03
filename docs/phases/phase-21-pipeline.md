# Phase 21 — The pipeline job, AI results, SSE, DLQ

## 1. Goal

Run classify → extract → select info → draft → checks for every received message, in the
background, reliably, and show the result live:

- the outbox dispatcher for `message.received` (left as a `// Phase 21:` comment in Phase 13) enqueues
  one **`process-message`** job;
- the job runs the steps **in order** and **checkpoints after each one** in a single `AiResult` row
  (`stage`), so a retry resumes from the last finished step instead of paying for classify again;
- every model call writes a **`ModelCall`** row (purpose, model, prompt version, tokens, latency,
  outcome);
- the message moves `received → processing → ready | spam | needs_attention` through **conditional
  updates**, never read-modify-write;
- `category`, `possibleSpam` and `strongFlags` are denormalised onto `Message` so the inbox list
  never joins;
- final failures go to the **dead-letter queue** with a replay action;
- **SSE** pushes status changes to the inbox, per business;
- `POST …/messages/:id/reprocess` creates attempt `n+1`.

The core, `processMessage(ctx, deps)`, is shared with the eval (Phase 29): same prompts, same order,
same checks, different persistence.

## 2. What I will understand after this phase

1. Why one checkpointed job beats a BullMQ flow here (architecture.md §1).
2. How a deterministic job id plus a per-attempt row make retries cheap and safe.
3. Which failures retry, which degrade (the message still reaches a human), and which are terminal.
4. Why status changes are conditional `updateMany` calls, and what `count === 0` means.
5. Why no customer text ever goes over pub/sub, SSE or a job payload.

## 3. Prerequisites

- Phases 13 (Message, outbox, relay), 15 (model layer), 16–20 (the step functions and `runChecks`)
  done.
- `docker compose up -d`; `LLM_PROVIDER=fake` works for everything in **Verify**.

## 4. Files

```
apps/api/prisma/schema.prisma                         ADAPT  (+ PipelineStage, ModelPurpose, AiResult, ModelCall)
apps/api/prisma/migrations/<ts>_pipeline/             NEW    (generated)
apps/api/src/
├── db/prisma.ts                                      ADAPT  (TENANT_MODELS += AiResult, ModelCall)
├── constants/queue.ts                                ADAPT  @pt-api/src/constants/queue.ts      (+ PIPELINE_QUEUE, DEAD_LETTER_QUEUE)
├── constants/messageStatus.ts                        NEW    (ALLOWED_FROM transition table; shape of @pt-api/src/constants/documentStatus.ts)
├── pipeline/processMessage.ts                        NEW    (the shared core)
├── services/message.service.ts                       ADAPT  (+ transitionStatus, shape of @pt-api/src/services/document.service.ts)
├── services/aiResult.service.ts                      NEW    (load/save checkpoints)
├── services/modelCall.service.ts                     NEW    (the call recorder → ModelCall rows)
├── services/dlq.service.ts                           ADAPT  @pt-api/src/services/dlq.service.ts (document → message)
├── controllers/{dlq,events,message}.controller.ts    ADAPT  @pt-api/src/controllers/{dlq,events}.controller.ts · + reprocess
├── routes/{dlq,events,message}.route.ts              ADAPT  @pt-api/src/routes/{dlq,events}.route.ts
├── jobs/queues/{pipeline,deadLetter}.queue.ts        NEW / COPY @pt-api/src/jobs/queues/deadLetter.queue.ts
├── jobs/producers/pipeline.producer.ts               NEW
├── jobs/processors/processMessage.processor.ts       NEW
├── jobs/workers/pipeline.worker.ts                   NEW    (shape of @pt-api/src/jobs/workers/document.worker.ts)
├── jobs/deadLetter.ts                                ADAPT  @pt-api/src/jobs/deadLetter.ts       (onFinalFailure → needs_attention)
├── jobs/outbox/dispatchers.ts                        ADAPT  (resolve the Phase 13 comment)
├── utils/events/{pubsub,sse,streamLimiter}.ts        ADAPT  @pt-api/src/utils/events/            (channel ea:events:<orgId>, MessageEvent)
└── worker.ts                                         ADAPT  (start/close pipelineWorker)
packages/types/src/pipeline.ts                        ADAPT  (+ aiResultView, messageEvent, reprocess schemas)
```

Read `@pt-api/src/jobs/deadLetter.ts`, `services/dlq.service.ts` and `utils/events/*` before
starting. They're short, and the adaptations below only rename the subject (`documentId` →
`messageId`) and the channel prefix (`pt:` → `ea:`).

## 5. Concepts

### 5.1 One job, checkpointed

```
process-message { orgId, messageId, attempt }       jobId = pipeline-<messageId>-<attempt>
  load AiResult(messageId, attempt)  ── none → create (stage = null)
  stage < classified  → classify            → save, stage = classified
  spam ≥ 0.8?         → status spam, stop
  stage < extracted   → extract             → save, stage = extracted
  stage < drafted     → selectInfo + draft  → save, stage = drafted   (infoEntryIds stored)
  stage < checked     → runChecks           → save, stage = checked
  status ready, denormalise, publish
```

The job id is **deterministic**. A second dispatch of the same outbox event (the relay is
at-least-once) is a no-op in BullMQ. BullMQ rejects custom ids containing `:` in most forms, which
is why PaperTrail uses dashes (`ingest-<runId>`), and so does this project.

`stage` is the checkpoint. A worker killed after extract costs one more draft call on retry, never
another classify and extract. Each save is one `update` on the attempt's row, so there's no partial
state to reconcile.

**Rejected alternative:** a BullMQ flow of four child jobs. PaperTrail needs a flow because pages run
in parallel. A message has strictly sequential steps of a few seconds each, so a flow would add four
job records, parent/child failure semantics and more Redis traffic for no parallelism. Phase 33's ADR
records this.

### 5.2 Degrade towards the human, never towards silence

| Failure | Policy |
| --- | --- |
| `ProviderUnavailable`, `ProviderBusy`, `ProviderTimeout` (all models down or saturated) | rethrow → BullMQ backoff: 4 attempts, exponential from 10 s, jitter 0.5 |
| `SchemaViolation` after the one repair (classify) | `category = null`, stage advances; the inbox shows "Couldn't classify" and the draft still runs as `other` |
| `SchemaViolation` after the repair (extract) | `extracted = { …empty, issues: ["extract_failed"] }`, stage advances |
| draft fails after retries of the provider | no draft; status `needs_attention`, `statusReason = "draft_failed"`; the inbox opens an empty editor ("Write your own reply") |
| message deleted, payload invalid | `UnrecoverableError` |
| last attempt fails for any other reason | `onFinalFailure`: status `needs_attention`, `statusReason = "pipeline_failed"`, a DLQ entry, Sentry if enabled (Phase 32) |
| budget reached | `// Phase 22:` (`needs_attention`, `statusReason = "budget_reached"`) |

A customer message must always reach a person. That's the rule the table enforces.

`statusReason` (`status_reason`, nullable text) already exists on `Message`: Phase 13 added it for
`intake_cap`. This phase writes `draft_failed` and `pipeline_failed`; Phase 22 writes
`budget_reached`. The inbox shows the reason.

### 5.3 Status transitions are conditional

`constants/messageStatus.ts`:

```ts
export const ALLOWED_FROM: Record<MessageStatus, MessageStatus[]> = {
  received:        ["ready", "needs_attention", "spam", "rejected"],   // reprocess
  processing:      ["received"],
  ready:           ["processing"],
  spam:            ["processing", "ready", "needs_attention"],          // pipeline, or a person
  needs_attention: ["received", "processing"],
  approved:        ["ready", "needs_attention"],                        // Phase 24
  sent:            ["approved"],                                        // Phase 24
  rejected:        ["ready", "needs_attention", "spam"],                // Phase 24
};
```

`transitionStatus(orgId, messageId, to, { tx?, set? })` runs
`updateMany({ where: { id, orgId, status: { in: ALLOWED_FROM[to] } }, data: { status: to, ...set } })`.
`count === 0` means someone else already moved it, or the move isn't allowed. The caller decides
whether that's fine (a duplicate job: stop quietly) or an error (a person: 409). Same shape as
PaperTrail's `document.service.transitionStatus`, minus the status-event table.

### 5.4 No PII off the database

- Job payloads: `{ orgId, messageId, attempt }`. Bodies are loaded inside the job.
- Pub/sub and SSE: `{ messageId, status, category?, strongFlags?, possibleSpam?, at }`. The inbox
  refetches the row through the authenticated API.
- Logs: the request context carries `orgId` and `messageId`; Phase 02's redaction covers the rest.
- DLQ entries hold the job data (ids only) and the error message, truncated to 2,000 characters.
  Provider error texts can echo a prompt, so `onFinalFailure` passes the message through
  `redactForTrace` and a 300-character cut before storing it.

### 5.5 Latency

`AiResult.latencyMs` is `checked − Message.receivedAt`: the time a customer waits for a draft to be
ready, which is the spec's "under 15 seconds". Queue wait counts, on purpose. Phase 27 reports p50/p95.

## 6. Steps

### 6.1 Schema and migration

Add the `AiResult` and `ModelCall` models and the two enums exactly as in
[../reference/data-model.md](../reference/data-model.md), the `aiResults`/`modelCalls` back-relations
on `Message` (`statusReason` already exists from Phase 13). Then:

```bash
pnpm --filter api db:migrate:dev --name pipeline
```

Add `"AiResult"` and `"ModelCall"` to `TENANT_MODELS`.

### 6.2 The call recorder

Phase 15's `llm.ts` exposes `setCallRecorder(fn)` (copied from PaperTrail). Wire it in `app.ts` and
`worker.ts`:

```ts
setCallRecorder(async (call) => {
  const ctx = getRequestContext();
  if (!ctx?.orgId) return;                        // eval runs record their own calls (Phase 29)
  await prisma.modelCall.create({
    data: {
      orgId: ctx.orgId, messageId: ctx.messageId ?? null,
      purpose: call.purpose, provider: call.provider, model: call.model, promptVersion: call.promptVersion,
      tokensIn: call.tokensIn ?? 0, tokensOut: call.tokensOut ?? 0,
      costUsdMicros: 0,                           // Phase 22: costUsdMicros(model, tokensIn, tokensOut)
      latencyMs: call.latencyMs, outcome: call.outcome, fellBack: call.fellBack ?? false,
    },
  }).catch((err) => logger.warn({ err }, "failed to record model call"));
});
```

Recording never fails the step. A missing cost row is a reporting gap, and a failed reply is a
customer problem.

### 6.3 The shared core

```ts
// apps/api/src/pipeline/processMessage.ts
export type PipelineDeps = {
  load: () => Promise<Checkpoint | null>;
  save: (patch: Partial<Checkpoint>) => Promise<Checkpoint>;
  draftPrompt?: string;   // eval only (Phase 30): a registry key; the worker never sets it
};

export const processMessage = async (msg: MessageCtx, biz: BusinessCtx, deps: PipelineDeps): Promise<Outcome> => {
  let cp = (await deps.load()) ?? (await deps.save({ stage: null }));

  if (before(cp.stage, "classified")) {
    const c = await degrade(() => classifyMessage({ body: msg.body, subject: msg.subject, channel: msg.channel }));
    cp = await deps.save({ stage: "classified", category: c?.category ?? null, confidence: c?.confidence ?? null,
                           language: c?.language ?? null, promptVersions: { ...cp.promptVersions, classify: c?.promptVersion ?? promptKey(PROMPTS.classify) } });
  }
  if (cp.category === "spam" && (cp.confidence ?? 0) >= SPAM_STOP_CONFIDENCE) return { outcome: "spam", cp };

  if (before(cp.stage, "extracted")) {
    const e = await degrade(() => extractDetails({ msg, biz }));
    cp = await deps.save({ stage: "extracted", extracted: e ?? emptyExtract(["extract_failed"]),
                           promptVersions: { ...cp.promptVersions, extract: e?.promptVersion ?? promptKey(PROMPTS.extract) } });
  }

  if (before(cp.stage, "drafted")) {
    const shown = selectInfo({ biz, category: cp.category ?? "other", extracted: cp.extracted });
    const prompt = deps.draftPrompt ? getPrompt<DraftPrompt>(deps.draftPrompt) : undefined;
    const d = await degrade(() => draftReply({ msg, biz, category: cp.category ?? "other", extracted: cp.extracted, entries: shown, language: cp.language }, { prompt }));
    if (!d) return { outcome: "needs_attention", reason: "draft_failed", cp };
    cp = await deps.save({ stage: "drafted", draft: d.text, infoEntryIds: shown.map((s) => s.id),
                           promptVersions: { ...cp.promptVersions, draft: d.promptVersion } });
  }

  if (before(cp.stage, "checked")) {
    const checks = runChecks({ draft: cp.draft!, shownEntries: biz.render(cp.infoEntryIds), message: msg,
                               extracted: cp.extracted, timezone: biz.timezone });
    cp = await deps.save({ stage: "checked", checks, latencyMs: Date.now() - msg.receivedAt.getTime() });
  }
  return { outcome: "ready", cp };
};
```

`processMessage` has no Prisma in it: the worker passes `load`/`save` backed by `AiResult`, and the
eval passes an in-memory pair. Export the in-memory form once, so Phase 29 calls exactly this code:

```ts
/** The same steps with in-memory checkpoints: what the eval runs (Phase 29). No Prisma, no queue. */
export const runPipeline = (msg: MessageCtx, biz: BusinessCtx, opts: { draftPrompt?: string } = {}) => {
  let saved: Checkpoint | null = null;
  return processMessage(msg, biz, {
    load: async () => saved,
    save: async (patch) => (saved = { ...(saved ?? emptyCheckpoint()), ...patch }),
    draftPrompt: opts.draftPrompt,
  });
};
```

`degrade(fn)` returns `null` on `SchemaViolation` (the step's own repair already ran) and **rethrows**
provider errors, so BullMQ backs off. `SPAM_STOP_CONFIDENCE = 0.8` comes from
`pipeline-contracts.md` §1.

### 6.4 Processor

```ts
export const processMessageProcessor = async (job: Job<PipelinePayload>) => {
  const { orgId, messageId, attempt } = pipelinePayloadSchema.parse(job.data);
  return runWithRequestContext({ requestId: `job:${job.id}`, orgId, messageId }, async () => {
    const msg = await prisma.message.findFirst({ where: { id: messageId, orgId } });
    if (!msg) throw new UnrecoverableError("message not found");

    await transitionStatus(orgId, messageId, "processing");      // count 0 on a retry: already processing
    const biz = await loadBusinessCtx(orgId);                     // profile + active info entries
    const result = await processMessage(toCtx(msg), biz, aiResultDeps(orgId, messageId, attempt));

    const moved = await finish(orgId, messageId, result);         // status + denormalised fields
    if (moved) await publishMessageEvent(orgId, { messageId, status: moved.status, category: moved.category,
                                                  strongFlags: moved.strongFlags, possibleSpam: moved.possibleSpam });
  });
};
```

`finish` sets, in one `updateMany` guarded by `status: "processing"`:
- `status`: `ready`, `spam` or `needs_attention`;
- `category`;
- `possibleSpam = category === "spam" && confidence < 0.8`;
- `strongFlags = strongFlagCount(checks)`;
- `statusReason`.

Worker: concurrency 8 (the model layer's concurrency limiter paces the provider), `attempts: 4`,
`backoff: { type: "exponential", delay: 10_000, jitter: 0.5 }`, `removeOnComplete: { age: 86_400 }`,
and the `failed` event wired to `onFinalFailure`.

### 6.5 Dispatcher

```ts
"message.received": async (event) => {
  const { messageId, attempt = 1 } = event.payload as { messageId: string; attempt?: number };
  await pipelineQueue.add("process-message", { orgId: event.orgId, messageId, attempt },
                          { jobId: `pipeline-${messageId}-${attempt}` });
},
```

### 6.6 Dead letter and replay

Adapt `onFinalFailure`: the subject is the message, and the terminal transition is `needs_attention`
with `statusReason: "pipeline_failed"` instead of `failed`. Adapt `dlq.service.replay`: in one
transaction, `transitionStatus(→ received)` and `emit(tx, orgId, "message.received", { messageId,
attempt: lastAttempt + 1 })`, then remove the DLQ job. Routes: `GET /admin/dlq` and
`POST /admin/dlq/:jobId/replay`, `DELETE /admin/dlq/:jobId` behind `authenticate` + `requireAdmin`
(platform admin). The per-org DLQ and the idempotency middleware from PaperTrail aren't copied.

### 6.7 Reprocess

`POST /orgs/:orgId/messages/:id/reprocess` (`requireOrgRole("reviewer")`): allowed from `ready`,
`needs_attention`, `spam` and `rejected`. In one transaction: read the max `attempt`, transition to
`received` (409 if `count === 0`), and `emit("message.received", { messageId, attempt: max + 1 })`.
Earlier attempts stay. The detail API returns the latest, and a history tab can list the rest (Phase 23).

### 6.8 SSE

Copy `pubsub.ts`, `sse.ts` and `streamLimiter.ts`. Change the channel prefix to `ea:events:` and the
slot key to `ea:sse:slots:`, and rename `ProgressMessage` to `MessageEvent` with the fields in §5.4.
Route: `GET /orgs/:orgId/events/stream` behind `authenticate`, `resolveOrg` and
`requireOrgRole("viewer")`, sending event `message`. `index.ts` shutdown calls `closePubSub()`, and
`worker.ts` closes `pipelineWorker`.

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev       # LLM_PROVIDER=fake, RUN_WORKERS_IN_API=true
curl -s -X POST localhost:5000/intake/form/$FORM_KEY -H 'Content-Type: application/json' \
  -H "Origin: http://localhost:8080" -d '{"name":"Ravi","contact":"ravi@example.com","message":"Python weekend batch fee? Can I come Sat 5 pm?"}'
```

1. Within a few seconds: `psql … -c "select status, category, strong_flags from messages order by created_at desc limit 1"`
   → `ready | booking | 0`. `ai_results` has one row, `stage = checked`, with `prompt_versions` for
   all three steps. `model_calls` has three rows.
2. `curl -N -b cookies.txt localhost:5000/orgs/$ORG/events/stream` in another terminal, while you
   submit another message → `event: message` lines for `processing` then `ready`, with no name or
   body in them.
3. Resume: set `FAKE_LLM_DELAY_MS=5000`, submit, and kill the API process after the classify call
   appears in `model_calls` → restart → the job resumes. There's **one** `classify` row for that
   message, not two.
4. Degrade: `FAKE_LLM_SCRIPT=classify:invalid,invalid` → `category` null, stage `checked`, a draft
   exists. `FAKE_LLM_SCRIPT=draft:down` → after 4 attempts, `needs_attention`, reason `draft_failed`.
5. Spam: a scripted `{"category":"spam","confidence":0.95}` → status `spam`, one model call only.
6. DLQ: a scripted unrecoverable failure → `GET /admin/dlq` lists it → replay → attempt 2, status `ready`.
7. Reprocess a `ready` message → attempt 2 row; reprocessing an `approved` one (Phase 24) → 409.
8. Duplicate dispatch: run the relay twice over the same event (Phase 13's test hook) → one job, one
   `AiResult`.

## 8. Definition of done

- [ ] `pipeline` migration applied; `AiResult` and `ModelCall` are tenant models.
- [ ] `process-message` checkpoints after each step and resumes; deterministic job ids.
- [ ] Degrade policy implemented; no path leaves a message without a status a person can act on.
- [ ] Status changes only through `transitionStatus` (conditional `updateMany`).
- [ ] Denormalised `category`, `possibleSpam`, `strongFlags`, `statusReason` on `Message`.
- [ ] DLQ + replay for platform admins; reprocess endpoint for reviewers.
- [ ] SSE per org with no PII; stream slots limited; pub/sub closed on shutdown.
- [ ] `processMessage` takes `deps`, so Phase 29 can run it in memory.
- [ ] Commit: `feat(api): checkpointed message pipeline, SSE and DLQ`.

## 9. Interview angle

*"What happens when the model is down, or a worker dies halfway?"* Each message is one job with a
deterministic id, so a duplicate dispatch is a no-op. After each step the result is saved on that
attempt's row, so a retry resumes where it stopped and never pays for classify twice. Provider outages
back off and retry. A bad answer after the repair attempt degrades: no category, empty details, or no
draft, and the message still lands in the inbox with a reason. The rule is "degrade towards the human,
never towards silence". Nothing with customer text goes into a job payload, an SSE event or a log.
