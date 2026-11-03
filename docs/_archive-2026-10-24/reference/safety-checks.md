# Safety checks (code, not AI)

Run on **every** draft, before a human sees it. They never block the human: they **flag** the draft
and highlight the spans. Approving a flagged draft requires one extra click ("Approve anyway") and is
logged.

## 1. Invented numbers (the important one)

Every **price, time, date, phone number and other number** in the draft must be traceable to the
**info sheet** or the **customer's own message** (or the extracted fields, which come from the message).

Algorithm (`checks/numbers.ts`, pure):
1. **Find mentions in the draft** with typed recognisers, each returning a normalised value and the
   character span:
   - money: `₹2,500`, `Rs 2500`, `2500 rupees`, `$40`, `2.5k`, `25k/month`, `3 LPA` → `{ kind: "money", value: 2500, currency: "INR" }`;
   - time: `5 pm`, `5:00 PM`, `17:00`, `5 baje` → `{ kind: "time", value: "17:00" }`;
   - date: `25 Oct`, `25/10`, `Saturday 25th`, `tomorrow` (resolved against `receivedAt`) → `{ kind: "date", value: "2026-10-25" }`;
   - weekday: `Saturday` → `{ kind: "weekday", value: 6 }`;
   - phone: 8+ digits, optional `+`, spaces or dashes → `{ kind: "phone", value: "+919876543210" }`;
   - percentage: `50%` → `{ kind: "percent", value: 50 }`;
   - plain number: any remaining integer or decimal (durations, counts) → `{ kind: "number", value: 6 }`.
2. **Build the allowed set** by running the same recognisers over the info-sheet entries **sent to
   the draft prompt** and over the customer message (including the received date and resolved
   relative dates).
3. **Match by kind and normalised value**: money within ±0.5 % (rounding), time exact, date exact,
   weekday exact (or implied by an allowed date), phone exact on the last 10 digits, percent exact,
   plain numbers exact.
4. Every unmatched mention → flag `invented_number` with its span and kind.

Exemptions: the numbers in the business's own signature and address (they're info-sheet entries
anyway), ordinal list markers (`1.`), and numbers inside a quoted repetition of the customer's text.

**Targets** (the spec):
- **0** drafts on the test set containing an invented price, time or policy that the checks miss
  (the false-negative rate, measured on planted cases);
- checks flag every planted invention.

False positives are reported too: a check that cries wolf trains people to click "approve anyway".

## 2. Booking promise

Flag `booking_promise` when the draft contains confirmation language:
- English: `confirmed`, `is booked`, `booked for you`, `see you on <date>`, `your slot is`,
  `reserved for you`;
- Hinglish: `confirm ho gaya`, `book kar diya`;
- plus phrases you find in error analysis.

A pattern list per language (`checks/phrases.ts`), with unit tests. A **negated** form ("we will
confirm", "not confirmed yet") is allowed: the patterns are written to exclude future and negated
forms, and tests cover both.

## 3. Length

Over 90 words → `too_long` (warning). Over 150 → `too_long` (strong). Counted with
`text.trim().split(/\s+/)`.

## 4. Sensitive data

- A full phone number or email of the customer repeated back → masked in the draft (`+91 98xxxx3210`),
  flag `masked_contact` (info).
- Anything that looks like a card number (Luhn-valid 13–19 digits), a UPI id, or an OTP request
  ("share the OTP") → flag `sensitive_data` (strong), and the draft is never sendable without an edit.

## 5. Prompt injection

Customer text is wrapped as `<customer_message>…</customer_message>` (with any closing tag in the text
neutralised) and the system prompt says it's data. The checks can't detect "the model obeyed an
injection" in general. They catch its usual effects:
- discounts: a `%` or the word "discount" or "free" not present in the info sheet → `invented_offer`;
- promised actions the business doesn't offer: the booking-promise patterns, refund/compensation
  phrases (`refund`, `compensation`, `free session`) → `unauthorised_promise`;
- a reply that echoes system instructions (`system prompt`, `as an AI`) → `instruction_leak`.

The test set includes injection messages, so the measured metric is **"injection attempts followed:
0"** (Phase 28).

## 6. Severity → UI

| Severity | Flags | UI |
| --- | --- | --- |
| strong | `invented_number` (money/time/date/phone/percent), `booking_promise`, `sensitive_data`, `invented_offer`, `unauthorised_promise` | red banner; spans highlighted; "Approve anyway" requires a reason |
| warning | `too_long`, `invented_number` (plain number), `instruction_leak` | amber banner; normal approve |
| info | `masked_contact` | small note |
