# Phase 02 — Logging with PII redaction

## 1. Goal

Copy PaperTrail's pino logger, `AsyncLocalStorage` context and `requestId` middleware. Extend the
redaction list to **customer personal data**: this app's logs would otherwise be full of names,
phone numbers, emails and message bodies. The spec: "never log full email contents in plain server
logs".

## 2. What I will understand after this phase

1. Why message bodies and contacts never go to logs (retention you don't control, more readers).
2. How a `messageId` in the context replaces logging the content: you look the message up in the
   database, behind auth.

## 3. Prerequisites

Phase 01 done.

## 4. Files

```
apps/api/src/
├── utils/requestContext.ts   ADAPT  @pt-api/src/utils/requestContext.ts   (requestId, businessId, userId, messageId; keep runAsSystem/systemScope — Phase 10's tenant plugin needs them)
├── utils/logger.ts           ADAPT  @pt-api/src/utils/logger.ts           (+ redact paths below)
├── middleware/requestId.ts   COPY   @pt-api/src/middleware/requestId.ts
└── app.ts · constants/env.ts ADAPT  (requestId first; LOG_LEVEL, SERVICE_NAME)
```

## 5. Concepts

Logs say **what happened to which message**, never **what the message said**:

```
INFO pipeline step done  {requestId, businessId, messageId, step:"classify", category:"booking", latencyMs:812}
```

not `{ body: "hi my number is 98765…" }`. Redaction in the logger is the backstop for code that
forgets.

## 6. Steps

Copy the three files. In `REDACT_PATHS`, keep the auth entries and add:

```ts
// Customer personal data (spec §8). Lives in Mongo behind auth, never in logs.
"body", "*.body", "text", "*.text", "html", "*.html", "draft", "*.draft", "finalText", "*.finalText",
"fromName", "*.fromName", "fromContact", "*.fromContact", "email", "*.email", "phone", "*.phone",
"customer_name", "*.customer_name", "rawOutput", "*.rawOutput",
// Per-business Gmail tokens (Phase 23).
"refreshToken", "*.refreshToken", "tokenSealed", "*.tokenSealed",
```

Rename the context fields as listed above. In the PaperTrail version, the tenant field is `orgId`.
Phase 10 maps business = org, so either keep `orgId` internally or rename consistently in **all**
copied files. Pick one now: **keep `orgId` internally, call it "business" in the UI and API paths**.
That keeps every PaperTrail file copyable unchanged. Write the decision into `tasks/lessons.md`.

## 7. Verify

Request ids on responses. A temporary
`logger.info({ body: "my number 9876543210", email: "a@b.c", fromName: "Ravi" }, "check")` prints
`[redacted]` for all three. `diff -q` `requestId.ts`.

## 8. Definition of done

- [ ] Message PII and tokens redacted; the decision about `orgId` recorded.
- [ ] Commit: `feat(api): logging with PII redaction`.

## 9. Interview angle

*"How do you handle customer data in logs?"* Logs carry ids, not content. Redaction is configured in
the logger, so nobody has to remember.
