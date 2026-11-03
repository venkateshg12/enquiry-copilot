# Phase 03 — MongoDB and conventions

## 1. Goal

Connect MongoDB (local replica set, Atlas in production), report it in `/health`, disconnect on
shutdown, and fix the conventions:
- `orgId` (= business) on every business-owned document;
- cost in integer micro-dollars;
- ObjectId validation at the edge;
- `withTransaction`, cursor pagination;
- **times stored in UTC, displayed in the business timezone**.

Steps as in `~/Code/prompt-lab/docs/phases/phase-03-mongo.md`, with the differences below.

## 2. What I will understand after this phase

1. Why this app needs transactions in two places (intake + outbox, approval + outbox).
2. Why timezone handling is a first-class convention here (bookings: "this Saturday 5 pm").

## 3. Prerequisites

Phase 02 done.

## 4. Files

As in Prompt Lab Phase 03:
- `config/db.ts`, `utils/db/{transaction,cursor}.ts`, `packages/types/src/{objectId,pagination}.ts`:
  COPY;
- `utils/db/tenantPlugin.ts` is copied in Phase 10.

**Plus:** `utils/time.ts` (NEW) and `pnpm --filter api add luxon && pnpm --filter api add -D @types/luxon`.

## 5. Concepts

**Time is part of correctness here.** A message received Friday 23:30 IST saying "tomorrow 5 pm" means
Saturday 17:00 **IST**. Rules:
- store `receivedAt` as a UTC `Date`;
- each business has an IANA `timezone` (`Asia/Kolkata`);
- relative dates are resolved in the business timezone (Phase 16);
- extracted `preferred_date` / `preferred_time` are **local** wall-clock strings (`2026-10-25`,
  `17:00`), never converted to UTC, because they mean "Saturday at 5" in the shop's time;
- the UI shows times in the business timezone.

`utils/time.ts` wraps Luxon:
- `localNow(tz)`;
- `localDate(date, tz)`;
- `resolveRelativeDate(text, receivedAt, tz)` (used in tests and the safety checks);
- `formatForBusiness(date, tz)`.

## 6. Steps

Follow Prompt Lab Phase 03 §6, with database `enquiry`:
`MONGO_URI=mongodb://localhost:27017/enquiry?replicaSet=rs0`. Then add `utils/time.ts` with unit tests
around a DST-free zone (`Asia/Kolkata`) and a DST zone (`Europe/London`, 26 Oct 2026 is a transition
day: test it).

## 7. Verify

`/health` reports Mongo, and 503 when it's down. The transaction probe works. The time tests pass,
including the DST day.

## 8. Definition of done

- [ ] Connection, conventions and time helpers in place.
- [ ] Commit: `feat(api): mongo and conventions`.

## 9. Interview angle

*"Any tricky bugs in booking extraction?"* Time zones. "Tomorrow 5 pm" is resolved against the message's
received time in the business's timezone, stored as local wall-clock time, and tested across a DST
change.
