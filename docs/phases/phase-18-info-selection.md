# Phase 18 — Info-sheet selection

## 1. Goal

Decide **which info-sheet entries the draft prompt may see**, and render them into one stable text
block:

- **the whole sheet when it fits** the token budget, which is the spec's starting point and the normal
  case for a small business;
- above the budget, a **deterministic selection**:
  - always: the address and the policies;
  - the matched service and its price entries;
  - the entry types the category needs;
  - then keyword/synonym overlap with the message, filled to the budget;
- a result with the **selected entry ids**, the rendered block and a reason per entry. Phase 21 stores
  the ids on `AiResult.infoEntryIds`, and Phase 20's checks build the allowed facts from **exactly**
  these entries.

Embeddings (simple RAG) are written down as the next step, not built.

## 2. What I will understand after this phase

1. Why the checks' allowed-facts set must equal what the model was shown, not the whole sheet.
2. When "send everything" is right, and what changes when it isn't (cost, distraction, missed facts).
3. Why a deterministic keyword selector beats embeddings for a 20–60-entry sheet.
4. Why stable rendering matters for caching, replay and diffs.

## 3. Prerequisites

- Phase 17 done (`ExtractResult`, `matchService`).
- Phase 12 done (`InfoEntry`: `type`, `title`, `content`, `synonyms`, `position`, `active`). Like the
  other steps, selection takes entries as plain objects.

## 4. Files

```
packages/types/src/pipeline.ts          ADAPT  (+ InfoEntryInput, Selection, INFO_TOKEN_BUDGET)
apps/api/src/pipeline/
├── renderInfo.ts                       NEW    (pure: renderEntry + renderInfo: entries → the block the prompt sees; tags)
├── selectInfo.ts                       NEW    (pure: budgeted, deterministic selection with reasons)
├── selectInfo.test.ts                  NEW
└── textMatch.ts                        NEW    (pure: normalise, tokens, stop words, light stemming; shared with matchService)
apps/api/src/scripts/try-pipeline.ts    ADAPT  (`--step select` prints the block, the reasons, the token estimate)
apps/api/samples/info-sheet-large.json  NEW    (a generated 200-entry sheet for the budget tests)
```

## 5. Concepts

**The checks must see what the model saw.** Phase 20's invented-number check asks: is every number
in the draft present in the facts the model was given, or in the customer's message? If the model saw
a subset but the checks allowed the **whole** sheet, a number from an entry the model never saw would
pass, and it could only have come from the model's own head. So the selection is the single source of
"allowed facts": the draft prompt renders `selection.entries`, and the checks rebuild their allowed set
from `selection.entries`. In the pipeline both happen in the same job, from the same object.

When a person edits a draft later (Phase 24), the checks re-run against the entries in
`AiResult.infoEntryIds`. If any of those entries was edited after the AI result was created
(`updatedAt > aiResult.createdAt`), the inbox shows "info sheet changed since this draft". The check
then uses the current text, and the reviewer knows.

**Everything, when it fits.** A coaching centre's sheet is 20–40 entries, about 1,000–2,000 tokens.
Sending it all is simple, and no fact gets dropped by a selector. `INFO_TOKEN_BUDGET = 2000`, estimated
as `ceil(chars / 4)`. That estimate is deliberately rough: the budget protects cost and focus, not a
hard context limit, so a 20 % error doesn't matter. Phase 22's recorded `tokensIn` shows the real
numbers.

**Over budget: deterministic, explainable selection.**

| Step | Entries | Reason recorded |
| --- | --- | --- |
| 1 | every `address` and `policy` entry | `always` |
| 2 | the service matching `details.service` (title or synonym), and every `price` entry whose title or content names it | `matched_service` |
| 3 | entries of the types the category needs (table below), ranked by overlap score | `category:<type>` |
| 4 | everything else with overlap score > 0, best first | `keyword:<terms>` |

Steps 3–4 stop adding entries at the budget. Steps 1–2 are always included, even over budget: losing
the address or the matched price is worse than a long prompt. A sheet whose must-includes alone are
over budget logs a warning, a sign the sheet needs tidying, not a pipeline error.

| Category | Types it needs |
| --- | --- |
| `booking` | `service`, `price`, `timing` |
| `price_or_info` | `service`, `price`, `timing`, `faq` |
| `complaint` | `timing` (policies come from step 1) |
| `follow_up` | `timing` |
| `other` | `faq` |

**Overlap score.** Normalise (lower-case, strip punctuation, drop stop words, light stemming: `-ing`,
`-es`, `-s`). Score = matches between the message + `question_summary` and the entry, where **title
and synonym** matches count 2 and content matches count 1. Ties break on `position`, then `id`, so the
same input always produces the same block. Tests assert that.

Why not embeddings? With 40 entries, keyword overlap with synonyms finds the right ones. Embeddings
would cost a model call per message, need an index kept in sync with every edit, and their choices
are hard to explain to an owner. They pay off at hundreds of entries or when customers' words rarely
match the sheet. The README lists it as "later: retrieval with NVIDIA embeddings when a sheet grows
past ~150 entries", with this phase's budget warning as the trigger.

**Stable rendering.** Entries are grouped in a fixed type order, then by `position`:

```
[S1] Python crash course: 6 weeks, weekends, beginners welcome.
[P1] Python crash course fee: ₹4,999 for the full course.
[T1] Weekend timings: Saturday and Sunday 10:00–13:00.
[A1] Address: 2nd floor, 14 MG Road, Pune. Opposite City Mall.
[L1] Cancellation policy: free to reschedule up to 24 hours before.
```

Tags (`S`ervice, `P`rice, `T`iming, `L` for policy, `F`AQ, `A`ddress, numbered per type in render
order) let reviewers see which fact a sentence came from. The draft prompt tells the model not to copy
them, and Phase 19 strips any that slip through. The same entries always render to the same bytes,
which keeps replay keys (Phase 15), eval diffs and prompt-size numbers stable.

## 6. Steps

1. Types:
   ```ts
   export const INFO_TYPES = ["service", "price", "timing", "policy", "faq", "address"] as const;
   export type InfoEntryInput = { id: string; type: (typeof INFO_TYPES)[number]; title: string; content: string; synonyms: string[]; position: number };
   export type SelectionReason = "all" | "always" | "matched_service" | `category:${string}` | `keyword:${string}`;
   export type Selection = {
     entries: InfoEntryInput[];
     ids: string[];
     block: string;
     reasons: Record<string, SelectionReason>;
     estimatedTokens: number;
     mode: "all" | "selected";
     overBudget: boolean;                 // must-includes alone exceeded the budget
   };
   export const INFO_TOKEN_BUDGET = 2000;
   ```
2. `textMatch.ts`: `normalise`, `tokens(text) → string[]` (stemmed, stop words removed), `STOP_WORDS`
   (English plus common Hinglish fillers: `hai, kya, ka, ki, ke, ko, mein, bhai, sir, pls`). Phase 17's
   `matchService` is refactored to use `normalise` from here (same behaviour; its tests still pass).
3. `renderInfo.ts`:
   ```ts
   const ORDER = ["service", "price", "timing", "policy", "faq", "address"] as const;
   const LETTER = { service: "S", price: "P", timing: "T", policy: "L", faq: "F", address: "A" } as const;
   /** One entry's text exactly as the prompt shows it (minus the tag). Phases 20 and 23 reuse it. */
   export const renderEntry = (e: Pick<InfoEntryInput, "title" | "content">) =>
     `${e.title}: ${e.content.replace(/\s+/g, " ").trim()}`;
   export const renderInfo = (entries: InfoEntryInput[]) => {
     const lines: string[] = [];
     for (const type of ORDER) {
       entries.filter((e) => e.type === type)
         .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
         .forEach((e, i) => lines.push(`[${LETTER[type]}${i + 1}] ${renderEntry(e)}`));
     }
     return lines.join("\n");
   };
   export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
   ```
4. `selectInfo.ts`:
   ```ts
   export const selectInfo = (
     all: InfoEntryInput[],
     ctx: { body: string; summary?: string | null; service?: string | null; category: Category },
     budget = INFO_TOKEN_BUDGET
   ): Selection => {
     const sorted = [...all].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
     const fullBlock = renderInfo(sorted);
     if (estimateTokens(fullBlock) <= budget) {
       return finish(sorted, Object.fromEntries(sorted.map((e) => [e.id, "all"])), "all", false);
     }
     const reasons: Record<string, SelectionReason> = {};
     const picked: InfoEntryInput[] = [];
     const add = (e: InfoEntryInput, reason: SelectionReason) => { if (!reasons[e.id]) { reasons[e.id] = reason; picked.push(e); } };

     sorted.filter((e) => e.type === "address" || e.type === "policy").forEach((e) => add(e, "always"));
     if (ctx.service) {
       const svc = tokens(ctx.service);
       sorted.filter((e) => (e.type === "service" && normalise(e.title) === normalise(ctx.service!)) ||
                            (e.type === "price" && svc.every((t) => tokens(`${e.title} ${e.content}`).includes(t))))
             .forEach((e) => add(e, "matched_service"));
     }
     const overBudget = estimateTokens(renderInfo(picked)) > budget;

     const query = tokens(`${ctx.body} ${ctx.summary ?? ""}`);
     const scored = sorted.filter((e) => !reasons[e.id])
       .map((e) => ({ e, ...overlap(e, query) }))
       .sort((a, b) => b.score - a.score || a.e.position - b.e.position || a.e.id.localeCompare(b.e.id));
     const needs = new Set(CATEGORY_TYPES[ctx.category]);
     for (const pass of ["category", "keyword"] as const) {
       for (const s of scored) {
         if (reasons[s.e.id]) continue;
         if (pass === "category" && !needs.has(s.e.type)) continue;
         if (pass === "keyword" && s.score === 0) continue;
         if (estimateTokens(renderInfo([...picked, s.e])) > budget) continue;
         add(s.e, pass === "category" ? `category:${s.e.type}` : `keyword:${s.terms.slice(0, 3).join(",")}`);
       }
     }
     return finish(picked, reasons, "selected", overBudget);
   };
   // finish(): renders the block in canonical order, ids in that same order, estimatedTokens.
   ```
5. Tests (`selectInfo.test.ts`):
   - the demo sheet (Phase 12 seed) → `mode: "all"`, every active entry, `block` identical across 100
     runs;
   - the generated 200-entry sheet:
     - a booking for "Python crash course" includes its service and price entries, every timing that
       fits, the address and every policy;
     - `estimatedTokens ≤ budget` unless `overBudget`;
   - a complaint includes the policies and no FAQ unless keywords match;
   - unknown service (`null`) → no `matched_service` reasons;
   - shuffled input → identical output (determinism);
   - a sheet with 60 long policies → `overBudget: true`, all policies still present, a warning logged
     by the caller (not by this pure function).
6. `try-pipeline --step select --info <file> "<message>"` (`--info` takes either a bare array of
   entries, like `samples/info-sheet-large.json`, or the `{ org, infoEntries }` demo fixture
   `evals/fixtures/codenest.json`) prints the mode, each
   entry's tag and reason, and the token estimate. With `--step extract,select` it feeds extract's
   `details.service` and `question_summary` in.

```ts
// Phase 19: draftReply(ctx) receives this Selection and renders selection.block into the prompt.
// Phase 20: runChecks(draft, { allowedEntries: selection.entries, … }).
// Phase 21: AiResult.infoEntryIds = selection.ids.
```

## 7. Verify

```bash
pnpm --filter api test -- pipeline/selectInfo pipeline/textMatch pipeline/postExtract
pnpm --filter api try-pipeline -- --step select --info evals/fixtures/codenest.json "python weekend fees?"
# → mode=all  entries=22  ~1,380 tokens
pnpm --filter api try-pipeline -- --step select --info samples/info-sheet-large.json --category booking --service "Python crash course" "can i join python this sat 5pm"
# → mode=selected  [S1] matched_service  [P1] matched_service  [T1..T3] category:timing  [A1] always  [L1..L4] always  … ≤ 2,000 tokens
```

## 8. Definition of done

- [ ] Whole sheet under the budget; deterministic selection with must-includes and reasons above it.
- [ ] Stable rendering with type tags; identical bytes for identical input (tested with shuffles).
- [ ] The `Selection` (ids + entries) is what Phases 19, 20 and 21 consume. Comments are in place.
- [ ] Embeddings documented as a later improvement with a concrete trigger.
- [ ] Commit: `feat(pipeline): info-sheet selection`.

## 9. Interview angle

*"Did you use RAG?"* Not at this size. A small business's info sheet fits in the prompt, so v1 sends
all of it. Above a token budget a deterministic selector takes over: the address and policies always,
the matched service and its price, then keyword overlap, with a recorded reason for every entry. The
more important design point is that the safety checks verify every number in the draft against exactly
the entries the model was shown. A number from anywhere else counts as invented, even if it happens to
be correct somewhere on the sheet.
