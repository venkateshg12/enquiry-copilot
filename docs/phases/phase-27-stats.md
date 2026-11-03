# Phase 27 — Stats

## 1. Goal

A `/stats` page that answers what the owner (and an interviewer) asks, per business and date range,
in the business's timezone:

- **messages** per category and per channel, and how much spam was caught;
- **reply time**, received → sent: mean, median (p50) and p90. This is the pilot's before/after number;
- **time to draft**, received → checks done: p50 and p95, against the spec's "under 15 s";
- **% of replies approved without edits**, overall and by category, with the edit-size distribution;
- **flags**: drafts flagged, by code; how many strong flags were approved anyway, and why;
- **cost**: per 100 messages, and per step and model (from `model_calls`);
- **top edits**: the phrases staff most often remove or add (input for the next prompt version, Phase 30).

It's served by one SQL service with cached results (the `stats` cache domain from Phase 07).

## 2. What I will understand after this phase

1. Which timestamps make which metric, and why reply time ends at `sentAt`, not `approvedAt`.
2. Why "approved without edits" is an honest but imperfect quality proxy, and what to show next to it.
3. How `percentile_disc`, `FILTER` and `AT TIME ZONE` turn this into a few SQL statements.
4. Why every raw query carries `org_id` itself.
5. How versioned cache keys keep a dashboard cheap without ever showing stale numbers for long.

## 3. Prerequisites

- Phase 26 done; some processed, approved and sent messages (seed below).
- Phase 07's cache (`cache.versionedKey`, `cache.bump`, domain `stats`).

## 4. Files

```
packages/types/src/stats.ts                    NEW    statsQuerySchema { from?, to? (yyyy-mm-dd) }, StatsSummary
apps/api/src/
├── services/stats.service.ts                  NEW    (the shape of @pt-api/src/services/quality.service.ts)
├── services/topEdits.service.ts               NEW    (n-gram counts over edited replies, uses utils/text/wordDiff.ts ops)
├── utils/ratio.ts                             COPY   @pt-api/src/utils/ratio.ts
├── utils/text/wordDiff.ts                     ADAPT  (Phase 24's file: + wordOps() returning removed/added runs)
├── controllers/stats.controller.ts · routes/stats.route.ts   NEW   GET /orgs/:orgId/stats (stats.read)
├── services/approval.service.ts               ADAPT  (resolve Phase 24's "// Phase 27: cache.bump" comments)
├── services/booking.service.ts                ADAPT  (+ cache.bump("stats") after approve/status)
├── jobs/processors/sendReply.processor.ts     ADAPT  (+ bump after markSent)
├── jobs/processors/processMessage.processor.ts ADAPT (+ bump when a message reaches "checked")
└── scripts/seed-stats.ts                      NEW    (30 fake-provider messages with scripted outcomes)
apps/web/src/
├── api/stats.ts · hooks/stats/useStats.ts     NEW
├── app/(app)/stats/page.tsx                   ADAPT  @pt-web/src/app/(app)/quality/page.tsx (recharts layout, date range in the URL)
└── components/stats/{KpiTiles,CategoryBar,ReplyTimeTrend,FlagsBar,TopEditsTable,OverridesTable}.tsx   NEW
```

`recharts` is already a dependency of the web app (Phase 09 copied PaperTrail's `package.json`, which
has it).

## 5. Concepts

**Which timestamps.**

| Metric | From → to | Columns |
| --- | --- | --- |
| Time to draft | received → checks finished | `messages.received_at` → `ai_results.updated_at` where `stage = 'checked'` and `attempt = 1` |
| Human time | draft ready → approved | `ai_results.updated_at` → `replies.approved_at` |
| **Reply time** | received → **sent** | `messages.received_at` → `replies.sent_at` (`kind = 'initial'`) |
| Cost | — | `sum(model_calls.cost_usd_micros)` over the range |

Reply time is the customer's experience, and the pilot claim ("cut average reply time from X hours
to Y minutes") is about it. It ends at `sentAt` because an approved reply stuck behind an expired
Gmail token hasn't reached anyone. Measure the business's **baseline for two weeks before** switching
the assistant on, from their Sent folder or a manual log (spec §10). The stats page can only show the
"after".

Only the **first** attempt counts toward time to draft. A reprocess a day later isn't pipeline
latency.

**"Approved without edits".** The spec's target is ≥ 70 % in your own testing. It's a proxy: a
reviewer in a hurry approves a mediocre draft, and a picky one edits a good one. So the page always
shows it with:
- the **edit-size distribution** (0 words, 1–5, 6–20, more than 20). Mostly small edits means the
  drafts are close;
- the split **by category**. Booking drafts near 90 % and complaint drafts at 40 % is a finding, not
  a failure;
- **top edits**: what people actually change.

**One service, a few statements.** `stats.service.ts` follows `quality.service.ts`: `Promise.all`
over raw queries, each with `org_id = ${orgId}::uuid` in its `WHERE`. Raw SQL bypasses the tenant
extension, so that predicate **is** the tenant scope (the ADR 0010 rule). The core statement:

```sql
SELECT m.category::text                                                         AS category,
       m.channel::text                                                          AS channel,
       count(*)::int                                                            AS messages,
       count(*) FILTER (WHERE m.status = 'spam')::int                           AS spam,
       count(r.id)::int                                                         AS replied,
       count(r.id) FILTER (WHERE NOT r.was_edited)::int                         AS unedited,
       count(r.id) FILTER (WHERE cardinality(r.overridden_flags) > 0)::int      AS overridden,
       avg(extract(epoch FROM r.sent_at - m.received_at) * 1000)::float8        AS reply_ms_mean,
       percentile_disc(0.5) WITHIN GROUP (ORDER BY r.sent_at - m.received_at)   AS reply_p50,
       percentile_disc(0.9) WITHIN GROUP (ORDER BY r.sent_at - m.received_at)   AS reply_p90
FROM messages m
LEFT JOIN replies r ON r.message_id = m.id AND r.kind = 'initial' AND r.send_status = 'sent'
WHERE m.org_id = ${orgId}::uuid
  AND m.received_at >= ${from} AND m.received_at < ${toExclusive}
GROUP BY GROUPING SETS ((m.category, m.channel), (m.category), ())
```

`GROUPING SETS` returns the per-category, per-channel and overall rows in one pass. The others:
- **time to draft**: `percentile_disc(0.5 | 0.95)` over `a.updated_at - m.received_at`, joined on
  `stage = 'checked' AND attempt = 1`;
- **flags by code**: `jsonb_array_elements(a.checks->'flags')` grouped by `->>'code'` and `->>'severity'`;
- **overrides**: `unnest(r.overridden_flags)` with `r.override_reason`, the most recent 20 rows
  (reasons shown to admins only);
- **cost**: `sum(cost_usd_micros)` grouped by `purpose, model`, divided by messages processed × 100;
- **per day**: the same counts grouped by `to_char(m.received_at AT TIME ZONE ${org.timezone}, 'YYYY-MM-DD')`.
  Days are the business's days, not UTC's. A message at 1 am IST belongs to that IST day.

**Range and timezone.** `from` and `to` are calendar days in the business timezone. They're turned
into instants with Phase 26's `zonedToUtc(day, "00:00", tz)`, with `to` exclusive (the next day's
midnight). The default range is the last 30 days. The maximum is 366 days, so one request can't scan
years.

**Cache.** The key is `cache.versionedKey(["stats"], \`stats:${orgId}:${from}:${to}\`)` with a TTL of
300 s. Every write that changes a number bumps the domain: pipeline reaching `checked`, approve,
reject/spam, send, booking approve. A bump retires every cached range at once. That's coarse, but
writes here are a few per minute per business at most, and it's what makes "approve, open stats, see
it counted" true without any per-key bookkeeping. Redis down → a cache miss → the query runs (the
cache never throws).

**Top edits.** For edited initial replies in the range (newest first, at most 500),
`wordOps(draftText, finalText)` gives the removed and added runs. Count their 2–4-word n-grams
(lower-cased), after replacing numbers with `#` and the customer's name with `{name}`. Return the top
15 removed and the top 15 added. Seeing "Removed: *feel free to* ×23" is a tone fix for the next draft
prompt. Staff behaviour becomes prompt work (Phase 30). It runs in Node on at most 500 short texts, so
it's well under 100 ms, and it's cached with the rest.

Removed and added phrases contain words from replies. The response only goes to `stats.read` users of
this business, and n-grams of three words or fewer can't carry a customer's full contact. Numbers are
already `#`.

**Who sees what.** `stats.read` (viewer and up) sees everything except override reasons and top-edit
phrases, which need `org.update` (admin and up). Reasons are free text a reviewer typed.

## 6. Steps

1. **Types.** `statsQuerySchema` (two optional `yyyy-mm-dd` strings, validated as real days, range ≤
   366) and `StatsSummary`:
   `{ range, totals, byCategory[], byChannel[], replyTime { meanMs, p50Ms, p90Ms }, timeToDraft { p50Ms, p95Ms }, editSizes, flags[], overrides[], cost { per100Usd, byPurposeModel[] }, daily[], topEdits? }`.
   Durations are milliseconds and cost is USD (number), so the web app formats them and never does
   arithmetic on them.
2. **`stats.service.ts`.** Run the statements above with `Promise.all`. Convert Postgres `interval`
   results to ms with `extract(epoch …) * 1000` in SQL. Use `ratio()` for every percentage (0 when the
   denominator is 0, never `NaN`). Cache as described.
3. **`topEdits.service.ts`.** Add `wordOps()` to `wordDiff.ts` (a backtrace over the same DP table
   returning `{ removed: string[][], added: string[][] }`) and count the n-grams.
4. **Bumps.** Resolve Phase 24's `// Phase 27:` comments, and add `cache.bump("stats")` to the booking
   approve/status paths, `markSent`, and the pipeline's `checked` checkpoint. Bumps happen **after**
   the transaction commits, never inside it. A bump for a rolled-back write would only cost a cache
   miss, but bumping first and then committing lets a fast reader cache the old numbers under the new
   version.
5. **Route.** `GET /orgs/:orgId/stats?from&to` behind `authenticate`, `resolveOrg`,
   `requireOrgRole("stats.read")`. The service drops admin-only fields for lower roles.
6. **Seed.** `scripts/seed-stats.ts` creates 30 messages through the real intake with the `fake`
   provider and scripted categories. It approves 20 (8 of them edited, 2 with overrides), rejects 3,
   marks 2 as spam, leaves 5 waiting, and back-dates `received_at`/`sent_at` to known gaps so the
   expected percentiles can be computed by hand.
7. **Web.** ADAPT the PaperTrail quality page's layout:
   - KPI tiles: messages, reply time p50, time to draft p95 (green under 15 s), approved without edits
     %, cost per 100 messages;
   - charts: messages per category (bar), reply time p50 per day (line), flags by code (bar);
   - tables: top edits, overrides (admins);
   - the range picker writes `?from&to` to the URL, so a view can be shared and reloaded. Every number
     shows its denominator ("14 of 20 replies").

## 7. Verify

```bash
pnpm --filter api tsx src/scripts/seed-stats.ts --org $ORG
curl -s -b cookies.txt "$API/orgs/$ORG/stats?from=2026-11-01&to=2026-11-30" | jq '.data | {totals, replyTime, timeToDraft, approvedWithoutEdits: .totals.uneditedRate}'
```

1. Totals match the seed: 30 messages, 2 spam, 20 replied. Unedited rate is 12 / 20 = 0.6.
2. Reply-time p50 and p90 match a hand computation from the seed's back-dated gaps (the script prints
   the expected values).
3. A message received at 2026-11-10 00:30 IST is counted on 10 Nov, not 9 Nov (the UTC day).
4. Call twice → the second is a cache hit (debug log `cache.hit` with the `stats` key). Approve one more
   message → the next call returns `replied: 21`.
5. `docker compose stop redis-cache` → stats still load (a miss on every call), with no error. Start it
   again.
6. As a `viewer`: `overrides` and `topEdits` are absent. As an `admin`: present.
7. `EXPLAIN ANALYZE` the core statement on the seeded data → it uses
   `messages_org_id_received_at_idx` (Phase 13's `@@index([orgId, receivedAt])`).
8. A range of 400 days → 400 `VALIDATION_ERROR`.

## 8. Definition of done

- [ ] Every metric in §1 per business and range, timezone-correct, as SQL aggregates with `org_id` in each raw statement.
- [ ] Cached under `stats`, bumped after every write that changes a number; works with the cache down.
- [ ] Top edits and overrides for admins; every percentage shows its denominator.
- [ ] Verify steps 1–8 pass.
- [ ] Commit: `feat(api,web): stats`.

## 9. Interview angle

*"How do you know it's helping?"*
- **Reply time** from received to *sent*, the customer's experience, compared with a two-week baseline
  I measure before switching it on.
- **Share of replies approved without edits**, shown with its denominator, the edit-size distribution
  and a per-category split, because the overall number alone hides that complaint drafts get
  rewritten.
- **Top edits**: what people actually change becomes the next prompt version.

Under the hood it's a few Postgres aggregates with `percentile_disc` and `GROUPING SETS`, days bucketed
in the business's timezone, and a versioned cache that any write invalidates in O(1).
