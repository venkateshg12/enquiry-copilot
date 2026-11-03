# Phase 11 — Business profile and the info sheet

## 1. Goal

The source of truth for every fact the assistant may say:
- **Business profile**: name, tone guide, signature, timezone, supported reply languages, default
  phone country, reply address (set by the Gmail connection, Phase 23), retention days (Phase 26).
- **Info sheet**: typed entries (`service`, `price`, `timing`, `policy`, `faq`, `address`, `contact`),
  each with a title, content and optional structured fields (a service's price and duration, a
  timing's days and hours). Each change increments the business's `infoSheetVersion`.
- An **onboarding flow** and a **settings page** with an info-sheet editor and a live "what the AI will
  see" preview.
- **Import/export** as JSON, so the weekend version's sample `business.json` loads in one step and a
  demo business can be seeded.

## 2. What I will understand after this phase

1. Why facts are structured entries, not one free-text blob.
2. Why the info sheet is versioned, and the version stamped on every draft.
3. How structured price/timing fields feed the safety checks (Phase 19).

## 3. Prerequisites

Phase 10 done.

## 4. Files

```
packages/types/src/{business,infoSheet}.ts      NEW
apps/api/src/
├── models/org.model.ts                         ADAPT  (+ profile fields; re-tag in the copy map)
├── models/infoEntry.model.ts                   NEW
├── services/{business,infoSheet}.service.ts    NEW
├── controllers/… · routes/business.route.ts    NEW    (/business/profile, /business/info-entries, /business/info-sheet/import|export)
└── scripts/seed-demo-business.ts               NEW    (cases/demo-business/business.json)
apps/web/src/app/(app)/settings/{profile,info-sheet}/page.tsx · components/infoSheet/*   NEW
cases/demo-business/business.json               NEW    (a realistic coding coaching centre)
```

## 5. Concepts

**Structured entries, so code can check facts.** A blob like "Python course ₹4,999, Sat–Sun 10–1" can
be pasted into a prompt, but the safety checks can't know which numbers are legitimate. Typed entries
carry the facts in a form code can read:

```ts
infoEntrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("service"), title: z.string().max(120), content: z.string().max(2000),
             price: z.object({ amount: z.number().nonnegative(), currency: z.string().length(3), per: z.enum(["one_time","month","session","hour","course"]) }).optional(),
             durationText: z.string().max(80).optional(), synonyms: z.array(z.string().max(60)).max(10).default([]) }),
  z.object({ type: z.literal("timing"), title: z.string().max(120), content: z.string().max(1000),
             slots: z.array(z.object({ days: z.array(z.number().int().min(1).max(7)).min(1), open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })).max(14).default([]) }),
  z.object({ type: z.literal("price"), title: z.string().max(120), content: z.string().max(1000) }),
  z.object({ type: z.enum(["policy", "faq", "address", "contact"]), title: z.string().max(120), content: z.string().max(2000) }),
]);
```

Free-text `content` is still allowed (and sent to the model), and the safety checks read numbers from
it too (Phase 19). Structured fields are what make extraction's `service` check ("must match an
info-sheet service") and booking-time checks ("is 5 pm Saturday inside opening hours?") possible.

**Versioned.** `org.infoSheetVersion` increments on every entry create/update/delete (in the same
`withTransaction` as the write). Drafts record the version they used, the info-sheet cache key
includes it (Phase 07), and the inbox can say "this draft was written with an older info sheet"
(Phase 21).

**Tone guide**, a few lines the owner writes: *"Warm, short, professional. Use the customer's first
name. No emojis. Sign off: Team Sunrise."* Plus 1–3 **sample replies** the owner likes: few-shot
material for the draft prompt (Phase 18). Approved edits later add more (Phase 22).

**Preview.** The settings page shows the exact info-sheet text block the draft prompt receives
(Phase 17's renderer), so the owner sees what the AI sees.

## 6. Steps

1. Profile fields on the org model (PaperTrail's `settings` sub-document is the natural place):
   `toneGuide`, `sampleReplies[≤3]`, `signature`, `timezone` (validated against `Intl.supportedValuesOf("timeZone")`),
   `languages` (default `["en"]`), `defaultPhoneCountry` (`IN`), `retentionDays` (365), `infoSheetVersion`,
   `formKey` (Phase 12), `demo` (Phase 29).
2. `InfoEntry` model (+ tenant plugin; index `{ orgId, type, title }`) and CRUD under
   `/business/info-entries` with `business.update`. Every write runs
   `$inc: { "settings.infoSheetVersion": 1 }` inside the same transaction, then bumps the
   `infoSheet` cache.
3. `GET /business/info-sheet/export` and `POST /business/info-sheet/import` (`{ entries, replace: boolean }`,
   validated entry by entry, dry-run first as in Prompt Lab's importer).
4. `cases/demo-business/business.json`: "Sunrise Coding Academy" (Bengaluru, `Asia/Kolkata`), with
   6 services (with prices), weekday + weekend timings, address, 4 policies (refunds, rescheduling,
   demo class, payment modes) and 8 FAQs. `seed-demo-business.ts --owner <email>` creates the business
   and imports it. Realistic but fictional.
5. Web:
   - onboarding (name → timezone → tone → first services) after the first login;
   - `/settings/profile`;
   - `/settings/info-sheet`: entries grouped by type, an editor sheet per type with structured
     fields, import/export, and the preview panel.

## 7. Verify

- Seed the demo business → 20 entries; `infoSheetVersion` 1.
- Edit a price → version 2; the cache key changes.
- An import with a bad timing (`25:00`) → dry run lists it.
- Staff role → the info-sheet editor is read-only (403 on save).

## 8. Definition of done

- [ ] Profile + typed info entries + versioning + import/export + the preview.
- [ ] Demo business seeded from git.
- [ ] Commit: `feat: business profile and info sheet`.

## 9. Interview angle

*"How does the AI know your prices?"* From a typed info sheet the owner maintains. The same structured
facts let code verify every number in a draft. It's versioned, and each draft records the version it
was written with.
