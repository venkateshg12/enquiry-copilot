# Phase 12 — Business profile and the info sheet

## 1. Goal

Build the **only source of facts** the assistant may use:
- the **business profile** on `Org`: tone guide, signature, timezone, default phone country, supported
  reply languages (migration `info_sheet`);
- the **info sheet**: typed entries (`service`, `price`, `timing`, `policy`, `faq`, `address`), each a
  title and plain-text content, with synonyms for services, ordered, switchable on and off;
- CRUD, reorder, and JSON **import/export** (with a dry run), all behind `info.manage`;
- a cached read of a business's active entries for the pipeline (Phases 18–19);
- the **CodeNest coaching centre** demo fixture (fictional) and a seed script. Phase 29's labelled
  messages are written against it;
- web: `/settings/business` (profile) and `/settings/info-sheet` (editor + "what the AI sees" preview).

## 2. What I will understand after this phase

1. Why facts are separate typed entries, not one free-text blob.
2. Why the draft records **which** entries it was allowed to use (`AiResult.infoEntryIds`, Phase 21),
   and how that replaces a version counter.
3. Why the timezone is part of the business, and how it's validated.
4. Why imports are dry-run by default and replace inside one transaction.
5. Why the info-sheet cache is a per-business key and not a versioned namespace.

## 3. Prerequisites

Phase 11 done. Phase 07's cache.

## 4. Files

```
packages/types/src/
├── infoSheet.ts                               NEW    (entry schemas, import/export file schema, formatInfoEntry)
└── org.ts                                     ADAPT  (updateOrgSchema += profile fields; orgDto profile)
apps/api/
├── prisma/schema.prisma                       ADAPT  (+ enum InfoEntryType, model InfoEntry, Org profile columns incl. isDemo)
├── prisma/migrations/<ts>_info_sheet/         NEW
├── evals/fixtures/codenest.json               NEW    (CodeNest coaching centre — fictional: { org, infoEntries })
└── src/
    ├── db/prisma.ts                           ADAPT  (TENANT_MODELS += "InfoEntry")
    ├── services/org.service.ts                ADAPT  (profile in toOrgDto and updateOrg)
    ├── services/infoSheet.service.ts          NEW    (list, create, update, delete, reorder, import, export, getActiveEntries)
    ├── controllers/infoSheet.controller.ts    NEW
    ├── routes/infoSheet.route.ts              NEW    (mounted at /orgs/:orgId/info-entries)
    └── scripts/seed-demo-business.ts          NEW    (pnpm --filter api db:seed-demo -- --owner <email>)
apps/api/test/tenancy.routes.ts                ADAPT  (+ info-entry routes)
apps/web/src/
├── api/infoSheet.ts                           NEW
├── hooks/infoSheet/{useInfoEntries,useSaveInfoEntry,useDeleteInfoEntry,useReorderInfoEntries,useImportInfoSheet}.ts  NEW
├── app/(app)/settings/business/page.tsx       NEW
├── app/(app)/settings/info-sheet/page.tsx     NEW
└── components/infoSheet/{EntryList,EntrySheet,ImportDialog,AiPreview}.tsx   NEW
```

## 5. Concepts

**Typed entries, so code can check facts.** One pasted blob ("Python ₹4,999, Sat–Sun 10–1, no
refunds after week 1") can go into a prompt, but nothing else can use it. Typed entries let:
- Phase 17 validate `service` against service titles and synonyms;
- Phase 18 choose only the relevant entries (prices for a price question, timings for a booking);
- Phase 20 build the **allowed set** of numbers from exactly the entries the draft was given.

The schema in `data-model.md` keeps entries deliberately simple: `type`, `title`, `content` (plain
text, ≤ 1,000 characters), `synonyms` (services only), `position`, `active`. The safety checks read
numbers out of `content` with the same recognisers they run on the draft, so there's no separate
"price field" to keep in sync with the text.

```ts
// packages/types/src/infoSheet.ts
export const INFO_ENTRY_TYPES = ["service", "price", "timing", "policy", "faq", "address"] as const;
export const infoEntryTypeSchema = z.enum(INFO_ENTRY_TYPES);

export const infoEntryInputSchema = z.object({
    type: infoEntryTypeSchema,
    title: z.string().trim().min(2).max(120),
    content: z.string().trim().min(1).max(1000),
    synonyms: z.array(z.string().trim().min(2).max(60)).max(10).default([]),
    active: z.boolean().default(true),
}).refine((e) => e.type === "service" || e.synonyms.length === 0,
    { path: ["synonyms"], message: "Only services have synonyms" });

export const MAX_INFO_ENTRIES = 200;

export const infoSheetFileSchema = z.object({
    version: z.literal(1),
    business: z.object({
        name: z.string().max(120).optional(),
        toneGuide: z.string().max(600).optional(),
        signature: z.string().max(80).optional(),
        timezone: z.string().optional(),
        defaultCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
        supportedLanguages: z.array(z.string().min(2).max(8)).min(1).max(5).optional(),
    }).optional(),
    entries: z.array(infoEntryInputSchema).max(MAX_INFO_ENTRIES),
});

/** One entry as the draft prompt and the settings preview show it. Phase 18/19 reuse this. */
export const formatInfoEntry = (e: { type: string; title: string; content: string }) =>
    `[${e.type}] ${e.title}: ${e.content}`;
```

**Unique service names.** Two services called "Python course" would make extraction's `service`
ambiguous. `create`/`update`/`import` reject a service title or synonym that matches (case-insensitive,
trimmed) another active service's title or synonym in the same business.

**No version counter.** The archived plan bumped `infoSheetVersion` on every write. The data model
instead records, on each `AiResult`, the **ids** of the entries the draft received (`infoEntryIds`,
Phase 21). With each entry's `updatedAt`, the inbox can say "an entry this draft used was edited after
it was written" (Phase 23). That's more precise than a counter, and one less write per edit.

**Timezone and country.** `timezone` must be in `Intl.supportedValuesOf("timeZone")`, checked in the
Zod refine. A typo like `Asia/Kolkatta` would otherwise silently resolve "this Saturday" in UTC
(Phase 17). `defaultCountry` is an ISO 3166 alpha-2 code for phone normalisation.
`supportedLanguages` lists the reply languages the owner accepts (`["en", "hi-Latn"]`). The draft
falls back to English for anything else (spec §5.3).

**Cache.** The pipeline reads a business's active entries for every message. `getActiveEntries(orgId)`
is `cache.getOrSet("cache:info:<orgId>", 300, …)`, and every write calls `cache.del` on that key after
it commits. This is the "per-entity key" style from the e-commerce cache rules: the entries of one
business can be enumerated, so editing CodeNest's prices mustn't flush every other business's sheet
(a versioned `info` namespace bump would).

**Import.** `POST …/info-entries/import { file, mode: "append" | "replace", dryRun = true }`:
1. Validate the whole file with `infoSheetFileSchema`, collecting **all** errors with paths
   (`entries[4].content: Too long`), not just the first.
2. Run the duplicate-service check against the existing sheet (append) or the file alone (replace).
3. `dryRun` → return `{ valid, errors, wouldCreate, wouldDelete, profileChanges }`.
4. Otherwise one `withTransaction`: `replace` → `deleteMany` then `createMany`; `append` →
   `createMany` with positions after the current maximum; apply `business` profile fields; audit
   `info_sheet.imported` with counts only.

Export is the same file shape (`version: 1`), so a business can be copied between environments, and
the fixture *is* an export.

## 6. Steps

1. **Schema.** Add to `Org` (exactly as in `data-model.md`): `toneGuide`, `signature`, `timezone`,
   `defaultCountry`, `supportedLanguages`. Add `enum InfoEntryType` and `model InfoEntry`, plus
   `infoEntries InfoEntry[]` on `Org`. Migrate: `--name info_sheet`. Add `"InfoEntry"` to
   `TENANT_MODELS`.
2. **Profile.** `updateOrgSchema` gains the five fields (validated as above).
   `toOrgDto` returns `profile: { toneGuide, signature, timezone, defaultCountry, supportedLanguages }`.
   `PATCH /orgs/:orgId` stays behind `org.update`; tone and signature changes are `info.manage`
   semantically, but both are admin+, so one permission is enough. Note that in the permission table
   comment.
3. **Service** (`infoSheet.service.ts`). All functions run inside the request's tenant scope, so
   `prisma.infoEntry.*` is scoped automatically:
   ```ts
   export const listEntries = () =>
       prisma.infoEntry.findMany({ orderBy: [{ type: "asc" }, { position: "asc" }, { id: "asc" }] });

   export const createEntry = async (orgId: string, input: InfoEntryInput, actorId: string) => {
       appAssert(await prisma.infoEntry.count() < MAX_INFO_ENTRIES, CONFLICT, "The info sheet is full (200 entries)");
       await assertServiceNamesFree(input);
       const position = (await prisma.infoEntry.aggregate({ where: { type: input.type }, _max: { position: true } }))._max.position ?? -1;
       const entry = await prisma.infoEntry.create({ data: { ...input, orgId, position: position + 1 } });
       await recordAudit({ orgId, actor: { type: "user", id: actorId }, action: "info_entry.created",
           target: { type: "info_entry", id: entry.id }, diff: { type: entry.type, title: entry.title } });
       await cache.del(infoCacheKey(orgId));
       return entry;
   };

   /** Reorder within one type: the client sends that type's ids in their new order. */
   export const reorder = async (orgId: string, type: InfoEntryType, ids: string[]) => {
       const current = await prisma.infoEntry.findMany({ where: { type }, select: { id: true } });
       appAssert(sameSet(current.map((e) => e.id), ids), BAD_REQUEST, "Send every entry of this type exactly once");
       await withTransaction((tx) => Promise.all(ids.map((id, position) =>
           tx.infoEntry.update({ where: { id }, data: { position } }))));
       await cache.del(infoCacheKey(orgId));
   };

   export const getActiveEntries = (orgId: string) =>
       cache.getOrSet(infoCacheKey(orgId), 300, () =>
           prisma.infoEntry.findMany({ where: { active: true }, orderBy: [{ type: "asc" }, { position: "asc" }] }));
   ```
   `update` and `delete` use `updateMany`/`deleteMany` with `{ id }` and assert `count === 1` → 404,
   the PaperTrail idiom that turns "someone else's id" into "not found".
4. **Routes** (`/orgs/:orgId/info-entries`, `Router({ mergeParams: true })`):
   `GET /` (`messages.read`: reviewers can see the facts the AI used), `POST /`, `PATCH /:id`,
   `DELETE /:id`, `PUT /order { type, ids }`, `POST /import`, `GET /export` (all `info.manage` except
   the list). Resolve Phase 10's `// Phase 12:` mount comment. Append them to `test/tenancy.routes.ts`.
5. **Fixture** `apps/api/evals/fixtures/codenest.json` (shape `{ org: {...profile}, infoEntries: [...] }`;
   the **one** demo fixture: this seed, the `try-pipeline` CLI (Phases 16–19) and the evals (Phase 29)
   all read it): "CodeNest coaching centre",
   Bengaluru, `Asia/Kolkata`, `IN`, languages `["en", "hi-Latn"]`, tone *"Warm, short and
   professional. Use the customer's first name. No emojis."*, signature "Team CodeNest". About 24
   entries, all fictional:
   - **services (6)**: Python crash course (6 weekends; synonyms "python course", "py batch"), Web
     development bootcamp (12 weeks), DSA for placements, Java fundamentals, Kids' Scratch coding
     (ages 8–12), 1:1 mentoring;
   - **prices (6)**: one per service, e.g. "Python crash course: ₹4,999 for the full course; EMI ₹1,750 × 3";
   - **timings (3)**: weekday batches (Mon–Fri 7–9 pm), weekend batches (Sat–Sun 10 am–1 pm), office
     hours (Mon–Sat 10 am–7 pm, closed Sunday);
   - **address (1)**: a made-up address with a landmark and a made-up phone in the 555 range;
   - **policies (4)**: refunds (full refund before the 2nd class, none after), rescheduling (one free
     batch change), a free demo class, payment modes (UPI, card, bank transfer; no cash);
   - **FAQs (4)**: laptop needed?, certificate?, online option?, placement guarantee? (answer: no
     guarantee, placement *support*).

   Make it realistic but leave real gaps on purpose (no parking info, no weekday kids' batch). Phase 29
   writes messages that ask about those gaps, to test "the team will confirm".
6. **Seed script** `seed-demo-business.ts --owner <email> [--name "CodeNest (demo)"]`: find the user,
   `createOrg`, then run the import with `mode: "replace", dryRun: false` inside `runWithRequestContext`
   for the new org, and set `isDemo: true` (a demo org never sends real email, Phase 25). Idempotent: if
   the owner already has a business with that name, replace its sheet. Close Prisma, the queue
   connection and the cache client in a `finally`. A CLI that imports a service inherits its
   connections and otherwise hangs after printing (seen in the Playbook build). Every later script
   (`seed-messages`, `try-pipeline`, `evals/*.ts`) does the same.
   Add `"db:seed-demo": "tsx src/scripts/seed-demo-business.ts"` to `apps/api/package.json`.
7. **Web.**
   - `/settings/business`: the profile form; the timezone select lists `Intl.supportedValuesOf("timeZone")`
     with the browser's own as the default; languages are checkboxes (`en`, `hi-Latn`, `hi`, `ta`, `te`, `kn`).
   - `/settings/info-sheet`: entries grouped by type (tabs), drag-to-reorder within a group (calls
     `PUT /order`), an `EntrySheet` editor (the content textarea shows a live character count against
     1,000), an active toggle, Import (file picker → dry-run report → confirm) and Export (download).
   - `AiPreview`: the active entries rendered with `formatInfoEntry`, in order, under the heading
     "What the assistant can say". It's the same function the draft prompt uses (Phase 19), so the
     owner sees exactly what the AI sees.
   - Viewers and reviewers get the page read-only (buttons hidden with `can()`; the API still returns
     403 if someone tries).

## 7. Verify

```bash
pnpm --filter api db:migrate:dev --name info_sheet
pnpm --filter api db:seed-demo -- --owner owner@example.com
# Created business "CodeNest (demo)" with 24 info entries

curl -s -b a.txt localhost:5000/orgs/$ORG/info-entries | jq '.data | length'           # 24
curl -s -b a.txt localhost:5000/orgs/$ORG/info-entries/export | jq '.data.version'     # 1

# a bad import, dry run
curl -s -b a.txt -XPOST localhost:5000/orgs/$ORG/info-entries/import -H 'content-type: application/json' \
  -d '{"mode":"append","file":{"version":1,"entries":[{"type":"service","title":"Python course","content":"dup"}]}}' | jq .data
# {"valid":false,"errors":[{"path":"entries[0].title","message":"Another service is already called \"Python course\""}],…}
```

- `PATCH /orgs/$ORG` with `{"timezone":"Asia/Kolkatta"}` → 400 on `timezone`.
- A 1,001-character `content` → 400 with the path.
- `synonyms` on a `policy` → 400 "Only services have synonyms".
- As a reviewer: `GET /info-entries` → 200; `POST` → 403.
- Cache: `redis-cli -p 6380 exists cache:info:$ORG` is 1 after a pipeline-style read
  (`getActiveEntries` from a tsx one-liner), 0 right after any edit.
- `PUT /order` with one id missing → 400; a full list → positions updated, `GET` returns the new order.
- `replace` import that fails validation halfway → nothing changed (it's all-or-nothing).
- Web: edit a price → the preview updates; export → import the file into a second business → same 24
  entries.

## 8. Definition of done

- [ ] `info_sheet` migrated; `InfoEntry` in `TENANT_MODELS`; profile columns on `Org`.
- [ ] CRUD, reorder, import (dry-run default, all errors listed, atomic) and export.
- [ ] Service titles and synonyms unique per business; content ≤ 1,000; ≤ 200 entries; timezone validated.
- [ ] `getActiveEntries` cached per business and invalidated on every write.
- [ ] The CodeNest fixture committed and seedable in one command.
- [ ] Web: business profile, info-sheet editor, import/export, the AI preview.
- [ ] Commit: `feat: business profile and info sheet`.

## 9. Interview angle

*"How does the AI know your prices, and how do you stop it inventing others?"* The owner keeps an info
sheet of small typed entries: services, prices, timings, policies, FAQs. The draft gets only the entries
relevant to the message, and we store which ones. Then code pulls every number out of the draft and
checks it against those exact entries and the customer's own message. Because the facts are separate
entries rather than one blob, the same data drives three things: service matching in extraction,
choosing what the draft sees, and the invented-number check.
