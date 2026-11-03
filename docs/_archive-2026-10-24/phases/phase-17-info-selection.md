# Phase 17 — Info-sheet selection

## 1. Goal

Choose **which info-sheet entries** the draft prompt sees, and render them into one stable text block:
- **v1: include everything** when the sheet is small (the spec's starting point), under a token
  budget;
- above the budget: **keyword/BM25-style scoring** against the message, the category and the extracted
  service, always including the matched service, its price and the timings;
- the selected entry ids are recorded on the draft, so the safety checks (Phase 19) use **exactly**
  the facts the model was given.

Embeddings (simple RAG) are documented as the next step, not built.

## 2. What I will understand after this phase

1. Why the allowed-facts set for the checks must equal what the model saw.
2. When "send everything" is fine, and when it stops being fine (cost, distraction).
3. How a deterministic keyword selector beats embeddings for a 30-entry sheet.

## 3. Prerequisites

Phase 16 done.

## 4. Files

```
apps/api/src/pipeline/
├── renderInfo.ts            NEW   (pure: entries → the text block the prompt sees)
├── selectInfo.ts            NEW   (pure: budgeted selection)
└── selectInfo.test.ts       NEW
```

## 5. Concepts

**The checks must see what the model saw.** If the draft cites a price from an entry that wasn't in
the prompt, it can only have come from the model's own knowledge, i.e. invented. And if the checks'
allowed set were the *whole* sheet while the model saw a subset, a coincidentally matching number would
pass. So the draft result stores `infoEntryIds` and `infoSheetVersion`, and the checks rebuild the
allowed set from exactly those entries.

**Everything, when small.** A coaching centre's sheet is ~20–40 entries, ~1,500 tokens. Sending it all
is simple, and the model can't miss a relevant fact because a selector dropped it. Budget:
`INFO_TOKEN_BUDGET = 2500` (estimated as `chars / 4`).

**Over budget: deterministic scoring.**
1. Always include:
   - the extracted service's entry and any `price` entries mentioning it;
   - all `timing` entries (bookings need them);
   - the `address` (cheap);
   - for complaints, the `policy` entries.
2. Score the rest with term overlap (lower-cased, stop-words removed, light stemming) between the
   message + question summary and each entry's title + content; title matches count double.
3. Fill to the budget in score order.

It's explainable ("included because it mentions *weekend*") and testable. Embeddings need a model call
per message plus an index, and only pay off at hundreds of entries. That's the README's "later
improvement".

**Rendering is stable.** Entries are grouped by type in a fixed order, each as
`[S3] Python crash course — ₹4,999 per course, 6 weeks, weekends 10:00–13:00`. The id tags (`[S3]`)
let the prompt tell the model to rely on those facts, and help reviewers. They're stripped from any
draft that copies them (a check in Phase 19).

## 6. Steps

```ts
// pipeline/renderInfo.ts
const ORDER = ["service", "price", "timing", "policy", "faq", "address", "contact"] as const;
export const renderInfo = (entries: InfoEntry[], tz: string) =>
    ORDER.flatMap((type) => entries.filter((e) => e.type === type).map((e) => `[${tag(e)}] ${e.title} — ${describe(e, tz)}`)).join("\n");
// describe(): content, plus structured fields in words (price: "₹4,999 per course"; timing: "Sat–Sun 10:00–13:00")
```

```ts
// pipeline/selectInfo.ts
export const selectInfo = (all: InfoEntry[], ctx: { body: string; summary?: string; service?: string | null; category: Category }, budget = INFO_TOKEN_BUDGET) => {
    const tokens = (e: InfoEntry) => Math.ceil(renderInfo([e], "UTC").length / 4);
    if (all.reduce((s, e) => s + tokens(e), 0) <= budget) return { entries: all, reason: "all" as const };
    const must = all.filter((e) => isMustInclude(e, ctx));
    const rest = all.filter((e) => !must.includes(e)).map((e) => ({ e, score: overlapScore(e, ctx) })).sort((a, b) => b.score - a.score || a.e.title.localeCompare(b.e.title));
    const picked = [...must];
    let used = must.reduce((s, e) => s + tokens(e), 0);
    for (const { e, score } of rest) {
        if (score <= 0) break;
        if (used + tokens(e) > budget) continue;
        picked.push(e); used += tokens(e);
    }
    return { entries: picked, reason: "selected" as const };
};
```

Tests: a small sheet → all; a large synthetic sheet (200 FAQ entries) → the service, its price and the
timings are always included, the budget is respected, the result is identical across runs (ties broken
by title).

## 7. Verify

The demo business (≈ 20 entries) → `reason: "all"`. A 200-entry synthetic sheet → ≤ 2,500 estimated
tokens with the must-includes present. The rendered block is identical for identical input.

## 8. Definition of done

- [ ] Stable rendering; budgeted, deterministic selection with must-includes.
- [ ] The selected ids are part of the draft's inputs (wired in Phase 18).
- [ ] Commit: `feat(pipeline): info-sheet selection`.

## 9. Interview angle

*"Did you use RAG?"* Not needed at this size: the whole sheet fits, and a deterministic keyword
selector takes over when it doesn't. What matters more is that the safety checks verify numbers against
exactly the entries the model was shown.
