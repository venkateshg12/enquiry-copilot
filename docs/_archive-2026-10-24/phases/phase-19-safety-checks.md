# Phase 19 — Safety checks

## 1. Goal

Implement [../reference/safety-checks.md](../reference/safety-checks.md) as a **pure** module run on every
draft:
- invented numbers (money, time, date, weekday, phone, percent, plain numbers), with spans;
- booking-promise phrases (English + Hinglish, negation-aware);
- length;
- sensitive data (masking repeated contacts; card / UPI / OTP);
- the effects of injection (invented offers, unauthorised promises, instruction leaks);
- id tags copied from the info block (`[S3]`).

Output: `{ flags: [{ code, severity, spans, detail }], maskedText }`. The inbox highlights the spans
(Phase 21).

## 2. What I will understand after this phase

1. Why fact checks are code: deterministic, explainable, testable, and they can't be talked out of it.
2. How typed recognisers normalise "₹2,500", "Rs 2500" and "2.5k" to one value.
3. The trade-off between false positives (alert fatigue) and false negatives (an invented price
   reaching a customer), and how both are measured.

## 3. Prerequisites

Phase 18 done.

## 4. Files

```
apps/api/src/checks/
├── recognisers.ts       NEW   (money, time, date, weekday, phone, percent, number → Mention[] with spans)
├── allowed.ts           NEW   (build the allowed set from the info entries shown + the message + extracted fields)
├── numbers.ts           NEW   (invented_number)
├── phrases.ts           NEW   (booking_promise, unauthorised_promise, invented_offer, instruction_leak)
├── sensitive.ts         NEW   (masking, card/UPI/OTP)
├── length.ts · tags.ts  NEW
├── runChecks.ts         NEW   (all of the above → flags + maskedText)
└── __tests__/*.test.ts  NEW
```

Keep it free of database and model calls: pure inputs → pure outputs. It's the same discipline as Prompt
Lab's scoring package, and for the same reason (testable, reusable by the eval).

## 5. Concepts

**Mentions, normalised.** Each recogniser returns
`{ kind, value, start, end, text }`:

| Text | Mention |
| --- | --- |
| `₹4,999`, `Rs. 4999`, `4999 rupees`, `INR 4,999` | `{ kind: "money", value: 4999, currency: "INR" }` |
| `4.9k`, `5k` | money 4900 / 5000 (only when the context has a currency word nearby, or a `k` after a number in a price context) |
| `5 pm`, `5:00 PM`, `17:00`, `5 baje`, `shaam 5` | `{ kind: "time", value: "17:00" }` (baje: assume pm 1–7, am 8–11, documented) |
| `25 Oct`, `25/10/2026`, `25th October`, `tomorrow` | `{ kind: "date", value: "2026-10-25" }` (relative words resolved against `receivedAt`, business tz) |
| `Saturday`, `Sat`, `shanivaar` | `{ kind: "weekday", value: 6 }` |
| `+91 98765 43210`, `9876543210` | `{ kind: "phone", value: "9876543210" }` (last 10 digits) |
| `20%`, `20 percent` | `{ kind: "percent", value: 20 }` |
| `6 weeks`, `2 sessions` | `{ kind: "number", value: 6 }` |

Overlaps resolve longest-first: `17:00` is a time, not two numbers.

**The allowed set** is built by running **the same recognisers** over:
1. the rendered info entries the draft received (`infoEntryIds`, Phase 17), plus the structured fields
   (a service's `price.amount`; each timing slot's open/close as times, its days as weekdays);
2. the customer message and subject;
3. the extracted fields (`preferred_date`, `preferred_time`, and the date's weekday);
4. the received date.

Running the same recognisers on both sides means "₹4,999" in the sheet and "Rs 4999" in the draft
match.

**Matching rules:**
- money: same currency, within ±0.5 %;
- time: exact;
- date: exact;
- weekday: exact, or the weekday of an allowed date;
- phone: last 10 digits;
- percent: exact;
- plain number: exact, plus a short allow-list (1, 2: "1 session", "we'll get back in 2 hours" is a
  promise, so keep plain numbers at **warning** severity).

**Negation-aware phrases.** `booking_promise` patterns match "your slot is confirmed", "booked for you",
"see you on Saturday at 5", but not "we will confirm", "not confirmed yet" or "to confirm your booking,
our team…". Write each pattern with explicit negative cases in its test. Hinglish: "confirm ho gaya",
"book kar diya" (vs "confirm karenge").

**Measuring the checks themselves** (Phase 27):
- **recall**: on planted drafts (a fake price, a confirmed booking, a discount), every one is flagged.
  The target is 100 %, because a missed invented price is the failure the spec forbids;
- **precision**: on real drafts that a human judged fine, how many flags were false alarms? Reported;
  too many and staff learn to ignore the banner.

## 6. Steps

1. `recognisers.ts`, one regex family per kind, plus a resolver for relative dates (reuse
   `utils/time.ts`). Unit tests for every row in the table, plus edge cases: "5-6 pm" (two times), "₹2,500
   – ₹3,000" (two amounts), "Mon–Fri" (a weekday range → each weekday).
2. `allowed.ts`: `buildAllowed({ entries, message, subject, details, receivedAt, tz }) → Mention[]`.
3. `numbers.ts`: `inventedNumbers(draftMentions, allowed) → Flag[]`, with severity by kind (money,
   time, date, phone, percent: strong; weekday: strong only if no allowed date implies it; plain
   number: warning).
4. `phrases.ts`: pattern lists per language with negative patterns; `unauthorised_promise` (refund,
   compensation, free session, "we guarantee"), `invented_offer` (discount, % off, free unless the
   info sheet contains those words), `instruction_leak` ("system prompt", "as an AI language model",
   "my instructions").
5. `sensitive.ts`:
   - mask a customer phone or email repeated in the draft (`98xxxx3210`, `r***@example.com`), flag
     `masked_contact`;
   - a Luhn-valid 13–19 digit run, a UPI id (`name@okaxis`), or "share the OTP/PIN/password" → strong
     `sensitive_data`.
6. `tags.ts`: `[S3]`-style tags copied from the info block → strip them, flag info.
7. `runChecks(input) → { flags, maskedText }`; `maskedText` is what's shown and sent.

## 7. Verify

```bash
pnpm --filter api exec vitest run src/checks
```

A planted-draft fixture set (≥ 20: fake price, fake time, a confirmed booking, a Hinglish
confirmation, 20 % off, a refund promise, a repeated phone, a card number, a system-prompt leak) → each
flagged with the right code and span. A clean-draft set (≥ 20 real drafts you judged fine) → the
false-alarm count is printed. Both numbers go in `tasks/lessons.md` now and in the README after
Phase 27.

## 8. Definition of done

- [ ] Every rule in `safety-checks.md` implemented, pure and unit-tested.
- [ ] Planted drafts: 100 % flagged; clean drafts: the false-alarm rate measured.
- [ ] Commit: `feat: code safety checks on drafts`.

## 9. Interview angle

*"How do you guarantee no invented prices?"* Every price, time, date, phone and percentage in a draft
is extracted with typed recognisers and must match a fact the model was actually shown, or the
customer's own words. If not, the span is highlighted and the approver must give a reason to override.
I measure the checks too: 100 % on planted inventions, and a reported false-alarm rate.
