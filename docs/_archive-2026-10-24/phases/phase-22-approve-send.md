# Phase 22 — Approval, sending, activity log

## 1. Goal

Make "approve" the **only** door to sending:
- `POST /messages/:id/approve { text, version, overrideReason? }` runs **one transaction**:
  1. re-read the message and require `needs_approval`;
  2. re-run the checks on the final text (the server never trusts the client's check result);
  3. require a reason for strong flags;
  4. create the `Reply` (`finalText`, `wasEdited`, edit diff, `approvedBy`);
  5. move the message to `approved`;
  6. write the activity entry;
  7. emit outbox `reply.approved`;
- the relay → a **send job** → the channel sender (form messages: email to the customer from the business
  address, or the system sender with Reply-To until Gmail is connected; email messages: a threaded reply
  in Gmail, Phase 23) → `sentAt`, message `sent`, activity;
- reject and spam paths, also logged;
- **edits saved as learning material**: the draft-vs-final diff and "approved without edits" go to the
  stats (Phase 25) and to the tone examples (Phase 18).

## 2. What I will understand after this phase

1. Why a transaction plus an outbox guarantees "no send without approval" and "no approval without send".
2. Why the server re-runs the checks on the approved text.
3. How double-sending is prevented end to end.
4. What an activity log must answer ("who approved what, edits made, time taken").

## 3. Prerequisites

Phase 21 done.

## 4. Files

```
packages/types/src/reply.ts                        NEW
apps/api/src/
├── models/{reply,activity}.model.ts               NEW
├── services/approval.service.ts                   NEW   (approve, reject, markSpam, notSpam)
├── services/send.service.ts                       NEW   (channel dispatch)
├── jobs/queues/send.queue.ts · processors/send.processor.ts · workers/send.worker.ts   NEW
├── jobs/outbox/dispatchers.ts                     ADAPT (reply.approved → send job)
├── utils/text/diff.ts                             NEW   (word-level diff for the activity log)
└── routes/message.route.ts                        ADAPT (+ approve, reject, spam, not-spam)
```

```bash
pnpm --filter api add diff
```

## 5. Concepts

**Approve = transaction + outbox** (PaperTrail Phase 21 + 28). Inside one `withTransaction`:

```
message = findOne({ _id, orgId }).session(s)        → must be needs_approval (else 409 "Already handled")
checks  = runChecks(finalText, the draft's used entries, message, details)   ← server-side, on the FINAL text
strong flags && !overrideReason                    → 422 (code DraftFlagged)
Reply.create({ messageId, finalText: checks.maskedText, draftText, wasEdited, diff, approvedBy, flagsAtApproval, overrideReason })
transitionStatus(needs_approval → approved, { session })
Activity.create({ action: "reply.approved", actor, diff summary, timeToApproveMs })
emit(session, "reply.approved", { replyId })
```

Commit, then (relay) send. If the transaction aborts, nothing is sent, ever. If the process dies after
the commit, the relay still dispatches the event. The spec's design rule, enforced by architecture:
**there is no code path that sends without an approval row**, so make that a test (Phase 29).

**Re-check on the server.** The client's highlights are a convenience. A modified client, or a race
with an info-sheet change, could submit an unchecked text. The server runs the same pure checks on the
final text against the draft's `infoEntryIds`. If the staff member typed a new price in their edit, it's
flagged too, and they must give a reason or fix it. Humans invent numbers as well.

**No double send.**
- The send job id is `send:<replyId>` (deterministic).
- The processor checks `reply.sentAt` before sending and sets it after (conditional update
  `{ _id, sentAt: null }`).
- The Gmail call has a `Message-ID` header derived from `replyId`, so even a crash between "Gmail
  accepted" and "we recorded `sentAt`" can be detected on retry (search the Sent folder for that
  Message-ID before re-sending; Phase 23).

**Form messages without Gmail connected.** Until the business connects Gmail (Phase 23), replies to
form messages go through the **system** sender (Phase 08) with `Reply-To: <business contact email>` and
the business name as the display name. Show a banner in settings: "Replies are sent from noreply…
Connect your Gmail so they come from your address." The spec wants replies from the business; this
fallback keeps the demo working.

**Activity log.** Append-only:

| Action | Recorded |
| --- | --- |
| `reply.approved` | actor, `wasEdited`, word-level diff summary (+/- counts) **without** customer text, time from received → approved, flags overridden + reason |
| `reply.sent` / `reply.send_failed` | channel, provider message id, error code |
| `message.rejected` / `message.spam` / `message.not_spam` | actor, reason |
| `message.category_changed` | old → new |
| `ai.rerun` | actor |

The diff stores word counts and changed-word samples in the reply (behind auth), not in logs.

**Learning from edits.** `Reply.wasEdited` and the diff feed:
1. the stat "drafts approved without edits" (the spec's quality metric);
2. tone examples (Phase 18): unedited approvals, names replaced with `{name}`;
3. a "top edits" view (Phase 25): the most common removed/added phrases. That's the input to the next
   prompt version (Phase 28).

## 6. Steps

1. Models:
   - `Reply`: `orgId, messageId, draftText, finalText, wasEdited, diff, approvedBy, approvedAt,
     flagsAtApproval, overrideReason, channel, sentAt, providerMessageId, sendError`, with a unique
     index on `messageId` (one reply per message in the MVP; follow-ups are new messages);
   - `Activity`: `orgId, messageId, actor {type,id}, action, data, at`, indexed `{ orgId, at: -1 }`.
2. `approval.service.ts` (above); `reject(…, reason)`, `markSpam`, `notSpam` (→ re-run). All
   conditional transitions + activity, in transactions.
3. Send job: load the reply, return if `sentAt` is set, then `send.service`:
   - `channel === "email"` and Gmail connected → `businessGmail.sendReply` (Phase 23);
   - otherwise the system sender with Reply-To.

   Then the conditional `sentAt` update, `transitionStatus(approved → sent)`, activity and SSE. Failure
   policy: transient → backoff (5 attempts); auth revoked → `send_failed`, banner "Reconnect Gmail",
   and the message moves back to `approved` with a "Resend" button.
4. Routes with `messages.reply`; idempotency comes from the conditional transition (a second approve →
   409).
5. Web: wire Approve / Reject / Spam to the endpoints; show "Sending…" → "Sent ✓" via SSE; "Resend" on
   failure.

## 7. Verify

1. Approve an unedited draft → a `Reply` with `wasEdited: false`, message `sent`, an email received (dev:
   logged), activity entries for approved and sent.
2. Edit a price to an invented one → the server returns 422 even if the client didn't flag it (curl the
   API directly); with a reason → approved, and the reason is in the activity.
3. Approve twice concurrently (two curls) → one 200, one 409; one email.
4. Kill the worker after the outbox event is claimed → restart → exactly one send.
5. A forced throw inside the approval transaction → no reply row, no event, no email.
6. Gmail auth revoked (Phase 23) → `send_failed`, banner, Resend works after reconnecting.

## 8. Definition of done

- [ ] Approve is a transaction + outbox; the server re-checks the final text; no double sends.
- [ ] Reject/spam paths and an append-only activity log.
- [ ] Edits recorded for stats and tone learning.
- [ ] Commit: `feat: approval transaction, sending and activity log`.

## 9. Interview angle

*"How do you guarantee the AI never sends on its own?"* There's no code path that sends without an
approval row. Sending is triggered only by an outbox event written in the same transaction as the
approval, and the server re-checks the final text, so even a human-typed invented price is caught. A
deterministic send-job id plus a conditional `sentAt` update means one approval is one email.
