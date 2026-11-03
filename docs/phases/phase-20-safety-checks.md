# Phase 20 — Safety checks (code, not AI)

## 1. Goal

Implement [../reference/safety-checks.md](../reference/safety-checks.md) as a **pure** module that runs
on every draft, before a human sees it:

- **invented numbers**: money, time, date, weekday, phone, percent and plain numbers, each traced to
  the info entries the draft was shown or to the customer's own message;
- **booking promises**: English and Hinglish, with negation handled;
- **length**;
- **sensitive data**: repeated customer contacts are masked; card numbers, UPI ids and OTP requests are
  flagged;
- **injection effects**: invented offers, unauthorised promises, instruction leaks.

Output: `{ flags: Flag[], maskedText }`. Every flag carries a code, a severity and the character
span(s) it refers to, so the inbox (Phase 23) can highlight them.

Nothing here touches the database, Redis or a model. Inputs in, flags out. That makes the module
unit-testable in milliseconds, reusable by the eval (Phase 29), and impossible to talk out of a
decision.

## 2. What I will understand after this phase

1. Why fact checks belong in code: deterministic, explainable, testable, and immune to prompt injection.
2. How typed recognisers normalise `₹2,500`, `Rs 2500`, `2.5k` and `2500 rupees` to one value, so the
   draft and the info sheet can be compared at all.
3. Why the **allowed set** is built with the *same* recognisers as the draft.
4. How negation-aware phrase patterns keep "we will confirm" from looking like "confirmed".
5. The trade-off between false negatives (an invented price reaches a customer) and false positives
   (staff learn to click past the banner), and how each is measured.

## 3. Prerequisites

- Phase 19 done: `draftReply()` returns `{ text, infoEntryIds }`.
- Phase 17 done: `src/pipeline/localTime.ts` exports `localTime(at, tz)` and `weekdayOf(isoDate)`.
  This phase adds `resolveRelativeDate(word, receivedAt, tz)` to the same file, so "this Saturday"
  means one thing everywhere dates are compared.
- Phase 18 done: `renderEntry(entry)` (in `renderInfo.ts`) returns the exact text the draft prompt
  received for an info entry. The checks scan that same text.

## 4. Files

```
packages/types/src/checks.ts                         NEW    (Flag, Severity, FlagCode, ChecksResult schemas)
apps/api/src/
├── pipeline/localTime.ts                             ADAPT  (Phase 17's file: + resolveRelativeDate(word, receivedAt, tz))
├── pipeline/checks/
│   ├── mentions.ts                                  NEW    (Mention type, overlap resolution)
│   ├── recognisers.ts                               NEW    (money, time, date, weekday, phone, percent, number)
│   ├── allowed.ts                                   NEW    (allowed set from shown entries + message + extracted)
│   ├── numbers.ts                                   NEW    (invented_number)
│   ├── phrases.ts                                   NEW    (booking_promise, unauthorised_promise, invented_offer, instruction_leak)
│   ├── length.ts                                    NEW    (too_long)
│   ├── sensitive.ts                                 NEW    (masked_contact, sensitive_data)
│   ├── injection.ts                                 NEW    (composes the injection-effect checks)
│   ├── index.ts                                     NEW    (runChecks → { flags, maskedText })
│   └── __tests__/
│       ├── recognisers.test.ts                      NEW
│       ├── phrases.test.ts                          NEW
│       ├── sensitive.test.ts                        NEW
│       ├── runChecks.test.ts                        NEW
│       └── fixtures/{planted,clean}.ts              NEW    (≥ 25 planted, ≥ 20 clean drafts)
├── utils/pii.ts                                     (exists: Phase 02 — maskPhone, maskEmail used by the sensitive-data check)
└── scripts/try-pipeline.ts                          ADAPT  (Phase 19's CLI also prints the flags)
```

`@pt-api/src/utils/pii.ts` masks bank account numbers and deep-redacts trace objects. Keep both
functions unchanged and add two maskers next to them. That's why the tag is ADAPT, not COPY.

## 5. Concepts

### 5.1 Mentions, normalised

Every recogniser returns `Mention { kind, value, start, end, text }`:

| Text | Mention |
| --- | --- |
| `₹4,999` · `Rs. 4999` · `4999 rupees` · `INR 4,999` | `{ kind: "money", value: 4999, currency: "INR" }` |
| `4.9k` · `5k/month` | money 4900 / 5000, only when a currency word or `₹`/`Rs` is within 3 tokens, or the phrase is `fee`/`price`/`cost` + number + `k` |
| `3 LPA` · `3.5 lakh` | money 300000 / 350000 INR |
| `$40` | `{ kind: "money", value: 40, currency: "USD" }` |
| `5 pm` · `5:00 PM` · `17:00` · `5 baje` · `shaam 5` | `{ kind: "time", value: "17:00" }` |
| `25 Oct` · `25/10/2026` · `25th October` · `tomorrow` · `this Saturday` | `{ kind: "date", value: "2026-10-25" }` (relative words resolved against `receivedAt` in the business timezone) |
| `Saturday` · `Sat` · `shanivaar` | `{ kind: "weekday", value: 6 }` |
| `+91 98765 43210` · `98765-43210` | `{ kind: "phone", value: "9876543210" }` (last 10 digits) |
| `20%` · `20 percent` | `{ kind: "percent", value: 20 }` |
| `6 weeks` · `2 sessions` | `{ kind: "number", value: 6 }` |

**`baje` without a period word** is ambiguous. The documented rule: 1–7 → pm, 8–11 → am, 12 → noon.
`subah` forces am; `shaam` and `raat` force pm. Write the rule in a comment and a test. It's a
convention, so it must be visible.

**Overlaps resolve longest-first.** `17:00` is one time, not two numbers. `₹2,500` is one money
mention, not money plus the number 500. Ranges produce two mentions: `5–6 pm` is two times (17:00 and
18:00), and `₹2,500 – ₹3,000` is two amounts. `Mon–Fri` expands to five weekdays sharing one span.

### 5.2 The allowed set

The allowed set is built with **the same recognisers**, run over:

1. the rendered text of the info entries **the draft was shown** (`infoEntryIds` from Phase 19, not
   the whole sheet). A fact the model wasn't given can't be one it "knew";
2. the customer message and subject;
3. the extracted fields: `preferred_date`, `preferred_time`, the weekday of `preferred_date`, and the
   customer's phone;
4. the received date and its weekday.

Using one set of recognisers for both sides is the whole trick. "₹4,999" in the sheet and "Rs 4999"
in the draft normalise to the same mention and match.

### 5.3 Matching rules and severity

| Kind | Match | Severity if unmatched |
| --- | --- | --- |
| money | same currency, value within ±0.5 % | strong |
| time | exact | strong |
| date | exact | strong |
| weekday | exact, or the weekday of any allowed date | strong |
| phone | last 10 digits | strong |
| percent | exact | strong |
| number | exact, or one of `{1, 2}` used as a count ("1 session", "2 options") | warning |

Exemptions: ordinal list markers (`1.` at line start), the business's own signature (an info entry
anyway), and numbers inside a quoted repetition of the customer's text (`"…"` that matches a substring
of the message).

### 5.4 Phrases, negation-aware

`booking_promise` must match "your slot is confirmed", "booked for you", "see you on Saturday at 5",
"reserved for you" and "confirm ho gaya". It must **not** match "we will confirm your slot", "not
confirmed yet", "to confirm your booking our team will call" or "confirm karenge".

A small negative-lookbehind regex isn't enough. Phrases are short sentence-level patterns, and each
pattern has a list of **blockers**: future or negating words in the same clause (`will`, `shall`,
`going to`, `not`, `yet`, `karenge`, `karege`, `hoga`). A clause is the text between `.`, `!`, `?`,
`,`, `;` and line breaks. Every pattern ships with at least two positive and two negative cases in
`phrases.test.ts`.

| Code | Triggers |
| --- | --- |
| `booking_promise` | confirmation language without a blocker |
| `unauthorised_promise` | `refund`, `compensation`, `free session`, `money back`, `we guarantee`, `paisa wapas` |
| `invented_offer` | `discount`, `% off`, `offer`, `free`, a percent mention, unless the same word or percent appears in the shown entries |
| `instruction_leak` | `system prompt`, `as an AI`, `language model`, `my instructions`, `<customer_message>` |

### 5.5 Sensitive data

- **Repeated contacts.** If the draft repeats the customer's full phone or email, replace it in
  `maskedText` (`+91 98xxxx3210`, `r***@example.com`) and flag `masked_contact` (info). The reviewer
  sees the masked text, and so does the customer.
- **Payment data.** A Luhn-valid run of 13–19 digits (spaces or dashes allowed), a UPI id
  (`name@okaxis`, `@ybl`, `@paytm`, `@upi`), or a request to share an OTP, PIN, CVV or password → flag
  `sensitive_data` (strong). Phase 24 refuses to approve such a draft without an edit.

### 5.6 Measuring the checks themselves

- **Recall** on planted drafts: every planted invention flagged. Target **100 %**, because a missed
  invented price is the one failure the spec forbids.
- **False alarms** on clean drafts you judged fine: report the count and the codes. If one code fires
  on most clean drafts, staff will learn to ignore it, so fix that recogniser rather than the threshold.

Phase 29 measures both on the labelled set (`checks_recall`, `checks_false_positive_rate` in
`pipeline-contracts.md` §5). This phase measures them on the fixtures.

## 6. Steps

### 6.1 Types (`packages/types/src/checks.ts`)

```ts
import { z } from "zod";

export const severitySchema = z.enum(["strong", "warning", "info"]);
export const flagCodeSchema = z.enum([
  "invented_number", "booking_promise", "too_long", "masked_contact", "sensitive_data",
  "invented_offer", "unauthorised_promise", "instruction_leak",
]);
export const spanSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) });

export const flagSchema = z.object({
  code: flagCodeSchema,
  severity: severitySchema,
  spans: z.array(spanSchema),          // offsets into maskedText
  detail: z.string().max(200),         // "₹3,500 isn't in the info entries shown to the AI"
  kind: z.string().optional(),         // for invented_number: money | time | …
});

export const checksResultSchema = z.object({
  flags: z.array(flagSchema),
  maskedText: z.string(),
});
export type Flag = z.infer<typeof flagSchema>;
export type ChecksResult = z.infer<typeof checksResultSchema>;
```

Spans refer to **`maskedText`**: masking runs first, so the highlighted offsets match what the reviewer
sees.

### 6.2 Recognisers

One function per kind, each `(text, ctx) => Mention[]`, then `resolveOverlaps(mentions)` keeps the
longest mention at each position. Money, as an example:

```ts
const MONEY = /(?:(₹|rs\.?|inr)\s*)?(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(k|lakh|lac|lpa)?\s*(rupees|rs|inr)?/gi;

export const money = (text: string): Mention[] => {
  const out: Mention[] = [];
  for (const m of text.matchAll(MONEY)) {
    const [whole, pre, digits, scale, post] = m;
    const hasCurrency = Boolean(pre || post || /lpa|lakh|lac/i.test(scale ?? ""));
    if (!hasCurrency && !(scale?.toLowerCase() === "k" && PRICE_CONTEXT.test(text.slice(Math.max(0, m.index! - 24), m.index!)))) continue;
    let value = Number(digits.replace(/,/g, ""));
    if (/^k$/i.test(scale ?? "")) value *= 1_000;
    if (/lakh|lac|lpa/i.test(scale ?? "")) value *= 100_000;
    out.push({ kind: "money", value, currency: "INR", start: m.index!, end: m.index! + whole.trimEnd().length, text: whole.trim() });
  }
  return out;
};
```

Write the others the same way: `time` (12 h, 24 h, `baje` with period words), `date` (day-month,
numeric, and relative words through `resolveRelativeDate`), `weekday` (English, short forms, Hindi
names), `phone`, `percent`, and `number` last, over whatever the others didn't claim.

### 6.3 Allowed set, numbers, phrases, length, sensitive

```ts
export type CheckInput = {
  draft: string;
  shownEntries: { id: string; text: string }[];   // renderEntry() output for infoEntryIds
  message: { body: string; subject?: string | null; receivedAt: Date };
  extracted: { preferred_date: string | null; preferred_time: string | null; phone: string | null; email: string | null };
  timezone: string;
  wordLimit?: number;                               // default 90
};
```

- `buildAllowed(input) → Mention[]`;
- `inventedNumbers(draftMentions, allowed) → Flag[]` (one flag per mention, `detail` names the kind and
  the text);
- `phraseFlags(maskedText, shownEntriesText) → Flag[]`;
- `lengthFlag(maskedText)`: over the limit → warning, over 150 words → strong `too_long`. Count words
  with `text.trim().split(/\s+/)`;
- `sensitiveFlags(draft, extracted) → { maskedText, flags }`.

### 6.4 `runChecks`

```ts
export const runChecks = (input: CheckInput): ChecksResult => {
  const { maskedText, flags: sensitive } = sensitiveFlags(input.draft, input.extracted);
  const ctx = { receivedAt: input.message.receivedAt, timezone: input.timezone };
  const allowed = buildAllowed(input);
  const mentions = recogniseAll(maskedText, ctx);
  const flags = [
    ...sensitive,
    ...inventedNumbers(mentions, allowed),
    ...phraseFlags(maskedText, input.shownEntries.map((e) => e.text).join("\n")),
    ...lengthFlag(maskedText, input.wordLimit ?? 90),
  ];
  return checksResultSchema.parse({ flags: sortBySeverity(flags), maskedText });
};

export const strongFlagCount = (r: ChecksResult) => r.flags.filter((f) => f.severity === "strong").length;
```

`strongFlagCount` feeds `Message.strongFlags` in Phase 21.

### 6.5 Tests: table-driven, with planted drafts

```ts
const planted: [name: string, draft: string, expected: FlagCode, kind?: string][] = [
  ["invented price", "The Python course is ₹3,500 for the weekend batch.", "invented_number", "money"],
  ["k shorthand", "Fee is 4.5k only!", "invented_number", "money"],
  ["invented time", "We open at 8 am on Sundays.", "invented_number", "time"],
  ["baje", "Aap shaam 6 baje aa jaiye.", "invented_number", "time"],
  ["confirmed", "Your slot is confirmed for Saturday 5 pm.", "booking_promise"],
  ["hinglish confirmed", "Aapka slot confirm ho gaya hai.", "booking_promise"],
  ["discount", "Good news, we can give you 20% off.", "invented_offer"],
  ["refund", "Sorry about that, we'll refund you in full.", "unauthorised_promise"],
  ["card", "Please send 4111 1111 1111 1111 to pay.", "sensitive_data"],
  ["otp", "Kindly share the OTP you received.", "sensitive_data"],
  ["leak", "As an AI language model, I can't say.", "instruction_leak"],
  // … ≥ 25 in fixtures/planted.ts, each with its info sheet + message
];

it.each(planted)("flags %s", (_, draft, code, kind) => {
  const r = runChecks({ ...baseInput, draft });
  expect(r.flags.some((f) => f.code === code && (!kind || f.kind === kind))).toBe(true);
});
```

Plus negative cases: "we will confirm your slot" has no `booking_promise`; "Rs 4999" against an
info entry with `₹4,999` has no `invented_number`; "this Saturday" when the customer asked for that
Saturday has no flag. And `clean.ts`, a set of drafts you judged fine, for which the test prints the
false-alarm count without failing on it.

## 7. Verify

```bash
pnpm --filter api exec vitest run src/pipeline/checks
```

Expected: all recogniser, phrase and sensitive tests pass, plus the summary the suite prints:

```
planted: 27/27 flagged (100%)
clean:   2 false alarms in 21 drafts (invented_number:number ×2)
```

```bash
pnpm --filter api try-pipeline -- --message "python weekend batch fee? sat 5 baje?" --fake-draft "Fee is ₹3,500. Your slot is confirmed."
```

Expected: two strong flags (`invented_number` money on `₹3,500`, `booking_promise` on the second
sentence), with spans printed under the text.

Write the planted and clean numbers in `tasks/lessons.md` now. They go into the README after Phase 29.

## 8. Definition of done

- [ ] Every rule in `safety-checks.md` implemented as pure functions, no I/O.
- [ ] One recogniser set used for the draft and the allowed set.
- [ ] Phrase patterns negation-aware, each with ≥ 2 positive and ≥ 2 negative tests.
- [ ] `maskedText` produced, spans refer to it.
- [ ] Planted drafts 100 % flagged; clean-draft false alarms measured and written down.
- [ ] The sensitive-data check masks through Phase 02's `maskPhone`/`maskEmail` (no second masking implementation).
- [ ] Commit: `feat(api): code safety checks on drafts`.

## 9. Interview angle

*"How do you guarantee the AI never invents a price?"* I don't trust the prompt for that. Every price,
time, date, phone number and percentage in a draft is pulled out with typed recognisers and must match
a fact the model was actually shown, or the customer's own words. The same recognisers run over both
sides, so `₹4,999` and `Rs 4999` match. Anything unmatched is highlighted, and approving it takes a
written reason. I measure the checks themselves: 100 % recall on planted inventions, and a reported
false-alarm rate, because a banner that cries wolf trains people to ignore it.
