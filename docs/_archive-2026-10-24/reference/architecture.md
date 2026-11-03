# Architecture: what is reused and what is new

Path shorthands used in every phase:

| Shorthand | Real path |
| --- | --- |
| `@pt-root/` | `~/Code/paper-trail/` |
| `@pt-api/` | `~/Code/paper-trail/apps/api/` |
| `@pt-web/` | `~/Code/paper-trail/apps/web/` |
| `@cd-widget/` | `~/Code/counseldesk/apps/widget/` |
| `@pl-docs/` | `~/Code/prompt-lab/docs/` (the evaluation method; Prompt Lab may still be in progress) |
| `@ec-api/` | `~/Code/e-commerce/apps/backends/mongo/` (origin) |

**Copy from PaperTrail's code, not its plans.** PaperTrail is implemented through its Phase 37. Read
each file before copying it; its `tasks/lessons.md` records where code and docs differ.

## 1. Reused

| Concern | Source | Role here |
| --- | --- | --- |
| API foundation: errors, envelope, `createApp`, shutdown, pino + request ids | `@pt-api/src/{utils/errors,utils/api,app.ts,index.ts,utils/logger.ts,middleware/requestId.ts}` | as is |
| Auth (rotation, live sessions, Google), rate limiter, cache | `@pt-api/src/{utils/auth,services/auth.service.ts,utils/rateLimiter,utils/cache}` | staff sign-in; public form protection |
| **Organisations → businesses**: org, membership, roles, invites, `resolveOrg`, `requireOrgRole`, tenant plugin | `@pt-api/src/{services/org.service.ts,services/member.service.ts,services/invite.service.ts,middleware/resolveOrg.ts,middleware/requireOrgRole.ts,utils/db/tenantPlugin.ts,constants/permissions.ts}` | one business = one org; owner + staff |
| BullMQ, Gmail sender (MIME builder, error mapping, OAuth flow) | `@pt-api/src/{jobs,config/gmail.ts,services/gmail.service.ts,controllers/gmailAuth.controller.ts}` | system email, **and** generalised to each business's own Gmail |
| Transactional outbox + relay | `@pt-api/src/{models/outboxEvent.model.ts,services/outbox.service.ts,jobs/outbox/*}` | intake → pipeline; approval → send |
| Secret sealing (AES-256-GCM) | `@pt-api/src/utils/crypto/secretBox.ts` | per-business Gmail refresh tokens |
| PII helpers, logger redaction | `@pt-api/src/utils/pii.ts`, `utils/logger.ts` | message bodies, emails, phones |
| LLM layer: `generateJson`, `modelJson` repair, typed errors, retry, breaker, lease, RPM | `@pt-api/src/ai/*` | classify/extract (JSON) + a new `generateText` for drafts |
| SSE progress | `@pt-api/src/utils/events/*` | the inbox updates live |
| Next.js client foundation | `@pt-web/src/*` | the dashboard |
| Embeddable widget (Vite IIFE, shadow DOM) | `@cd-widget/` | the contact form |
| Test harness | `@pt-api/test/*`, `@pt-api/vitest*.mts` | integration tests |

## 2. Genuinely new

1. **The info sheet** as typed entries (`service`, `price`, `timing`, `policy`, `faq`, `address`):
   the only source of facts.
2. **A three-step narrow pipeline**: classify → extract → draft, each a versioned prompt with its own
   schema, model and metrics.
3. **Code safety checks on drafts**: a number/time/date/phone extractor plus a matcher against the
   info sheet and the customer message; booking-promise phrases; length; sensitive-data masking;
   flagged spans highlighted in the UI.
4. **Per-business Gmail**: OAuth with read + send scopes, polling with the history API, threading
   headers on replies, sealed tokens.
5. **The approval inbox**: approve / edit / reject / spam, with edits stored as future prompt
   examples.
6. **The booking-requests list**, and **stats** (reply time, approval without edits).
7. **Evaluation**: a labelled message set, a pipeline eval through the production code path, and
   classify/extract comparisons in **Prompt Lab**.

## 3. The flow

```
intake (form | gmail poll) ─► withTransaction { Message(received) + outbox "message.received" }
relay ─► pipeline job  jobId pipeline:<messageId>:<runId>
          classify  → AiResult(step=classify)    spam (conf ≥ 0.8) → status spam, stop
          extract   → AiResult(step=extract)     booking → BookingRequest(new)
          draft     → AiResult(step=draft)
          checks    → flags[] with spans
          → status needs_approval  (+ SSE)
staff ─► approve(edit?) → withTransaction { Reply(approved) + Message(approved) + activity + outbox "reply.approved" }
relay ─► send job → Gmail send (thread headers) → Reply.sentAt, Message(replied) + activity
```

## 4. Interview pitch

> "It's a human-in-the-loop assistant for small businesses. Three narrow prompts (classify, extract,
> draft) each have their own schema, model and test set, evaluated with my Prompt Lab tool. Facts come
> only from the business's info sheet, and code checks every number in every draft against that sheet
> before a person sees it. Nothing is sent without an approval, which is a database transaction that
> writes an outbox event, so a reply can't go out unless the approval committed. On [N] labelled test
> messages: [X]% category accuracy, [Y]% of drafts approved without edits, zero invented prices."
