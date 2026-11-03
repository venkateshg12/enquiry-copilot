# Phase 15 — Model layer (PaperTrail's) + plain-text completions

## 1. Goal

Copy PaperTrail's production model layer and give it this app's shape:

- **one way to call a model.** `generateJson` (classify, extract, judge) and a new `generateText`
  (drafts) both go through the same loop: providers in preference order → per-model circuit breaker
  → RPM budget → concurrency lease → `withRetry` (429/5xx/timeouts only) → fall back to the next
  model;
- **models chosen by purpose.** `classify | extract | draft | judge`, each with a primary and a
  fallback from env (a cheap fast model for classify/extract, a stronger one for drafts, a different
  family for the judge);
- **a prompt registry.** Every prompt is a versioned module, identified as `classify@1`. A shipped
  prompt file is never edited; a change is a new file;
- **a call recorder hook.** Every call produces a `CallRecord` (purpose, model, prompt version,
  tokens, latency, outcome, fell back). In this phase it's logged. Phase 21 writes it to `model_calls`,
  and Phase 22 adds cost;
- `fake` and `replay` providers, so tests, CI and the eval run without a key and without spending.

No pipeline step is written yet. Phases 16–19 call this layer.

## 2. What I will understand after this phase

1. Why production uses **repair and fallback** while a benchmark (Prompt Lab) deliberately uses
   neither.
2. How breaker, lease, RPM budget and retry nest, and why the order matters.
3. Why a schema violation is *not* a breaker failure.
4. Why a prompt's version is part of every record, and why shipped prompts are immutable.
5. Why the replay cache key must include the system prompt (it doesn't in PaperTrail, and here that
   would be a bug).

## 3. Prerequisites

- Phases 00–14 done. In particular Phase 06 (`utils/rateLimiter/circuitBreaker.ts`,
  `middleware/rateLimiter.ts` → `getDefaultStore`) and Phase 08 (`jobs/redis/connection.ts`), which
  the breaker, lease and RPM budget use.
- An NVIDIA API key from <https://build.nvidia.com> (sign in → any model page → "Get API Key").
  Not needed for `LLM_PROVIDER=fake`.
- Read `~/Code/paper-trail/docs/reference/nvidia.md` (endpoint, JSON mode, thinking mode, 429s).

## 4. Files

```
apps/api/src/
├── ai/
│   ├── types.ts                  ADAPT  @pt-api/src/ai/types.ts        (Purpose = classify|extract|draft|judge; TextRequest; generateText on LlmProvider; no images)
│   ├── errors.ts                 COPY   @pt-api/src/ai/errors.ts       (BudgetExceeded is thrown from Phase 22)
│   ├── reliability.ts            COPY   @pt-api/src/ai/reliability.ts
│   ├── modelJson.ts              COPY   @pt-api/src/ai/modelJson.ts    (+ modelJson.test.ts COPY)
│   ├── breakers.ts               COPY   @pt-api/src/ai/breakers.ts
│   ├── concurrency.ts            COPY   @pt-api/src/ai/concurrency.ts
│   ├── llm.ts                    ADAPT  @pt-api/src/ai/llm.ts          (providers per purpose; generateText; outcome vocabulary; no vision; no tracing)
│   ├── providers/nvidia.ts       ADAPT  @pt-api/src/ai/providers/nvidia.ts   (+ generateText; temperature/maxTokens per call)
│   ├── providers/fake.ts         ADAPT  @pt-api/src/ai/providers/fake.ts     (+ generateText; fixtures keyed by purpose)
│   ├── providers/replay.ts       ADAPT  @pt-api/src/ai/providers/replay.ts   (key includes system; + generateText)
│   └── prompts/index.ts          ADAPT  @pt-api/src/ai/prompts/index.ts      (empty registry + promptKey; prompts arrive in 16–19)
├── constants/llm.ts              ADAPT  @pt-api/src/constants/llm.ts   (MODELS_BY_PURPOSE, 30 s timeout, limits per model)
├── constants/env.ts              ADAPT  (+ LLM_PROVIDER, NVIDIA_*, LLM_{FAST,DRAFT,JUDGE}_*, FAKE_LLM_FIXTURES, FAKE_LLM_SCRIPT, FAKE_LLM_DELAY_MS, NVIDIA_FAULT_INJECT)
└── scripts/try-llm.ts            NEW    (one JSON call, one text call)
apps/api/evals/cache/             NEW    (replay recordings; gitignored except the committed fixtures Phase 29 needs)
apps/api/test/fixtures/llm/       NEW    (fake-provider answers by content hash)
```

Not copied: `@pt-api/src/ai/cascade.ts` (the cheap-model cascade exists to save money on many pages;
here the cheap model is simply the classify/extract model, see `inherited-architecture.md`) and the
Langfuse calls to `@pt-api/src/utils/tracing.ts` (observability is Phase 32: leave
`// Phase 32: recordGeneration(...)` where PaperTrail calls it).

## 5. Concepts

**Production vs benchmark.** The same parts, configured for opposite goals:

| | Prompt Lab (benchmark) | This app (production) |
| --- | --- | --- |
| Broken JSON | a measured result | repaired: `parseModelJson` first, then **one** re-prompt by the step (Phases 16–17), else the step fails and the message goes to the inbox as `needs_attention` |
| Primary model down | an error cell, no fallback | fall back, record `fellBack: true` |
| Goal | the truth about each model | a usable, safe draft for a person to check |

Phase 30 runs the production prompts through Prompt Lab *without* repair, so the numbers in the
README are honest about the raw model.

**Models by purpose.**

| Purpose | Env (primary / fallback) | Why |
| --- | --- | --- |
| `classify` | `LLM_FAST_MODEL` / `LLM_FAST_FALLBACK_MODEL` | short prompt, short JSON, every message |
| `extract` | same as classify | narrow JSON, many calls |
| `draft` | `LLM_DRAFT_MODEL` / `LLM_DRAFT_FALLBACK_MODEL` | tone and instruction-following matter |
| `judge` | `LLM_JUDGE_MODEL` (default: `LLM_DRAFT_FALLBACK_MODEL`) | a different family from the drafter, so it isn't grading its own style (Phase 30) |

Fill the model ids **on the day you build this**, from build.nvidia.com: an 8B-class instruct model
for `FAST`, a 49B–70B-class instruct model for `DRAFT`, each fallback from a different family. Check on
each model card:
- that it's available on the hosted API;
- whether it has a thinking mode (send `chat_template_kwargs: { enable_thinking: false }` only if the
  card documents it);
- its rate limits.

Write the chosen ids and the date in `.env.example` comments. Prices go in Phase 22's table; never
assume them.

**Models get retired.** NVIDIA retired `meta/llama-3.3-70b-instruct` and `meta/llama-3.1-8b-instruct`
on 26 August 2026: they answer **410 Gone** (found while building the Playbook, its
`tasks/lessons.md`). So never copy a model id from an old guide. List what the hosted API serves
(`GET https://integrate.api.nvidia.com/v1/models` with your key), then run `try-llm` once per
candidate (Step 6) before writing it into `.env`. Two ids verified to answer there on 2 Nov 2026,
usable as a starting point and nothing more: `nvidia/nemotron-3-super-120b-a12b` (draft class) and
`openai/gpt-oss-20b` (fast class). The provider maps **410 → a `ProviderUnavailable` error whose
message says "model retired"** (so the breaker opens and the fallback takes over, and the log says
why), and **401/403 → a non-retryable auth error** (served models answer a bad key with 403, not
401). Re-check the ids whenever you re-run the final eval (Phase 30).

**JSON mode on NVIDIA.** The copied provider sends `response_format: { type: "json_object" }`, then
`parseModelJson` (fences, cut-offs, one extra wrapper layer) and Zod. NVIDIA's NIM docs recommend a
**schema** instead, via `nvext: { guided_json: <JSON Schema> }` on LLM NIMs (Structured Generation
page). They also warn that `json_object` allows any valid JSON, including `{}`. Whether the *hosted*
`integrate.api.nvidia.com` endpoint honours `nvext` for your chosen model is something to **test, not
assume**: Step 6 is a probe. If it works, set `NVIDIA_GUIDED_JSON=true` and the provider adds
`nvext.guided_json` from `z.toJSONSchema(schema)`. The repair path stays either way, because a
constrained decoder can still be cut off by `max_tokens`.

**The nesting order.**

```
for provider in providersFor(purpose):          # primary, then fallback
  breaker(provider.model).execute(              # OPEN → skip at once (ProviderSkipped)
    assertRpmBudget(model)                      # over 60-s budget → ProviderBusy (BullMQ retries the job)
    withLease(model,                            # Redis-held concurrency slot across all workers
      withRetry(attempt → provider.call(...))   # 3 attempts, full-jitter backoff, 30 s each, retryable errors only
```

The breaker is outermost, so a dead model costs nothing after it trips. The lease is inside the
breaker, so a skipped model never holds a slot. Retry is innermost, so one slot covers all attempts at
one model.

**A schema violation is not an outage.** The provider answered; it answered badly. PaperTrail's
`llm.ts` catches `SchemaViolation` inside the breaker and rethrows it outside, so it never counts
toward tripping. It also doesn't fall back: the step re-prompts once with the error (Phase 16). Keep
that exactly.

**`generateText`.** The same loop. The provider sends no `response_format`, returns
`choices[0].message.content` trimmed, and throws `SchemaViolation("empty", …)` on an empty answer
(an empty draft is a bad answer, not an outage). Drafts use `temperature: 0.3` and `maxTokens: 300`;
JSON calls use `temperature: 0`.

**Outcome vocabulary** (matches `ModelCall.outcome` in `data-model.md`): `ok`, `repaired` (set by the
step when its re-prompt succeeded), `invalid_json`, `provider_error`, `breaker_open`, `timeout`.
`outcomeOf(error)` replaces PaperTrail's `errorCodeOf` and keeps the HTTP status in a separate
`errorCode` field for logs.

**Immutable prompts.** `PROMPTS` maps a purpose to its **active** version. Older versions stay in the
folder and stay importable by id (`getPrompt("draft@1")`), because Phase 30's eval compares versions
and Lessons 5, 6 and 8 of the Playbook run variant prompts (`draft-ungrounded@1`, …) through the same
eval. A result records `promptKey(prompt)`, so a number in a report can always be traced to the exact
text.

**The replay key.** PaperTrail's replay provider keys on `model:promptVersion:content`. Its prompts
put every variable in `content`, so that's safe there. Here the draft prompt's **system** text carries
the business's info sheet and tone. Two businesses with the same message and prompt version would
share a recording, and an info-sheet edit would replay a stale draft. The ADAPT adds `system` to the
hash. A unit test proves two different systems produce two keys.

## 6. Steps

1. Copy the COPY files and `diff -q` each against `@pt-api/src/ai/`.
2. `types.ts`:
   ```ts
   export type Purpose = "classify" | "extract" | "draft" | "judge";
   export type Usage = { inputTokens: number; outputTokens: number };
   export type ChatMessage = { role: "user" | "assistant"; content: string };

   export type JsonRequest<T> = {
     system: string; content: string; schema: z.ZodType<T>; signal: AbortSignal;
     promptVersion: string; purpose: Purpose; temperature?: number; maxTokens?: number;
   };
   export type TextRequest = {
     system: string; messages: ChatMessage[]; signal: AbortSignal;
     promptVersion: string; purpose: Purpose; temperature: number; maxTokens: number;
   };
   export type ProviderName = "nvidia" | "fake" | "replay";
   export interface LlmProvider {
     readonly name: ProviderName;
     readonly model: string;
     generateJson<T>(request: JsonRequest<T>): Promise<{ data: T; usage: Usage; raw: string }>;
     generateText(request: TextRequest): Promise<{ text: string; usage: Usage }>;
   }
   ```
   No `ContentPart`/images: messages are text. `raw` is returned so the step can store the model's
   untouched answer next to the repaired one (Phase 17 measures them separately).
3. `constants/env.ts` (ADAPT from `@pt-api/src/constants/env.ts` lines for `NVIDIA_*`, `LLM_PROVIDER`,
   `FAKE_LLM_FIXTURES`, `NVIDIA_FAULT_INJECT`, including its two production guards): replace
   `NVIDIA_TEXT_*`/`VISION`/`CHEAP` with `LLM_FAST_MODEL`, `LLM_FAST_FALLBACK_MODEL`,
   `LLM_DRAFT_MODEL`, `LLM_DRAFT_FALLBACK_MODEL`, `LLM_JUDGE_MODEL` (optional), `NVIDIA_GUIDED_JSON`
   (`"false"`). Boot check: with `LLM_PROVIDER=nvidia`, the key and the four main model ids must be set.
4. `constants/llm.ts`:
   ```ts
   export const LLM_TIMEOUT_MS = 30_000;   // spec: message → draft under 15 s; a 30 s call is already a failure
   export const LLM_ATTEMPTS = 3;
   export const MAX_BACKOFF_MS = 8_000;
   export const MODELS_BY_PURPOSE: Record<Purpose, string[]> = {
     classify: [LLM_FAST_MODEL, LLM_FAST_FALLBACK_MODEL],
     extract:  [LLM_FAST_MODEL, LLM_FAST_FALLBACK_MODEL],
     draft:    [LLM_DRAFT_MODEL, LLM_DRAFT_FALLBACK_MODEL],
     judge:    [LLM_JUDGE_MODEL || LLM_DRAFT_FALLBACK_MODEL],
   };
   export const MODEL_LIMITS: Record<string, { concurrency: number; rpm: number }> = {
     // fill from each model card on build day; fake models for tests:
     "fake-text": { concurrency: 10, rpm: 600 },
   };
   export const DEFAULT_MODEL_LIMIT = { concurrency: 4, rpm: 40 };
   export const LEASE_TTL_MS = 60_000;
   export const LEASE_WAIT_MS = 10_000;
   export const BREAKER = { failureThreshold: 5, resetTimeoutMs: 30_000 };
   ```
5. `providers/nvidia.ts`: keep `NvidiaApiError`, `postChat`, `toUsage`, the fault-inject hook (now
   checked against `LLM_FAST_MODEL` and `LLM_DRAFT_MODEL`). `generateJson` takes `temperature ?? 0` and
   `maxTokens ?? 800`, sends `messages: [{ role: "system", content: `${system}\n\n${describeJsonReply(schema)}` }, { role: "user", content }]`,
   adds `nvext: { guided_json: z.toJSONSchema(schema) }` only when `NVIDIA_GUIDED_JSON === "true"`, and
   returns `{ data, usage, raw }`. Add:
   ```ts
   async generateText({ system, messages, signal, temperature, maxTokens }: TextRequest) {
     const response = await postChat(
       { model, temperature, max_tokens: maxTokens,
         messages: [{ role: "system", content: system }, ...messages] },
       signal
     );
     const completion = (await response.json()) as ChatCompletion;
     const text = (completion.choices?.[0]?.message?.content ?? "").trim();
     if (!text) throw new SchemaViolation("empty reply", "", model);
     return { text, usage: toUsage(completion.usage) };
   },
   ```
   Keep `chat_template_kwargs` only if the chosen models document it (Concepts). Put it behind
   `NVIDIA_DISABLE_THINKING=true` rather than hard-coding it.
6. `scripts/try-llm.ts --probe-guided`: sends one `guided_json` request with a two-field schema and a
   prompt that asks for a *different* shape. If the answer still matches the schema, the endpoint
   honours `nvext` for that model. Record the result in `tasks/lessons.md`.
7. `providers/fake.ts`: `fakeLlm.push({ kind: "json", data } | { kind: "text", text } | { kind: "error", error })`;
   fixtures are `test/fixtures/llm/<sha256(system + content)>.json` holding `{ classify?, extract?, draft?, judge? }`,
   picked by purpose (PaperTrail's rule). Usage `{ 1000, 200 }`.
   Two env knobs for driving the **running app** (not unit tests) into failure paths, refused when
   `NODE_ENV=production` (boot check, like `NVIDIA_FAULT_INJECT`):
   - `FAKE_LLM_SCRIPT`: per-purpose overrides, `purpose:spec[,spec…]` separated by `;`. A spec is
     `invalid` (unparseable JSON → `SchemaViolation`), `down` (→ `ProviderUnavailable` on every call),
     or a quoted literal answer (`draft:"The fee is ₹3,500."`). The list is consumed in order, and the
     last entry repeats. Phases 21–23 use it in their Verify steps.
   - `FAKE_LLM_DELAY_MS`: sleep before every fake answer (default 0). Phase 21 uses it to kill the
     process mid-pipeline and watch the checkpoint resume.
8. `providers/replay.ts`: `computeCacheKey(model, promptVersion, system, payload)` hashes all four;
   `generateText` mirrors `generateJson`; `recordOnMiss` writes `{ model, promptVersion, data | text, usage, cachedAt }`.
9. `llm.ts`:
   - `providersFor(purpose)` builds (and memoises) one provider per model id in `MODELS_BY_PURPOSE`,
     of the kind `LLM_PROVIDER` says; `setProviders(purpose, list)` for tests;
   - one private `run(purpose, promptVersion, call)` that is PaperTrail's loop body, so the two public
     functions differ only in the provider method they call:
     ```ts
     export const generateJson = <T>(r: { purpose: Purpose; promptVersion: string; system: string; content: string;
       schema: ZodType<T>; messageId?: string; signal?: AbortSignal; temperature?: number; maxTokens?: number }) =>
       run(r, (p, signal) => p.generateJson({ ...r, signal }));

     export const generateText = (r: { purpose: Purpose; promptVersion: string; system: string; messages: ChatMessage[];
       messageId?: string; signal?: AbortSignal; temperature: number; maxTokens: number }) =>
       run(r, (p, signal) => p.generateText({ ...r, signal }));
     ```
   - `CallRecord = { purpose, provider, model, promptVersion, messageId?, fellBack, latencyMs, outcome, errorCode?, inputTokens?, outputTokens? }`;
     `setCallRecorder(fn)`. The default logs at `info` with **no prompt or output text** (Phase 02's
     redaction would catch `body`/`draft`, but the record never carries them in the first place).
     Leave `// Phase 21: setCallRecorder(recordModelCall)` and `// Phase 22: costUsdMicros` in the type.
   - `modelOverride` from PaperTrail stays: Phase 30's eval compares models with it.
   - `repair?: true` on `generateJson`: the step's one re-prompt after a `SchemaViolation`. On success
     the record's outcome is `repaired` instead of `ok`, so "how often did we need the repair" is a
     query, not a guess. A repair call skips fallback (same model, same prompt + the error).
10. `prompts/index.ts`:
    ```ts
    export type PromptModule = { id: string; version: number };
    export const promptKey = (p: PromptModule) => `${p.id}@${p.version}`;
    const ALL: Record<string, PromptModule> = {};           // Phases 16–19 register here
    export const register = <P extends PromptModule>(p: P): P => { ALL[promptKey(p)] = p; return p; };
    export const getPrompt = <P extends PromptModule>(key: string): P => {
      const p = ALL[key]; if (!p) throw new Error(`Unknown prompt ${key}`); return p as P;
    };
    export const listPrompts = () => Object.keys(ALL).sort();
    ```
    The *active* versions (`PROMPTS.classify`, …) are added by each step's phase.
11. `scripts/try-llm.ts`: one `generateJson` (`purpose: "classify"`, schema `{ ok: boolean }`) and one
    `generateText` (`purpose: "draft"`); print model, fellBack, tokens, latency. `pnpm --filter api try-llm`.

## 7. Verify

```bash
pnpm --filter api test -- ai/                       # modelJson (copied) + new replay-key and llm tests
LLM_PROVIDER=fake pnpm --filter api try-llm
# → json { ok: true } model=fake-text fellBack=false · text "…" model=fake-text
pnpm --filter api try-llm                           # real key
# → both answers; latency under ~5 s each on the fast model
LLM_FAST_MODEL=does/not-exist pnpm --filter api try-llm
# → log "llm provider failed, trying next" (http_404), answer from the fallback, fellBack=true
NVIDIA_FAULT_INJECT=primary pnpm --filter api try-llm   # run it 6 times
# → after 5 failures: "llm circuit state change CLOSED→OPEN"; later calls skip the primary instantly
pnpm --filter api try-llm --probe-guided
# → "guided_json honoured: yes|no (model …)"  → recorded in tasks/lessons.md
for f in types errors reliability modelJson breakers concurrency; do diff -q ../paper-trail/apps/api/src/ai/$f.ts apps/api/src/ai/$f.ts; done
# → only types.ts differs (ADAPT)
```

Unit tests to add (Vitest, no Redis: `setLeaseRedis` with a fake, as PaperTrail's tests do):
- a `SchemaViolation` from the primary does **not** call the fallback and does **not** move the breaker;
- `http_503` ×3 on the primary → fallback used, record `fellBack: true, outcome: "ok"`;
- `computeCacheKey` differs when only `system` differs;
- `generateText` with an empty answer → `SchemaViolation`, `outcome: "invalid_json"` in the record.

## 8. Definition of done

- [ ] COPY files identical to PaperTrail; ADAPT changes limited to those listed.
- [ ] `generateJson` and `generateText` share one loop; models chosen by purpose with fallbacks.
- [ ] Every call produces a `CallRecord` with outcome; no prompt or output text in it.
- [ ] Prompt registry with `promptKey`/`getPrompt`; shipped prompts are immutable by convention (noted in `CLAUDE.md`).
- [ ] Replay key includes the system prompt (tested).
- [ ] The guided-JSON probe ran and its result is recorded.
- [ ] Model ids and the date chosen are in `.env.example`.
- [ ] Commit: `feat(api): model layer with per-purpose models and generateText`.

## 9. Interview angle

*"What happens when the model provider has an outage?"* Each model has a Redis-backed circuit
breaker. After five failures it opens and the call goes straight to a fallback model from a different
family, without waiting on timeouts. Retries only happen for errors a retry can fix: 429s, 5xx and
timeouts, with jittered backoff. A malformed answer isn't an outage, so it never trips the breaker. The
step re-prompts once with the validation error instead. Every call is recorded with its prompt version,
model, tokens, latency and whether it fell back, so I can see from data how often the fallback carried
us.

Sources checked for this phase: PaperTrail's `docs/reference/nvidia.md`; NVIDIA NIM "Structured
Generation" (LLM NIM docs 1.1–1.7: `nvext.guided_json`, and the note that `json_object` allows any
JSON) — <https://docs.nvidia.com/nim/large-language-models/1.7.0/structured-generation.html>.
