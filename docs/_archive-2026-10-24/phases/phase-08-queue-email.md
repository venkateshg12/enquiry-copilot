# Phase 08 — BullMQ and system email

## 1. Goal

Copy PaperTrail's queue foundation and the **system** Gmail sender (verification, reset and invites).
That sender is the app's own address (`noreply…`), separate from each **business's** Gmail connected
in Phase 23, which sends customer replies.

## 2. What I will understand after this phase

1. The queue / producer / worker / processor split, deterministic job ids, retry vs unrecoverable.
2. **Two kinds of email** in this app, and why they must never be confused.

## 3. Prerequisites

Phase 07 done; the Gmail sender setup from `~/Code/e-commerce/docs/gmail-api-email-sender.md` (reuse
the existing Google project and client).

## 4. Files

The file list of `~/Code/prompt-lab/docs/phases/phase-08-queue-email.md` §4, keeping PaperTrail's
**invite** email (`sendOrgInvite`, its processor case and template), because staff invites are copied in
Phase 10.

## 5. Concepts

| | System email | Customer replies |
| --- | --- | --- |
| From | the app's noreply address | **the business's own address** |
| Sends | verification, password reset, staff invites | approved replies only |
| Auth | one refresh token in env (`GMAIL_REFRESH_TOKEN`) | one sealed token **per business** (Phase 23) |
| Code | `services/gmail.service.ts` (COPY) | `services/businessGmail.service.ts` (Phase 23, reusing the MIME builder) |

A customer must never get a reply from `noreply@…`, and a password reset must never come from a
business's address.

## 6. Steps

Prompt Lab Phase 08 §6, keeping the invite email. Branding: "AI Enquiry Assistant". `worker.ts`
exports `closeWorkers()` (the email worker for now) and keeps PaperTrail's standalone block.

## 7. Verify

Register → the email arrives (or is logged in dev); an invalid refresh token → the job fails once,
unrecoverable; `diff -q` the COPY files.

## 8. Definition of done

- [ ] Commit: `feat(api): BullMQ and system email`.

## 9. Interview angle

*"Which address does a reply come from?"* The business's own Gmail, connected with OAuth and sealed
per business. System mail uses a separate noreply sender. Mixing them would break trust and threading.
