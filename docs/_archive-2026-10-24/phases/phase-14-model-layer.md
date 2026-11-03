# Phase 14 — Model layer (from PaperTrail) + generateText

## 1. Goal

Copy PaperTrail's production LLM layer and give it this app's shape:
- `generateJson` (classify, extract): `parseModelJson` repair, Zod, **one** targeted repair on a schema
  violation (done by the step, not the layer), typed errors, retry only on 429/5xx/timeouts, primary →
  fallback model, circuit breaker, per-model lease and RPM budget;
- a new **`generateText`** (drafts): the same reliability wrapper, returning text;
- **two model tiers**: `cheap` (classify, extract) and `draft` (replies), each with a primary and a
  fallback, from env;
- a call recorder that writes every call (step, model, prompt version, tokens, cost, latency, outcome)
  for the AI-results view and stats.

NVIDIA NIM by default. The OpenAI / Anthropic / Gemini adapters from Prompt Lab's design
(`~/Code/prompt-lab/docs/phases/phase-13-providers.md`) can be added behind the same `LlmProvider`
interface. They're optional.

## 2. What I will understand after this phase

1. Why production uses **repair + fallback** here when Prompt Lab deliberately uses neither: this app
   needs a usable answer; a benchmark needs a true measurement.
2. Why a cheap tier for classify/extract and a better tier for drafts.
3. How every call ends up in a cost and latency record.

## 3. Prerequisites

Phase 13 done; an NVIDIA API key.

## 4. Files

```
apps/api/src/
├── ai/{types,errors,reliability,modelJson,breakers,concurrency}.ts   COPY   @pt-api/src/ai/
├── ai/providers/{nvidia,fake,replay}.ts                              COPY / ADAPT  @pt-api/src/ai/providers/  (nvidia: + a completeText method)
├── ai/llm.ts                                                         ADAPT  @pt-api/src/ai/llm.ts   (tiers; Purpose = classify|extract|repair|draft; generateText; no vision)
├── constants/{llm,pricing}.ts                                        ADAPT  @pt-api/src/constants/
├── utils/cost.ts                                                     COPY   @pt-api/src/utils/cost.ts
├── models/aiCall.model.ts                                            NEW    (per-call record; PaperTrail's extractionRun shape)
├── services/aiCall.service.ts                                        NEW    (recordCall → aiCalls)
└── constants/env.ts                                                  ADAPT  (+ NVIDIA_*, LLM_PROVIDER, model tiers)
```

## 5. Concepts

**Production vs benchmark.** The same reliability parts, configured for opposite goals:

| | Prompt Lab (benchmark) | This app (production) |
| --- | --- | --- |
| Broken JSON | a measured result | repaired once (`parseModelJson` + one repair prompt), else the step fails and the message goes to the inbox without that step |
| Model unavailable | an error cell; no fallback | fall back to the secondary model; record `fellBack: true` |
| Goal | the truth about each model | a good, safe draft for the customer |

**Tiers.**
- `LLM_CHEAP_MODEL` / `LLM_CHEAP_FALLBACK_MODEL` (e.g. a small Llama/Nemotron instruct on NIM) for
  classify and extract: short prompts, JSON out, many calls.
- `LLM_DRAFT_MODEL` / `LLM_DRAFT_FALLBACK_MODEL` (a stronger instruct model) for drafts: tone and
  instruction-following matter more.

Phase 28 measures whether the cheap tier is good enough for classify/extract. That's the spec's "cost
control" question, answered with numbers.

**`generateText`.** The same loop as `generateJson` (providers in order, breaker, lease, RPM,
`withRetry`), but the provider returns plain text: `messages` → `choices[0].message.content`. Add
`completeText({ system, messages, maxTokens, temperature, signal })` to `LlmProvider` and the NVIDIA
provider (no `response_format`). Drafts use `temperature: 0.3`, a little variety in wording without
straying. Classify/extract use 0.

**Every call recorded.** `aiCalls`:
`{ orgId, messageId, runId, step, provider, modelKey, promptVersion, tokensIn, tokensOut, costUsdMicros, latencyMs, outcome, fellBack }`,
via `setCallRecorder` (PaperTrail's hook). It never fails the call it records. Stats (Phase 25) and the
eval report (Phase 27) aggregate it: cost per 100 messages, p95 per step.

## 6. Steps

1. Copy the files. In `llm.ts`:
   - two provider lists built from the tier env vars;
   - `generateJson({ tier: "cheap", purpose, promptVersion, system, content, schema, … })`;
   - `generateText({ tier: "draft", purpose: "draft", promptVersion, system, messages, maxTokens, temperature })`.

   Delete the vision list and `ContentPart` image handling (no images here). Keep the
   `NVIDIA_FAULT_INJECT` hook for the kill-the-primary demo.
2. `constants/llm.ts`: `LLM_TIMEOUT_MS = 30_000` (short prompts; a draft taking 30 s is already too
   slow for the spec's "< 15 s to draft"), attempts 3, the breaker and lease limits per model.
3. `pricing.ts`: dated prices per model id (NVIDIA free tier → reference prices, labelled).
4. `aiCall.model.ts` + recorder; `setCallRecorder(recordCall)` in `index.ts` and `worker.ts`.
5. `scripts/try-llm.ts`: one classify-shaped JSON call and one text call; prints usage, latency and cost.

## 7. Verify

- `try-llm` → JSON and text answers; two rows in `aiCalls`.
- A bogus primary model id → the fallback answers, `fellBack: true`.
- Fake 503 ×5 → the breaker opens and the fallback is used immediately.
- `LLM_PROVIDER=fake` works with no key.
- `diff -q` the COPY files against PaperTrail.

## 8. Definition of done

- [ ] The layer is copied; `generateText` added; two tiers configured; every call recorded.
- [ ] Commit: `feat(api): model layer with cheap and draft tiers`.

## 9. Interview angle

*"How do you control cost?"* A cheap model for the narrow steps (classify, extract) and a stronger one
only for the reply. Every call is recorded with tokens, cost and latency, and the eval shows the cheap
tier is accurate enough, so the numbers justify the split.
