# Phase 16 — Extract

## 1. Goal

Message → structured details
([../reference/pipeline-contracts.md](../reference/pipeline-contracts.md) §2):
- name, phone, email, service, preferred date and time, urgency, question summary;
- `null` when not stated, never guessed;
- relative dates resolved with the message's **received time in the business timezone**;
- `service` constrained to the info sheet's services;
- then **code checks**:
  - the service must exist (else `null`);
  - contacts must appear in the message (else `null`);
  - the phone is normalised;
  - dates in the past and times outside opening hours are flagged.

## 2. What I will understand after this phase

1. Why the model gets the received date and the service list, and what each prevents.
2. Why "never guess" is enforced in code, not just requested.
3. How to resolve "this Saturday 5 pm" correctly.

## 3. Prerequisites

Phase 15 done.

## 4. Files

```
packages/types/src/pipeline.ts          ADAPT (+ extractOutputSchema, ExtractIssue)
apps/api/src/
├── ai/prompts/extract.v1.ts            NEW
├── pipeline/extract.ts                 NEW   (extractDetails: model + post-checks)
├── pipeline/postExtract.ts             NEW   (pure: serviceMatch, contactInMessage, normalisePhone, checkSlot)
└── utils/time.ts                       ADAPT (Phase 03 helpers used for dates)
cases/demo-business/prompts/extract.v1.md   NEW   (Prompt Lab mirror)
```

```bash
pnpm --filter api add libphonenumber-js
```

## 5. Concepts

**Give the model what it can't know.** The prompt includes:
- **"Message received: Friday 24 October 2026, 10:15 (Asia/Kolkata)"**, so "tomorrow" and "this
  Saturday" are resolvable;
- **the list of service titles** (with synonyms) from the info sheet, so `service` comes from a closed
  set;
- the rule: *"If a field is not stated, return null. Never guess a name from an email address. Never
  invent a phone number. Resolve relative dates using the received date; return ISO YYYY-MM-DD and
  24-hour HH:MM."*

**Enforce "never guess" in code** (`postExtract.ts`, pure):

| Check | Rule | Result |
| --- | --- | --- |
| service | case-insensitive match against titles + synonyms, ignoring punctuation | no match → `service: null`, issue `unknown_service` |
| contact grounding | the extracted email/phone (normalised) must occur in the message body or the sender metadata | not found → `null`, issue `contact_not_in_message` |
| phone | `libphonenumber-js` with the business's default country → E.164; invalid → keep raw, issue `invalid_phone` | |
| date | earlier than the received date (business tz) → issue `date_in_past` | kept |
| slot | the date + time outside every info-sheet `timing` slot for that weekday → issue `outside_hours` | kept; the draft is told (Phase 18) |
| cross-check | a weekday word in the message ("Saturday") vs the resolved date's weekday | mismatch → issue `weekday_mismatch` |

Issues are stored on the extract result and shown in the inbox ("Customer asked for Sunday 9 pm —
outside opening hours"). They're hints for staff, not blockers.

**The cross-check is cheap insurance.** Models are unreliable at date arithmetic. `weekday_mismatch`
catches "this Saturday" resolved to a Friday without trusting the model. Phase 27's test set has
relative-date cases (`tomorrow`, `this saturday`, `next monday`, `day after tomorrow`) to measure it.

**Extract runs for every non-spam category.** A complaint still carries a name and a contact. A
`booking` with a service and a date creates a booking request (Phase 24).

## 6. Steps

1. `extract.v1.ts`: the system text with the rules, the service-list placeholder, the received-at
   line, and two examples (one booking with "this Saturday 5 pm" plus its resolved date; one
   price question with nothing to extract but the service).
2. `extractDetails({ body, channel, receivedAt, business, services })` →
   `generateJson(tier: "cheap", schema: extractOutputSchema)` (one repair on a violation) →
   `postExtract(raw, ctx)` → `{ details, issues, raw }`. Store **both** the raw model output and the
   post-checked details. Phase 27 measures the model and the checks separately.
3. `postExtract.ts` functions, each unit-tested: `matchService`, `contactInMessage` (normalise digits;
   compare the last 10 for phones; lowercase emails), `normalisePhone`, `checkSlot(date, time, timings, tz)`,
   `weekdayCrossCheck(body, date)` (an English + Hinglish weekday word list).
4. The Prompt Lab mirror `.md` and a task JSON in Prompt Lab's field-rule DSL:
   - `customer_name`, `service`: `text`;
   - `urgency`: `enum`;
   - `preferred_date`, `preferred_time`, `phone`, `email`: `text` (exact after normalisation);
   - `question_summary`: excluded.

   This is the task you benchmark in Phase 28.

## 7. Verify

| Message (received Fri 24 Oct 2026 10:15 IST) | Expected |
| --- | --- |
| "Can I book the Python crash course this Saturday at 5 pm? – Ravi, 98765 43210" | service "Python crash course", date 2026-10-25, time 17:00, phone +919876543210 |
| "price of java full course?" | service matched if it exists, else null + `unknown_service`; date/time null |
| "call me on 9999999999" (sender email ravi@x.com) | phone kept (it's in the message); email from sender metadata |
| "my email is in my profile" | email null (not in the message) |
| "Sunday 9 pm slot?" with no Sunday timing | issue `outside_hours` |
| model returns 2026-10-24 for "this Saturday" | issue `weekday_mismatch` |

## 8. Definition of done

- [ ] `extract@1` with received-date and service-list context; one repair.
- [ ] Pure post-checks enforce "never guess"; issues stored and shown.
- [ ] Raw and checked outputs both stored; the Prompt Lab mirror task exists.
- [ ] Commit: `feat(pipeline): extract step with code checks`.

## 9. Interview angle

*"How do you stop the model guessing a phone number?"* The prompt says null when not stated. Code
drops any phone or email that doesn't literally appear in the message, constrains the service to the
info sheet, and cross-checks the resolved date's weekday against the words the customer used.
