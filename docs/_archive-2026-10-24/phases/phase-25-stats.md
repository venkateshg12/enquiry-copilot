# Phase 25 — Stats

## 1. Goal

A `/stats` page that answers what the owner (and an interviewer) cares about, per business and date
range:
- **messages per category** and per channel, with spam caught;
- **reply time**: received → sent, p50 / p90 (the pilot's before/after number);
- **AI time**: received → draft ready, p50 / p95 (the spec's "< 15 s");
- **% of drafts approved without edits**, by category, plus the **edit size** distribution;
- **flags**: drafts flagged, by code; overrides and their reasons;
- **cost**: per 100 messages and per step (from `aiCalls`), by model;
- **top edits**: phrases most often removed or added by staff (input for the next prompt version).

Served by cached aggregates (the `stats` cache domain, Phase 07).

## 2. What I will understand after this phase

1. Which timestamps make which metric, and why reply time uses `sentAt`, not `approvedAt`.
2. Why "approved without edits" is the honest quality proxy here (and its blind spots).
3. How to compute percentiles in MongoDB and keep the aggregates cheap.

## 3. Prerequisites

Phase 24 done; some processed and approved messages.

## 4. Files

```
apps/api/src/services/stats.service.ts      NEW
apps/api/src/routes/stats.route.ts          NEW   (GET /stats?from&to — stats.read)
apps/web/src/app/(app)/stats/page.tsx · components/stats/*   NEW
```

```bash
pnpm --filter web add recharts
```

## 5. Concepts

**Timestamps.**

| Metric | From → to | Source |
| --- | --- | --- |
| AI time | `message.receivedAt` → `needs_approval` entry in `statusHistory` | message |
| Human time | `needs_approval` → `reply.approvedAt` | message + reply |
| **Reply time** | `receivedAt` → `reply.sentAt` | the customer's experience |
| Queue wait | `receivedAt` → pipeline job start (`pipelineStartedAt`) | message |

Reply time is the pilot metric ("cut average reply time from X hours to Y minutes"). Measure the
business's baseline for two weeks **before** turning the assistant on (spec §10), from their sent
folder or a manual log.

**"Approved without edits".** Spec target: ≥ 70 % in your own testing. It's a proxy: a staff member in
a hurry may approve a mediocre draft. Pair it with the edit-size distribution (most edits small?) and
the top-edits list. Report it by category: booking drafts may be near 90 %, complaint drafts much lower,
and that's informative.

**Percentiles** with `$percentile` (MongoDB 7+, `method: "approximate"`), as in PaperTrail's usage
endpoint. **Cache**: `versionedKey(["stats"], \`org:${orgId}:${from}:${to}\`)`, TTL 300 s. Approvals,
sends and pipeline completions bump `stats`.

**Top edits.** From `Reply.diff` (word-level): count removed and added phrases (2–4 word n-grams) across
edited replies, ignoring names and numbers. "Removed: 'feel free to' ×23" → a tone fix for the next
draft prompt. It turns staff behaviour into prompt work (Phase 28).

## 6. Steps

1. `stats.service.ts`, one `$facet` aggregation over messages joined to replies for the range:
   - by category and channel;
   - the time percentiles;
   - approval-without-edit share by category;
   - flags by code;
   - overrides;
   - a separate aggregate over `aiCalls` for cost per step and model.

   Indexes: `{ orgId, receivedAt }` (Phase 12) and `{ orgId, createdAt }` on `aiCalls`.
2. `topEdits(orgId, range)`: stream edited replies' diffs, n-gram counts in memory, top 20.
3. The page:
   - KPI tiles (messages, reply time p50, AI time p95, approved without edits %, cost per 100
     messages);
   - charts: category bar, reply-time trend line, flags bar;
   - tables: top edits, overrides.

   All with the date range in the URL and timezone-correct days (`$dateTrunc` with the business
   timezone).
4. The platform-admin view (`requireAdmin`): totals across businesses and model health (PaperTrail's
   `/health/llm` breaker states).

## 7. Verify

Seed 30 messages through the pipeline (fake provider, scripted categories), approve 20 (8 edited),
reject 3, spam 2 → the tiles match a hand count; the reply-time percentiles match a manual computation
on 10 of them; a second load within 5 min is a cache hit; approving one more updates the numbers on the
next load.

## 8. Definition of done

- [ ] The metrics above per business and range, cached and timezone-correct.
- [ ] Top edits and overrides visible.
- [ ] Commit: `feat: stats`.

## 9. Interview angle

*"How do you know it's helping?"* Reply time from received to sent, compared with a two-week baseline,
plus the share of drafts approved without edits by category, and what staff most often change, which
feeds the next prompt version.
