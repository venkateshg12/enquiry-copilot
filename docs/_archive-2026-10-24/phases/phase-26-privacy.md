# Phase 26 — Privacy: retention, deletion, masking

## 1. Goal

Handle customers' personal data the way the spec (§8) and a business owner expect:
- **retention**: each business chooses `retentionDays` (default 365). A nightly job **hard-deletes**
  older messages with their AI results, replies, bookings and calls, keeping only numbers in stats
  counters and a scrubbed activity trail;
- **delete on request**: "delete everything about this customer" (by email/phone) for a data subject's
  request;
- **export**: an owner can export their business's data (JSON);
- **masking in the UI**: contact details shown masked in lists, revealed on click (audited);
- **provider transparency**: `DATA-HANDLING.md` says which model provider receives message text, and
  that nothing is used for training by this app.

## 2. What I will understand after this phase

1. What "hard delete" must cover in this architecture (every collection, and the queue).
2. Why the audit trail survives deletion but not the content.
3. Why the retention job is bounded and idempotent.

## 3. Prerequisites

Phase 25 done.

## 4. Files

```
apps/api/src/
├── services/deletion.service.ts              NEW   (shape of PaperTrail's Phase 40 hardDeleteDocument)
├── jobs/processors/retention.processor.ts    NEW   (nightly scheduler)
├── services/export.service.ts                NEW
├── routes/privacy.route.ts                   NEW   (POST /privacy/forget, GET /privacy/export — owner only)
├── utils/pii.ts                              ADAPT @pt-api/src/utils/pii.ts   (+ maskEmail, maskPhone)
docs/DATA-HANDLING.md                         NEW
```

## 5. Concepts

**What a message touches:**
- `messages`;
- `aiResults` (with raw outputs) and `aiCalls` (no content, but linked);
- `replies` (final text);
- `bookingRequests`;
- `activity` (diff summaries);
- `outboxEvents`;
- BullMQ jobs (ids only, by design: payloads carry ids, never text);
- the Gmail mailbox, which is the **business's own** and isn't the app's to delete. Say so.

`hardDeleteMessage(orgId, messageId)` deletes content rows, scrubs activity `data` to
`{ scrubbed: true }`, and removes queue jobs for the message (best effort). Like PaperTrail's routine,
it's idempotent (a second run is a no-op) and ordered so a crash midway is finished by the next run (the
message row is deleted last).

**Retention.** `upsertJobScheduler("retention", { pattern: "0 2 * * *" })` → for each business,
messages with `receivedAt < now − retentionDays`, oldest first, 500 per run, in `runAsSystem`. The stats
counters for past months stay. Store monthly roll-ups (`statsMonthly` collection: counts, percentiles)
**before** deleting, so a business's history of reply times survives its data retention.

**Forget a customer.** `POST /privacy/forget { email?, phone? }` (owner): find messages by
`fromEmail`/`fromPhone` (normalised) → `hardDeleteMessage` each → write an activity row
`privacy.forget { count }` without the identifier. It returns the count.

**Masking in the UI.** Lists show `ra***@gmail.com` and `+91 98xxxx3210`; the detail view shows them in
full for `messages.reply` users. That's a small thing that matters on a shared front-desk screen.

**Data handling statement** (`DATA-HANDLING.md`, linked from settings):
- what's stored;
- where (MongoDB Atlas region);
- for how long (the business setting);
- who sees it (the business's staff; you as operator);
- which provider processes text (NVIDIA NIM by default, or whichever model is configured), with
  links to their API terms;
- that logs contain no message content;
- how to request deletion.

It's not legal advice. For a paid pilot, agree data terms in writing (spec §10).

## 6. Steps

1. `deletion.service.ts` and tests (the PaperTrail Phase 40 pattern).
2. The retention scheduler + monthly roll-up (`statsMonthly`: `{ orgId, month, counts, p50ReplyMs, … }`)
   computed before deletion.
3. Forget + export endpoints (owner only); export is a streamed JSON of profile, info sheet, messages,
   replies and bookings.
4. UI:
   - masking in lists;
   - Settings → Privacy: retention days, Forget a customer (with a confirmation), Export.
5. `DATA-HANDLING.md`.

## 7. Verify

1. Set retention to 0 days on a test business → run retention → its messages and all linked rows gone;
   `statsMonthly` kept; activity scrubbed.
2. Forget `ravi@example.com` → their messages are gone; other customers untouched; the activity row has
   no email.
3. Run deletion twice → no errors, no-op.
4. A staff role can't call forget or export (403).

## 8. Definition of done

- [ ] Retention with monthly roll-ups; forget-a-customer; export; UI masking; the data-handling doc.
- [ ] Commit: `feat: privacy — retention, deletion, export`.

## 9. Interview angle

*"How do you handle customer data?"* Retention per business with monthly roll-ups, so stats survive
deletion. Hard delete across every collection with a scrubbed audit trail. A "forget this customer"
action. No content in logs or job payloads. A plain statement of which model provider sees the text.
