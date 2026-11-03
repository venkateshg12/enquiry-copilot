# Phase 28 — Iterate with Prompt Lab; final test run

## 1. Goal

Improve the prompts with numbers (spec §6), then measure once:
1. load the exported **classify** and **extract** tasks into **Prompt Lab** (`~/Code/prompt-lab`);
2. compare **2–3 prompt versions × 2 models** (the cheap tier vs a stronger model) on **dev**: accuracy,
   valid JSON, consistency, cost, latency;
3. iterate the **draft** prompt with this repo's pipeline eval (drafts need the checks and your review,
   which Prompt Lab doesn't do);
4. fix the top mistakes. Write each change and its measured effect in `EXPERIMENT.md`;
5. run **once** on **test** (Prompt Lab for classify/extract; the pipeline eval + your review for
   drafts) and fill in the README results table.

## 2. What I will understand after this phase

1. Why classify/extract belong in a generic benchmark tool and drafts don't.
2. How to decide whether the cheap model is good enough (accuracy vs cost per 100).
3. How staff edits and error buckets become specific prompt changes.

## 3. Prerequisites

Phase 27 done. Prompt Lab running locally (or at least its CLI, from Prompt Lab's fast track).

## 4. Files

```
cases/demo-business/prompts/
├── classify.v1.md · classify.v2.md · …        (Prompt Lab format; mirrored into apps/api/src/ai/prompts/*.ts)
├── extract.v1.md · extract.v2.md · …
├── draft.v1.ts → draft.v2.ts …                 (in apps/api/src/ai/prompts)
└── EXPERIMENT.md                               NEW   (lab notebook: run ids, changes, deltas, decisions)
```

## 5. Concepts

**The right tool for each step.**
- **Classify and extract** have right answers. Prompt Lab's field-rule scoring (enum exact, text
  normalised, consistency across repeats) is exactly right, and its results table compares prompt ×
  model directly. That's also a cross-project story: one tool measuring another product.
- **Drafts** are judged by the safety checks plus a human. They're measured with this repo's eval and
  your review sheet (Phase 27), not forced into a field scorer.

**Cheap model, proven.** For classify and extract, run the cheap tier and a stronger model. If the
cheap model is within ~2 points on dev at a fraction of the cost per 100 messages, keep it. That's the
spec's interview answer, with a table behind it. If it's clearly worse on a tag (e.g. Hinglish), say so
and consider routing only those messages to the stronger model (note it as future work rather than
building it, unless it's cheap).

**From mistakes to changes.** Typical buckets and the fixes they suggest (your data decides):

| Bucket (found in Prompt Lab's error browser / your review) | Change |
| --- | --- |
| price + booking classified `price_or_info` | strengthen the tie-break rule and add an example |
| Hinglish complaints classified `other` | a Hinglish complaint example |
| "this Saturday" off by a week on Fridays | the received-weekday line in the prompt + an example; the weekday cross-check already flags it |
| `service` filled with a non-sheet course | list services with synonyms and "else null"; the code check already nulls it |
| drafts too long / "feel free to reach out" padding (top edits, Phase 25) | a tone rule + a shorter example |
| drafts restate the customer's phone | already masked by checks; add a prompt rule to avoid it entirely |

Each change creates a **new version** (`classify@2`), never an edit. Mirror `.md` ⇄ `.ts` (the unit
test from Phase 15).

**Run test once.** As in Prompt Lab: develop on dev; when you stop, run the final versions on test one
time. Re-running test after changes makes it a second dev set. If you do, say it in the README.

## 6. Steps

1. In Prompt Lab:
   - create tasks `enquiry-classify` and `enquiry-extract` from the exported `task.json` files;
   - import `classify.jsonl` and `extract.jsonl` (Phase 27 export);
   - add the prompt versions from `cases/demo-business/prompts/*.md`;
   - register the models (cheap tier, stronger tier).
2. Dev runs (3 repeats). Record the run ids, the Markdown exports, and the top error buckets in
   `EXPERIMENT.md`.
3. Write v2 (and further) prompts for classify/extract; re-run on dev; keep or revert by measured delta.
4. Drafts:
   - `pnpm --filter api eval -- --split dev` → the review sheet → judge → the top issues;
   - `draft@2` with targeted fixes;
   - repeat;
   - then fold the improved prompts into the app (`ai/prompts/*.ts`, the version registry).
5. Final:
   - **test** runs in Prompt Lab for classify/extract;
   - `eval -- --split test` + a fresh review for drafts;
   - publish the Prompt Lab runs (read-only pages) and fill the README table:

| Step | Metric | Result |
| --- | --- | --- |
| Classify | Category accuracy (test, n=…) | from Prompt Lab |
| Extract | Field accuracy / valid JSON | from Prompt Lab |
| Draft | Approved without edits | from your test review |
| Draft | Invented numbers caught by checks | planted recall + "invented facts reaching approval: 0" |
| Draft | Injection attempts followed | from the eval |
| Overall | Cost per 100 messages / p95 time to draft | from the eval (+ production p95 from stats) |

## 7. Verify

- `EXPERIMENT.md` links every run with its deltas; prompt versions are immutable and mirrored.
- One test run per final version; the README table equals the exports.
- The model choice is justified with accuracy **and** cost from the table.

## 8. Definition of done

- [ ] Classify/extract compared in Prompt Lab across versions and two models; drafts improved via the
      eval + review.
- [ ] Final test numbers published and in the README; the improvement story written.
- [ ] Commit: `experiment: prompt iteration and final test results`.

## 9. Interview angle

*"How did you improve the prompts?"* I benchmarked classify and extract in my own Prompt Lab tool:
three versions, two models, on a labelled dev set. I fixed the biggest error buckets, such as price +
booking tie-breaks, Hinglish complaints and relative dates. The cheap model held up within N points at
a fraction of the cost, and drafts improved through my review and staff-edit patterns. Then I ran the
held-out test set once.
