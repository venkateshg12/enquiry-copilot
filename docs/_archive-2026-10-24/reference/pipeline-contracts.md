# Pipeline contracts

The exact inputs and outputs of each AI step, fixed before any prompt is written. They live as Zod
schemas in `@repo/types/pipeline.ts` (Phase 15–18), are used by the API, and are mirrored as
**Prompt Lab tasks** (field-rule JSON) for evaluation (Phase 28).

## 1. Classify

```ts
classifyOutput = z.object({
  category: z.enum(["booking", "price_or_info", "complaint", "follow_up", "spam", "other"]),
  confidence: z.number().min(0).max(1),          // the model's opinion: shown, logged, used only for the spam threshold
  language: z.string().min(2).max(8),             // BCP-47-ish: "en", "hi", "hi-Latn" (Hinglish), "ta", …
});
```

**Category definitions** (put them verbatim in the prompt and in `LABELLING.md`):

| Category | Means | Tie-break |
| --- | --- | --- |
| `booking` | wants an appointment, slot, trial or enrolment | asks a price **and** wants to book → `booking` |
| `price_or_info` | asks about price, timings, services, location, policy | |
| `complaint` | unhappy about something that happened | complaint + booking request → `complaint` (a person must see it) |
| `follow_up` | refers to an earlier conversation ("any update?", "I sent the form yesterday") | |
| `spam` | marketing, SEO offers, scams, gibberish, link-only | |
| `other` | none of the above (job applications, partnerships, thanks) | |

**Spam stops the pipeline** only when `category === "spam"` **and** `confidence ≥ 0.8`. Otherwise the
message continues and the inbox shows "possible spam". A real customer marked spam is worse than a
spam draft.

## 2. Extract

```ts
extractOutput = z.object({
  customer_name: z.string().max(120).nullable(),
  phone: z.string().max(32).nullable(),            // as written; normalised to E.164 in code
  email: z.string().email().nullable(),
  service: z.string().nullable(),                  // MUST be an info-sheet service title (validated in code), else null
  preferred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),   // resolved with receivedAt + business timezone
  preferred_time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),        // 24h
  urgency: z.enum(["low", "normal", "high"]),
  question_summary: z.string().max(200),
});
```

Code after the model:
- `service` not in the info sheet's service titles (case-insensitive, after synonyms) → `null`,
  plus `issue: unknown_service`;
- `preferred_date` in the past relative to `receivedAt` → kept, plus `issue: date_in_past`;
- phone normalised (default country from the business);
- an email or phone that doesn't appear in the message or the sender metadata → set to `null`, plus
  `issue: contact_not_in_message`. This is a hallucination guard for contacts.

## 3. Draft

Inputs to the prompt:
- business name, tone guide, signature;
- the extracted details;
- the **selected info-sheet entries** (Phase 17);
- the customer message (delimited);
- the received date;
- the supported languages.

Output: plain text (not JSON). `generateText`, `maxTokens` ≈ 300.

Rules in the prompt (also checked in code where possible, see `safety-checks.md`):
- only info-sheet facts; if missing, "our team will confirm shortly";
- never confirm a booking: "we've received your request; the team will confirm the slot";
- under ~90 words, friendly, signed with the business name;
- complaints: apologise, don't argue, no refunds or compensation promises, a person will follow up;
- the customer's language if supported by the business, else English.

## 4. Label format (one JSONL line per test message)

```json
{"id":"msg_017","split":"dev","tags":["hinglish","multi_question"],
 "channel":"form","received_at":"2026-10-24T10:15:00+05:30",
 "from":{"name":"Ravi","contact":"ravi@example.com"},
 "body":"bhai python weekend batch ka fee kitna hai? sat 5 baje aa sakta hu?",
 "expected":{
   "classify":{"category":"booking","language":"hi-Latn"},
   "extract":{"customer_name":"Ravi","phone":null,"email":"ravi@example.com","service":"Python crash course",
              "preferred_date":"2026-10-25","preferred_time":"17:00","urgency":"normal",
              "question_summary":"Weekend Python batch fee; wants Saturday 5 pm"},
   "draft":{"must_include":["fee from info sheet","request received, team will confirm"],
            "must_avoid":["confirmed","any price not in the info sheet"]}}}
```

`confidence` isn't labelled (it's an opinion). `question_summary` isn't scored exactly. Prompt Lab
scores it as `text` only if you choose to; by default it's excluded from accuracy and reviewed by
hand.
