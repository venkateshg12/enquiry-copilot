# Phase 24 — Booking requests

## 1. Goal

Turn booking messages into a list the owner can act on (spec feature 5; no calendar sync in the MVP):
- when the pipeline classifies `booking` and extract finds a service and/or a date/time, create a
  **BookingRequest** (`new`), linked to the message;
- the `/bookings` table: date, time, service, customer, status (`new`, `confirmed`, `declined`,
  `rescheduled`), issues (`outside_hours`, `date_in_past`), and a filter by day/week;
- **Confirm / Decline / Propose another time**: each creates a **reply draft through the same approval
  flow** (Phases 21–22). Nothing is sent without approval; the AI never confirms a booking, a person
  does;
- a simple **clash hint**: other confirmed bookings for the same service at the same slot.

## 2. What I will understand after this phase

1. Why the booking status lives with staff actions, not with the AI.
2. How staff actions reuse the approval pipeline instead of a second sending path.
3. What a clash hint can and can't promise without a calendar.

## 3. Prerequisites

Phase 23 done (or 22, if email intake is postponed).

## 4. Files

```
packages/types/src/booking.ts                     NEW
apps/api/src/
├── models/bookingRequest.model.ts                NEW
├── services/booking.service.ts                   NEW   (createFromPipeline, list, confirm/decline/propose)
├── pipeline/templates/bookingReplies.ts          NEW   (confirmation/decline/propose templates — deterministic text, not AI)
├── jobs/processors/pipeline.processor.ts         ADAPT (create the booking request after extract)
└── routes/booking.route.ts                       NEW
apps/web/src/app/(app)/bookings/page.tsx · components/bookings/*   NEW
```

## 5. Concepts

**The AI requests, a human confirms.** The draft for a booking message always says "we've received your
request; the team will confirm the slot" (Phase 18, enforced by Phase 19). Confirmation is a staff
action in `/bookings`. That action **generates a confirmation reply** for the same customer and drops it
into the approval flow, pre-filled and approvable in one click. The confirmation text comes from a
**template**, not the model:

```
Hi {name}, your {service} on {Saturday, 25 October} at {5:00 pm} is confirmed. See you then! — {signature}
```

The template is deterministic, so there's no chance of the model inventing a time on the one message
where a time is the whole point. The safety checks still run on it (the time must match the booking).

**One sending path.** Confirm/decline/propose create a `Reply` draft attached to the original message's
thread and go through `approve` like any other reply. No second code path can send, so the "nothing
without approval" guarantee holds for bookings too.

**Clash hint, not scheduling.** Without calendar sync, plain database logic can still warn: "2 other
confirmed bookings for Python crash course on Sat 25 Oct, 17:00". Capacity per service is an optional
info-sheet field (`capacityPerSlot`). Over capacity → a warning, never a block. The owner knows their
reality better than the database.

## 6. Steps

1. Model: `orgId, messageId, service, preferredDate, preferredTime, customerName, customerContact,
   status, issues[], confirmedDate?, confirmedTime?, handledBy?, replyId?`, indexed
   `{ orgId, preferredDate, preferredTime }` and `{ orgId, status, createdAt: -1 }`.
2. Pipeline processor: after extract, if `category === "booking"` and (service or date) → upsert a
   booking by `messageId` (unique), so a re-run doesn't duplicate it.
3. Routes (`bookings.update`):
   - `POST /bookings/:id/confirm { date?, time? }` (defaults to the requested slot);
   - `/decline { reason? }`;
   - `/propose { date, time }`.

   Each updates the status, renders the template, and creates or updates the message's reply draft
   (status `needs_approval` again if the message was already answered: a **new** Reply row for the same
   thread; relax Phase 22's one-reply-per-message rule to one *pending* reply per message), then logs
   activity.
4. `/bookings` page: a week view grouped by day plus a table view; status chips; issue badges; the clash
   hint; buttons that open the generated reply in the inbox's approve dialog.

## 7. Verify

1. A widget message "book Python crash course this Saturday 5 pm" → a booking request (`new`, Sat 25 Oct
   17:00).
2. Confirm → a reply draft with the template text appears in the inbox → approve → sent → booking
   `confirmed`, with activity entries.
3. Propose another time → the draft has the proposed time; the checks pass (the time is in the booking).
4. Confirm a second booking at the same slot → the clash hint shows.
5. Re-run the AI on the message → still one booking request.

## 8. Definition of done

- [ ] Booking requests from the pipeline; confirm/decline/propose via templates and the approval flow.
- [ ] Clash hints; no second sending path.
- [ ] Commit: `feat: booking requests`.

## 9. Interview angle

*"Does the AI book appointments?"* No. It extracts the request and drafts "we'll confirm". A person
confirms in the bookings list, which generates a templated confirmation that still goes through the
same approval-and-send path. The one message where a time matters most is never written by the model.
