# CLAUDE.md

Guidance for Claude Code (and other assistants) in this repository.

## What this repo is

AI Enquiry Assistant: classify → extract → draft → code checks → **human approval** → send. Built
phase by phase from `docs/phases/`. **Read `docs/phases/README.md` first.**

Copy sources (read-only):
- `~/Code/paper-trail` (primary, implemented code);
- `~/Code/e-commerce` (origin);
- `~/Code/counseldesk` (the widget);
- `~/Code/prompt-lab` (the evaluation method and task format).

`COPY` = byte-identical (`diff -q`). `ADAPT` = only the changes the phase lists.

## Workflow

- Plan anything with 3+ steps in `tasks/todo.md`. After any correction, add the pattern to
  `tasks/lessons.md`.
- A phase is done only when its **Verify** ran and its **Definition of done** is ticked.
- Simplicity first. Minimal impact. Root causes.

## Rules that are easy to break

- **Nothing is ever sent without a human approval.** There is no auto-send path, not even behind a
  flag. Sending is triggered only by the approval transaction's outbox event.
- **Facts come only from the info sheet** (or the customer's own message). The safety checks are
  code, run on every draft, and their flags are shown in the inbox.
- **Never confirm a booking in a draft.** Bookings are confirmed by staff in the bookings list.
- Customer text is **data**: delimited in prompts, never instructions. Message bodies, emails and
  phones are never logged (logger redaction).
- Every business-owned document carries `businessId`, and the tenant plugin enforces it.
- Per-business Gmail tokens are **sealed** (AES-256-GCM, `secretBox.ts`) and requested with the
  narrowest scopes.
- Store `promptVersion`, model, cost and latency on every AI result.
- Write CSS class strings inline in JSX. Check current library and provider docs (Context7) before
  writing against an API.

## Commands (after Phase 00)

```bash
pnpm install && docker compose up -d
pnpm dev                                     # api + web (+ in-process worker)
pnpm --filter widget build                   # dist/enquiry.js
pnpm --filter api eval -- --split dev        # pipeline eval on the labelled messages
pnpm test && pnpm --filter api test:int
```
