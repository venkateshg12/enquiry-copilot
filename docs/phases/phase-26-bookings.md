# Phase 26 — Booking requests

## 1. Goal

Turn booking messages into a list staff can act on (spec feature 5, no calendar sync in the MVP):

- when the pipeline classifies a message as `booking` and extract finds a service or a date/time,
  create a **`BookingRequest`** (`new`) linked to the message. It's created once per message, even
  when the pipeline is re-run;
- `/bookings`: a week view and a table. Each row shows date, time, service, masked customer, status
  (`new`, `confirmed`, `declined`, `rescheduled`), issue badges (`date_in_past`, `unknown_service`,
  `outside_hours`) and a **clash hint**;
- **Confirm / Decline / Reschedule**. Each one either:
  - updates the status alone ("I told them by phone"), or
  - produces a **templated reply** that goes through the same approval and send path as every other
    reply (Phase 24). Nothing is sent without approval, and the model never writes the confirmation;
- dates and times are shown and stored in the **business's timezone** (`Org.timezone`).

## 2. What I will understand after this phase

1. Why the AI only *requests* and a person *confirms*, and how the code enforces it.
2. How a staff action reuses the approval pipeline instead of opening a second way to send.
3. Why the confirmation text is a template, not a model output.
4. How to turn "2026-11-07 17:00 in Asia/Kolkata" into a correct instant without a date library, and
   why DST zones need a test.
5. What a clash hint can and can't promise without a calendar.

## 3. Prerequisites

- Phase 25 done (or Phase 24, if the Gmail channel is postponed).
- Phase 17's extract output (`preferred_date`, `preferred_time`, `service`, `issues[]`) and Phase 21's
  checkpointed `process-message` job.

## 4. Files

```
packages/types/src/booking.ts                        NEW    bookingListQuery, confirm/decline/reschedule schemas, BookingDto
apps/api/prisma/schema.prisma                        ADAPT  (+ BookingStatus, BookingRequest; + ReplyKind and Reply.kind/bookingId; Message.reply → replies)
apps/api/prisma/migrations/<ts>_bookings/            NEW    (generated + one hand-written partial unique index, below)
apps/api/src/
├── db/prisma.ts                                     ADAPT  (+ "BookingRequest" in TENANT_MODELS)
├── utils/date/zoned.ts (+ .test.ts)                 NEW    zonedToUtc(date, time, tz), formatInZone(instant, tz)
├── pipeline/templates/bookingReplies.ts (+ .test.ts) NEW   confirm / decline / reschedule texts (deterministic)
├── services/booking.service.ts                      NEW    createFromPipeline, list, prepareReply, approveBookingReply, setStatus
├── jobs/processors/processMessage.processor.ts      ADAPT  (Phase 21's processor: + createFromPipeline after the "extracted" checkpoint)
├── services/approval.service.ts                     ADAPT  (Phase 24: the reply lookup filters kind = "initial")
├── controllers/booking.controller.ts · routes/booking.route.ts   NEW
apps/web/src/
├── api/booking.ts · hooks/booking/{useBookings,usePrepareBookingReply,useApproveBookingReply,useSetBookingStatus}.ts   NEW
├── app/(app)/bookings/page.tsx                      NEW
└── components/bookings/{WeekView,BookingTable,BookingActions,ClashHint}.tsx   NEW
```

## 5. Concepts

**The AI requests, a person confirms.** The draft for a booking message always says the request is
received and the team will confirm the slot (Phase 19's prompt rule). Phase 20's `booking_promise`
check flags any draft that says otherwise. Confirmation is a **staff action** here. The model never
writes the message where the time matters most.

**One sending path, even for bookings.** Confirm, decline and reschedule don't call a sender. They
prepare text, and the reviewer approves it through a transaction that has the same shape as
Phase 24's: a conditional booking-status update, a `Reply` row, an audit row and a `reply.approved`
outbox event. That event dispatches the same `send-reply` job. The Phase 31 test that "only the outbox
dispatcher enqueues sends" covers bookings with no extra work.

**A message can now have more than one reply.** Phase 24's `Reply.messageId @unique` meant one reply
per message, but a booking message gets the "we've received it" reply first and a confirmation later.
This phase:
- adds `enum ReplyKind { initial booking_update }`, plus `Reply.kind` (default `initial`) and
  `Reply.bookingId`;
- replaces the column-level unique with a **partial unique index**, so "one *initial* reply per
  message" is still enforced by the database:
  ```sql
  -- appended by hand to the generated migration.sql
  DROP INDEX "replies_message_id_key";
  CREATE UNIQUE INDEX "replies_one_initial_per_message" ON "replies" ("message_id") WHERE kind = 'initial';
  CREATE INDEX "replies_message_id_idx" ON "replies" ("message_id");
  ```
  Prisma can't declare a partial unique, so `schema.prisma` gets `@@index([messageId])` and a comment
  pointing at the migration.
- Phase 24's `approval.service.ts` reads with `findFirst({ messageId, kind: "initial" })` (it already
  uses `findFirst`). The race it relied on is still settled by the database: a second initial reply
  hits `P2002` and becomes 409.

**Templates, not prompts.** `bookingReplies.ts` is pure and unit-tested:
```ts
export const confirmText = (b: { name?: string | null; service: string; when: string }, org: { signature: string }) =>
  `Hi${b.name ? ` ${b.name}` : ""}, your ${b.service} booking for ${b.when} is confirmed. ` +
  `If anything changes, just reply to this message. — ${org.signature}`;
// declineText(…, reason?) · rescheduleText(…, proposedWhen)
```
Here `when` is `formatInZone(instant, org.timezone)`, for example "Saturday, 7 November at 5:00 pm".
The safety checks **still run** on the text, with the booking's date and time added to the allowed
set. If a reviewer edits the confirmation to a time that isn't the booking's, it's a strong
`invented_number` flag like any other.

**Created once, never overwritten by the AI.** After the `extracted` checkpoint, `createFromPipeline`
upserts by `messageId` (which is `@unique`):
- `create`: `status: new`, plus the service/date/time from extract;
- `update`: only when the existing row is still `new` **and** untouched by staff (`updatedById IS NULL`).

So a "reprocess" can fix a misread date, but it never undoes a confirmation. It runs only for
`category === "booking"` and when `service || preferred_date || preferred_time` is non-null.

**Timezones without a library.** `preferred_date` and `preferred_time` are local to the business.
`zonedToUtc("2026-11-07", "17:00", "Asia/Kolkata")` finds the instant using `Intl.DateTimeFormat`
offsets:
```ts
const offsetMs = (instant: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(instant).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instant.getTime();
};
export const zonedToUtc = (date: string, time: string, tz: string) => {
  const guess = new Date(`${date}T${time}:00Z`);
  const first = new Date(guess.getTime() - offsetMs(guess, tz));
  return new Date(guess.getTime() - offsetMs(first, tz));      // second pass fixes guesses across a DST change
};
```
India has no DST, so the test cases include `Europe/London` on both sides of the October change. A
pilot outside India must not get confirmations an hour off. `confirmedAt` stores the instant;
`preferredDate` is a `@db.Date` because it's a calendar day, not a moment.

**Clash hint, not scheduling.** The hint is a count of other `confirmed` bookings with the same
`service` and the same `confirmedAt`:
"2 other confirmed bookings for Python crash course on Sat 7 Nov, 5:00 pm." It's a warning, never a
block. Without calendar sync the database doesn't know about walk-ins or phone bookings, and the
owner knows their reality better than it does. Spec §14's "what would you add next" answer is
calendar sync.

**Statuses.**

| Action | From | To | Reply |
| --- | --- | --- | --- |
| Confirm (requested slot or an edited one) | `new`, `rescheduled` | `confirmed` | optional, templated |
| Decline (reason) | `new`, `rescheduled`, `confirmed` | `declined` | optional, templated |
| Reschedule (proposed slot) | `new`, `confirmed` | `rescheduled` | **required**: the customer must be asked |

Without a reply, the status is set by `setStatus` (conditional update + audit, `withReply: false`).
With a reply, the status changes **only when the reply is approved**, in that transaction, so the list
never says "confirmed" for a customer who hasn't been told.

## 6. Steps

1. **Schema + migration.** Add `BookingStatus` and `BookingRequest` (data-model.md), the `ReplyKind`
   change above, and `"BookingRequest"` in `TENANT_MODELS`. On `Message`, change `reply Reply?` to
   `replies Reply[]`, and keep `booking BookingRequest?`.
   `pnpm --filter api db:migrate:dev --create-only --name bookings`, append the SQL above, then
   `pnpm --filter api db:migrate:dev`.
2. **`zoned.ts`** + tests: Kolkata, London before/after DST, midnight, invalid input (the function
   throws; the controller maps that to 400).
3. **Pipeline hook.** In Phase 21's processor, right after the `extracted` checkpoint commits, call
   `createFromPipeline(tx, message, extracted)` inside the same checkpoint transaction (so a retry
   doesn't double-insert). Then publish SSE `{ bookingId }`.
4. **`booking.service.ts`.**
   - `list(orgId, { from, to, status, cursor })` returns the rows, plus `clashCount` per row from one
     grouped query (`GROUP BY service, confirmed_at`), not a query per row.
   - `prepareReply(orgId, bookingId, action, input)` returns `{ text, flags }` (the template + `runChecks`)
     and writes nothing.
   - `approveBookingReply(orgId, bookingId, userId, { action, text, slot?, overrideReason? })` is the
     transaction:
     ```
     withTransaction(tx =>
       booking  = tx.bookingRequest.findFirst({ id, orgId }) → 404
       checks   = runChecks(text, { entries, message, extracted, extraAllowed: [slot] })
       strong && !overrideReason → 422 DraftFlagged
       moved    = tx.bookingRequest.updateMany({ id, orgId, status in allowedFrom(action) } →
                    { status, confirmedAt, updatedById: userId })
       moved.count === 0 → 409 AlreadyHandled
       reply    = tx.reply.create({ kind: "booking_update", bookingId, messageId, draftText: template,
                    finalText: checks.maskedText, wasEdited, editDistance, approvedById: userId, … })
       recordAudit({ action: `booking.${action}`, diff: { from, to, withReply: true, overriddenFlags } }, tx)
       emit(tx, orgId, "reply.approved", { replyId: reply.id, messageId })
     )
     ```
   - `setStatus(orgId, bookingId, userId, { action, slot?, reason? })` is the same transaction without
     the reply and the event (`withReply: false`). Reschedule is rejected here: it needs a reply.
5. **Routes** (all `bookings.manage`, reviewer and up):
   `GET /orgs/:orgId/bookings`, `POST …/bookings/:id/prepare-reply`, `POST …/bookings/:id/approve-reply`,
   `POST …/bookings/:id/status`.
6. **Web.** `/bookings`:
   - a week view grouped by day in the business timezone, and a table view (the same data);
   - status chips, issue badges, the clash hint;
   - "Confirm", "Decline" and "Reschedule" open the **Phase 24 `ApproveDialog`**, prefilled with the
     template, with its flags and its "send nothing, just update the status" option (not available for
     reschedule);
   - the customer's contact is masked in the list (`ra***@gmail.com`) and shown in full in the message
     detail.

## 7. Verify

```bash
pnpm --filter api test -- zoned bookingReplies
pnpm --filter api db:migrate:dev
psql $DATABASE_URL -c "\d replies" | grep -E "one_initial|kind"
# → "replies_one_initial_per_message" UNIQUE, btree (message_id) WHERE kind = 'initial'::"ReplyKind"
```

1. A widget message "I'd like to book the Python crash course this Saturday 5 pm", received Wed
   2026-11-04 → a booking: `new`, service "Python crash course", `2026-11-07`, `17:00`.
2. Reprocess the message → still one booking (`select count(*) from booking_requests where message_id = …` → 1).
3. Confirm with a reply → the dialog shows "…for Saturday, 7 November at 5:00 pm is confirmed…".
   Approve → the booking is `confirmed`, `confirmed_at = 2026-11-07 11:30:00+00`, a `booking_update`
   reply is sent through `send-reply`, and the audit has `booking.confirm`.
4. Edit the confirmation to "6 pm" → 422 `DraftFlagged` (`invented_number`, time).
5. Confirm a second booking for the same service and slot → the list shows "1 other confirmed booking"
   on both.
6. Two reviewers confirm at once → one 200, one 409, one email.
7. Set the business timezone to `Europe/London` and confirm 2026-10-24 17:00 and 2026-10-31 17:00 →
   `16:00Z` and `17:00Z` (BST, then GMT).
8. Confirm "without a message" → status `confirmed`, audit `withReply: false`, no reply row, no email.

## 8. Definition of done

- [ ] Booking requests are created once from the pipeline, and staff decisions are never overwritten by a reprocess.
- [ ] Confirm, decline and reschedule go through templated text and the Phase 24-shaped approval transaction; the status changes only on approval.
- [ ] Partial unique index: one initial reply per message, any number of booking updates.
- [ ] Timezone-correct storage and display, with DST tests.
- [ ] Clash hint, masked contacts in the list.
- [ ] Verify steps 1–8 pass.
- [ ] Commit: `feat(api,web): booking requests`.

## 9. Interview angle

*"Does the AI book appointments?"* No. It extracts the request, and its draft says "we'll confirm".
A person confirms in the bookings list. That generates a **templated** confirmation (the model never
writes the one message where the time is the point), which still goes through the same
approval-and-outbox path as every reply, so there's still exactly one way to send. The status only
flips in the approval transaction, so the list never says "confirmed" for a customer who hasn't been
told. And because it's not a calendar, the clash check is a hint, not a lock.
