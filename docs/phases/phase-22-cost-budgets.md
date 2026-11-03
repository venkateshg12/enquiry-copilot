# Phase 22 — Cost, usage and monthly budgets

## 1. Goal

Know what every message costs, and make it impossible for one business to run up an unbounded model
bill:

- every `ModelCall` gets its **cost** in integer micro-dollars (resolves Phase 21's `// Phase 22:`
  comment), and each `AiResult` gets the sum for its attempt;
- each business has a **monthly model budget** (`Org.monthlyBudgetUsdMicros`, default $5), tracked in
  `OrgUsage` (one row per business per UTC month);
- before every model call, the expected worst-case cost is **reserved** with one conditional `UPDATE`.
  After the call, the reservation is **settled** to the real cost. Twenty messages arriving at once
  can't overspend;
- at **80 %** the owners get one system email per month; at **100 %** new messages still arrive and
  are saved, but the pipeline stops before the model and marks them `needs_attention` with
  `statusReason = "budget_reached"`;
- a **platform daily ceiling** (`PLATFORM_DAILY_BUDGET_USD`, copied from PaperTrail) caps total spend
  on the server's NVIDIA key across all businesses;
- `GET /orgs/:orgId/usage` and a usage meter in the web app; "Process waiting messages" once there's
  room again.

## 2. What I will understand after this phase

1. Why cost is integer micro-dollars, and why running totals are `BigInt`.
2. How a reservation with a conditional `UPDATE … WHERE cost <= budget - estimate` prevents
   overspending under concurrency, and why a check-then-call can't.
3. Why reaching the budget must never drop a customer message.
4. How "exactly one warning email per month" comes from an atomic claim, not a flag read.
5. What the cost numbers do and don't mean when NVIDIA's free credits make real spend ≈ 0.

## 3. Prerequisites

- Phase 21 done (`ModelCall` rows written with `costUsdMicros: 0`).
- Phase 08's system email producer (`EmailProducer`, named methods per email) works.

## 4. Files

```
apps/api/prisma/schema.prisma                       ADAPT  (+ OrgUsage, Org.monthlyBudgetUsdMicros)
apps/api/prisma/migrations/<ts>_usage/              NEW
apps/api/src/
├── db/prisma.ts                                    ADAPT  (TENANT_MODELS += OrgUsage)
├── constants/pricing.ts                            ADAPT  @pt-api/src/constants/pricing.ts  (this project's models; prices to check)
├── constants/env.ts                                ADAPT  (+ PLATFORM_DAILY_BUDGET_USD, BUDGET_WARN_RATIO)
├── utils/cost.ts                                   COPY   @pt-api/src/utils/cost.ts
├── ai/errors.ts                                    (BudgetExceeded already copied in Phase 15)
├── ai/llm.ts                                       ADAPT  (+ setBudgetGuard: reserve before, settle after each attempt)
├── services/budget.service.ts                      ADAPT  @pt-api/src/services/quota.service.ts  (cost only: no pages, no leases)
├── services/usage.service.ts                       ADAPT  @pt-api/src/services/usage.service.ts  (monthly view + breakdown)
├── services/modelCall.service.ts                   ADAPT  (Phase 21: cost now computed)
├── jobs/processors/processMessage.processor.ts     ADAPT  (BudgetExceeded → needs_attention; messagesProcessed)
├── controllers/usage.controller.ts                 ADAPT  @pt-api/src/controllers/usage.controller.ts
├── routes/usage.route.ts                           ADAPT  @pt-api/src/routes/usage.route.ts
├── routes/message.route.ts                         ADAPT  (+ POST /orgs/:orgId/messages/reprocess-waiting)
├── jobs/producers/email.producer.ts               ADAPT  (+ sendBudgetWarning, sendBudgetReached — shape of @pt-api/src/jobs/producers/email.producer.ts sendBudgetWarning; jobId `budget-<kind>-<orgId>-<month>`)
└── utils/email/emailTemplates.ts                   ADAPT  (+ budgetWarning, budgetReached)
packages/types/src/usage.ts                         NEW    (usageResponseSchema, updateBudgetSchema)
apps/web/src/
├── api/usage.ts · hooks/usage/useUsage.ts          ADAPT  @pt-web/src/api/usage.ts
├── components/layout/UsageMeter.tsx                ADAPT  @pt-web/src/components/layout/UsageMeter.tsx (cost vs budget, not pages)
└── app/(app)/settings/usage/page.tsx               NEW    (breakdown table, budget field for owners)
```

## 5. Concepts

### 5.1 Integer money

`costUsdMicros(model, tokensIn, tokensOut)` (copied unchanged) returns integer micro-dollars. A price
of "$0.70 per million tokens" becomes 0.7 micro-dollars per token, so the multiplication and the sum
stay exact integers after rounding each call once. Floats would drift over thousands of calls, and the
"cost per 100 messages" figure in the README must add up.

`OrgUsage.costUsdMicros` is `BigInt`: 2³¹ micro-dollars is about $2,147, which a busy pilot could pass
over the lifetime of a row if budgets are raised. Services convert to `Number` at the API edge.

### 5.2 Reserve, call, settle

Checking "are we under budget?" and then calling the model is a race. Twenty concurrent jobs all read
"$4.90 of $5.00 used" and all call. The reservation is one statement:

```sql
UPDATE org_usage
   SET cost_usd_micros = cost_usd_micros + $estimate
 WHERE org_id = $org AND month = $month
   AND cost_usd_micros <= $budget - $estimate;      -- Postgres re-checks after a concurrent commit
```

`count === 1` means the reservation is held, and `count === 0` means `BudgetExceeded`. After the call,
`settle(estimate, actual)` applies `increment: actual - estimate`, which is usually negative because the
estimate is a worst case. If the call throws, `settle(estimate, 0)` releases the whole reservation.
This is PaperTrail's `reservePages` applied to money instead of pages.

The **estimate** is deliberately pessimistic:

```
estimateMicros = costUsdMicros(model, ceil(promptChars / 3), maxTokens)
```

Three characters per token over-counts for English and Hinglish, and `maxTokens` is the output
ceiling. Over-reserving only matters within a cent of the budget, which is exactly where you want to
stop early.

Each provider *attempt* is reserved separately, including fallbacks, because each one is billed.

### 5.3 Reaching the budget never loses a message

Intake (Phase 13) doesn't look at the budget. The message is saved and the customer gets the normal
"thanks, we'll reply soon". The pipeline catches `BudgetExceeded`:
- status `needs_attention` with `statusReason = "budget_reached"`;
- **no retry** (the processor returns normally, so BullMQ doesn't back off on a business limit);
- **no DLQ entry**. PaperTrail's `onFinalFailure` already excludes budget errors, and this keeps that.

Staff can still answer by hand from the inbox. When the owner raises the budget or the month rolls
over, `POST /orgs/:orgId/messages/reprocess-waiting` re-emits `message.received` with `attempt + 1`
for every `needs_attention` message whose `statusReason` is `budget_reached` **or `intake_cap`**
(Phase 13's daily-cap holds; they never got an outbox event, so this emits their first one, with
`attempt: 1` for them), up to 200 per call, in one transaction per message. Releasing is an admin's
deliberate action, so it isn't charged to the intake cap again.

### 5.4 One email per month, exactly

`addCost` (adapted from PaperTrail) checks the new total after each settle. Crossing 80 % or 100 %
calls `claimMonthlyFlag(orgId, month, "warnedAt" | "reachedAt")`:

```ts
const { count } = await prisma.orgUsage.updateMany({
  where: { orgId, month, [flag]: null },
  data: { [flag]: new Date() },
});
return count === 1;           // only the caller that set it sends the email
```

Two jobs crossing 80 % at the same moment can't both send. The emails go to every `owner` membership
through the Phase 08 system email queue (`EmailProducer.sendBudgetWarning` / `sendBudgetReached`). They contain the business name and the numbers, no customer
data.

### 5.5 Platform ceiling

The server holds one NVIDIA key for all businesses. `PLATFORM_DAILY_BUDGET_USD` (default 10 here) is
checked with a Redis counter per UTC day (`ea:cost:platform:<yyyy-mm-dd>`, `INCRBY` on settle, 48 h
TTL), copied from PaperTrail. If Redis is down this check **fails open**, because the per-business
Postgres reservation still holds and blocking every business over a cache outage is worse. Write that
trade-off in a comment.

### 5.6 What the numbers mean

NVIDIA's hosted catalogue may be free credits in development, so real spend can be ≈ 0. The prices in
`constants/pricing.ts` are **reference prices** (the provider's list price, or a comparable hosted
model's) so cost per 100 messages is measurable and comparable across prompt versions. Check the
current numbers on NVIDIA's model pages when you write this phase. Record the source and date in a
comment, as PaperTrail does, and say so wherever the README shows a cost.

## 6. Steps

### 6.1 Schema

Add `OrgUsage` (data-model.md) and `monthlyBudgetUsdMicros BigInt @default(5000000)` on `Org`, then
`pnpm --filter api db:migrate:dev --name usage`. Add `"OrgUsage"` to `TENANT_MODELS`.

### 6.2 Pricing and cost

```ts
// constants/pricing.ts: reference prices in USD per 1M tokens. Checked <date> on <source>.
export const PRICE_PER_MILLION_USD: Record<string, { input: number; output: number }> = {
  "<classify/extract model id>": { input: 0, output: 0 },   // fill in
  "<draft model id>":            { input: 0, output: 0 },   // fill in
  "<fallback model ids>":        { input: 0, output: 0 },
  "fake-text":                   { input: 1, output: 5 },   // so tests see non-zero cost
};
```

The model ids are the ones Phase 15 put in `constants/llm.ts`. Copy `utils/cost.ts` unchanged (it
warns once per unknown model and records 0). In `modelCall.service.ts`, replace the `0` with
`costUsdMicros(call.model, call.tokensIn, call.tokensOut)`.

### 6.3 Budget guard in the model layer

```ts
// ai/llm.ts (ADAPT): one seam, no budget logic inside the model layer itself
type BudgetGuard = {
  reserve: (r: { model: string; promptChars: number; maxTokens: number }) => Promise<Reservation | null>;
  settle: (r: Reservation, actual: { tokensIn: number; tokensOut: number } | null) => Promise<void>;
};
let guard: BudgetGuard | null = null;
export const setBudgetGuard = (g: BudgetGuard) => { guard = g; };

// inside the per-attempt loop, around provider.complete(...)
const reservation = await guard?.reserve({ model, promptChars, maxTokens });   // throws BudgetExceeded
try {
  const res = await provider.complete(req);
  await guard?.settle(reservation!, res.usage);
  return res;
} catch (err) {
  await guard?.settle(reservation!, null);       // release
  throw err;
}
```

`BudgetExceeded` must not be swallowed by the fallback loop. It's not a provider failure, so the
cascade stops immediately. `budget.service.ts` implements the guard. `reserve` returns `null` when
there's no `orgId` in the request context (eval runs use their own accounting, Phase 29).

### 6.4 Processor changes

In `processMessage.processor.ts`, catch `BudgetExceeded` around `processMessage(...)`. Transition
`processing → needs_attention`, set `statusReason: "budget_reached"`, publish the event, and return
(no throw). In `finish()`, increment `OrgUsage.messagesProcessed` for this month, and set
`AiResult.costUsdMicros` from
`prisma.modelCall.aggregate({ where: { messageId, createdAt: { gte: attemptStartedAt } }, _sum: { costUsdMicros: true } })`.

### 6.5 Usage API

`GET /orgs/:orgId/usage?month=2026-11` (`requireOrgRole("admin")`):

```json
{
  "month": "2026-11",
  "costUsd": 1.84, "budgetUsd": 5, "percent": 37,
  "messagesProcessed": 212, "costPer100Usd": 0.87,
  "byPurpose": [{ "purpose": "draft", "model": "…", "calls": 214, "costUsd": 1.31, "p95LatencyMs": 3900 }],
  "warnedAt": null, "reachedAt": null, "waitingForBudget": 0
}
```

`byPurpose` is one `groupBy` over `model_calls` for the month. The p95 is
`percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)` in a `$queryRaw` that filters on
`org_id` itself, because raw SQL bypasses the tenant extension (data-model.md). Cache it under domain
`stats` for 60 s. The owner changes the budget with `PATCH /orgs/:orgId { monthlyBudgetUsd }`
(owner only, 1–500), which bumps the cache.

### 6.6 Web

Adapt `UsageMeter` to show `costUsd / budgetUsd` with the same colour thresholds (amber from 80 %,
red at 100 %) and a link to `/settings/usage`. The usage page shows the breakdown table, the budget
field for owners, and a banner when `waitingForBudget > 0`, with a **Process waiting messages**
button.

## 7. Verify

```bash
pnpm --filter api exec vitest run src/services/budget.service.test.ts
```

1. **Cost recorded.** Submit a message (`LLM_PROVIDER=fake`, `fake-text` priced 1/5) →
   `select purpose, cost_usd_micros from model_calls order by created_at desc limit 3` → three
   non-zero rows; `ai_results.cost_usd_micros` equals their sum.
2. **Concurrency.** Set the business budget to $0.01 (`update orgs set monthly_budget_usd_micros = 10000`),
   then submit 20 messages at once:
   ```bash
   seq 20 | xargs -P20 -I{} curl -s -o /dev/null -X POST localhost:5000/intake/form/$FORM_KEY \
     -H 'Content-Type: application/json' -H "Origin: http://localhost:8080" \
     -d '{"name":"T{}","contact":"t{}@example.com","message":"fee for python course?"}'
   ```
   → `select cost_usd_micros from org_usage` is ≤ 10000. Some messages are `ready`, the rest
   `needs_attention` / `budget_reached`. All 20 exist.
3. **One email.** Exactly one `budget_warning` and one `budget_reached` job in the email queue
   (Bull Board, or the dev mailbox).
4. **Recovery.** Raise the budget → `POST /orgs/$ORG/messages/reprocess-waiting` → the waiting
   messages reach `ready`, each with `attempt = 2`.
5. **Release on failure.** `FAKE_LLM_SCRIPT=draft:down` → after the retries, `org_usage` holds only
   the cost of the calls that succeeded (no stuck reservation).
6. `GET /orgs/$ORG/usage` returns the shape above. A `reviewer` gets 403.

## 8. Definition of done

- [ ] `usage` migration applied; `OrgUsage` is a tenant model.
- [ ] Every `ModelCall` has a cost; every `AiResult` the sum for its attempt.
- [ ] Reserve → call → settle around every provider attempt; release on failure; no overspend under 20
      concurrent messages.
- [ ] Reaching the budget saves the message and routes it to a person, no retries, no DLQ.
- [ ] One 80 % and one 100 % email per business per month (atomic claim).
- [ ] Platform daily ceiling, failing open on Redis errors, with the reason in a comment.
- [ ] Usage API, usage meter, settings page, reprocess-waiting.
- [ ] Prices sourced and dated in `pricing.ts`.
- [ ] Commit: `feat: model cost, monthly budgets and usage`.

## 9. Interview angle

*"How do you control model cost?"* Three layers. Cheap models for classify and extract, and a stronger
one only for drafts. Every call is costed in integer micro-dollars, so cost per 100 messages is exact.
And each business has a monthly budget, enforced by reserving the worst-case cost with one conditional
`UPDATE` before each call and settling to the real cost after, so concurrent jobs can't overspend.
When a business hits its budget, its messages still arrive and go to a person. The cap stops the
model, never the customer.
