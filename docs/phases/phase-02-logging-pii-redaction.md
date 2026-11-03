# Phase 02 — Logging, request ids, PII redaction

## 1. Goal

Copy PaperTrail's structured logging: pino, an `AsyncLocalStorage` request context, and the
`requestId` middleware that writes one access-log line per request. Then extend the redaction list to
**customer personal data**. This app's logs would otherwise fill up with names, phone numbers, email
addresses and message bodies, which the spec forbids ("never log full email contents in plain server
logs", §8).

Logs say **what happened to which message**, never **what the message said**:

```
INFO pipeline step done {"requestId":"…","orgId":"…","messageId":"…","step":"classify","category":"booking","latencyMs":812}
```

## 2. What I will understand after this phase

1. Why message content and contacts never go to logs: logs are kept longer, copied to more places
   (log drains, laptops, support tickets) and read by more people than the database is.
2. How an id in the context (`messageId`, `orgId`) replaces logging the content: you look the
   message up in the database, behind auth and tenancy, when you need it.
3. How `AsyncLocalStorage` gives every log line its request id without passing it around.
4. Why redaction in the logger is a **backstop**, and the rule is still "don't log content".
5. Why `runAsSystem` lives in the request context file even though tenancy arrives in Phase 03.

## 3. Prerequisites

Phase 01 done.

## 4. Files

```
apps/api/src/
├── utils/requestContext.ts      ADAPT  @pt-api/src/utils/requestContext.ts  (+ messageId, jobId fields; runAsSystem kept)
├── utils/logger.ts              ADAPT  @pt-api/src/utils/logger.ts          (REDACT_PATHS for message PII; drop PDF keys)
├── utils/pii.ts                 ADAPT  @pt-api/src/utils/pii.ts  (keep maskAccount, redactForTrace; + maskEmail, maskPhone, contactRef; Phase 28 extends it)
├── middleware/requestId.ts      COPY   @pt-api/src/middleware/requestId.ts
├── constants/env.ts             ADAPT  (+ LOG_LEVEL, SERVICE_NAME, CONTACT_HASH_SALT)
├── app.ts                       ADAPT  (requestId first)
├── middleware/errorHandler.ts   ADAPT  (console → logger, resolving Phase 01's comments)
├── index.ts · worker.ts         ADAPT  (console → logger)
└── utils/pii.test.ts            NEW    (unit test, runs in Phase 31's Vitest; written now)
```

```bash
pnpm --filter api add pino@^10.4.0
pnpm --filter api add -D pino-pretty@^13.2.0
```

## 5. Concepts

**The request context.** `requestId` middleware opens an `AsyncLocalStorage` store per request
(`runWithRequestContext({ requestId })`). Everything awaited inside that request, however deep, can
read the store. Later phases enrich it with `setRequestContext`: `authenticate` adds `userId` (Phase
05), `resolveOrg` adds `orgId` (Phase 10), the pipeline worker adds `messageId` and `jobId` (Phase
21). pino's `mixin()` copies the store into every line, so a line from deep inside the pipeline says
which business, message and job it belongs to without anyone passing those ids.

`runAsSystem(fn)` sets `systemScope: true`. Phase 03's tenant extension reads it: work that must
cross businesses (the outbox relay, retention, the eval harness) opts out of tenant scoping
explicitly, and the log line shows it. `settleInScope` makes sure a lazy Prisma query starts while
the scope is still active. Keep that function exactly; Phase 03 explains the bug it prevents.

**Redaction is paths, compiled once.** pino's `redact.paths` are compiled into a fast serializer. A
path like `"*.body"` covers one level of nesting, which is where request bodies and job data put
fields (`{ data: { body } }`). It is **not** a deep scan. That's why the rule comes first ("log ids,
not content") and redaction second.

| Category | Paths added (each also as `*.x`) |
| --- | --- |
| Message content | `body`, `subject`, `text`, `html`, `draft`, `draftText`, `finalText`, `rawOutput`, `snippet` |
| Contacts | `fromName`, `fromContact`, `email`, `phone`, `customer_name`, `to`, `from`, `replyTo` |
| Secrets (kept from PaperTrail) | `password`, `token`, `accessToken`, `refreshToken`, `verificationToken`, `resetToken`, `apiKey`, `secret`, `authorization`, `cookie`, `headers.authorization`, `headers.cookie` |
| Per-business Gmail (Phase 25) | `sealedRefreshToken`, `code` (the OAuth callback code) |

PaperTrail's PDF keys (`pageText`, `imageBase64`, `accountNumber`, `transactions`) are dropped:
nothing here produces them.

**The access log never prints a query string.** `requestId` logs `req.originalUrl.split("?")[0]`.
Verification and invite links carry tokens in the path or query. The path form
(`/auth/verify/:token`) is a known trade-off copied from PaperTrail. Tokens are single-use and expire
in minutes, and Phase 05 keeps reset tokens out of URLs entirely.

**Masks for the rare identifying line.** Sometimes a log must say *which* contact, for example
"two form submissions from the same address in 3 seconds". Use `contactRef(contact)` (a salted
SHA-256 prefix, stable within a deployment) or `maskEmail` / `maskPhone`, never the raw value.

## 6. Steps

1. **Copy** `middleware/requestId.ts` (identical).
2. **requestContext.ts.** Copy, then extend the type only:
   ```ts
   type RequestContext = {
       requestId: string;
       orgId?: string;
       userId?: string;
       messageId?: string;   // pipeline + reply jobs (Phase 21, 24)
       jobId?: string;       // any BullMQ job (Phase 08)
       runId?: string;       // eval runs (Phase 29)
       systemScope?: boolean;
   };
   ```
   Everything else (`settleInScope`, `runWithRequestContext`, `runAsSystem`, `getRequestContext`,
   `getRequestId`, `setRequestContext`) stays byte-identical.
3. **env.ts.**
   ```ts
   export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
   export const SERVICE_NAME = getEnv("SERVICE_NAME", "api");
   // Salt for contactRef(): log lines can correlate a contact without containing it. Rotating it
   // only breaks correlation across the rotation, nothing else.
   export const CONTACT_HASH_SALT = getEnv("CONTACT_HASH_SALT");
   ```
   `.env.example`: `LOG_LEVEL=debug`, `SERVICE_NAME=api`,
   `CONTACT_HASH_SALT=` with the comment `# openssl rand -hex 16`. The worker sets
   `SERVICE_NAME=worker` in production (Phase 32).
4. **logger.ts.** Copy, then replace `REDACT_PATHS`:
   ```ts
   const both = (...keys: string[]) => keys.flatMap((key) => [key, `*.${key}`]);

   /*
     Keys whose values never reach a log line. Paths, not a recursive scan: pino compiles them once.
     The rule is still "log ids, not content"; this list is the backstop for code that forgets.
    */
   const REDACT_PATHS = [
       ...both("password", "currentPassword", "newPassword", "token", "accessToken", "refreshToken",
               "verificationToken", "resetToken", "apiKey", "secret", "authorization", "cookie"),
       "headers.authorization", "headers.cookie",
       // Customer messages and contacts (spec §8). They live in PostgreSQL behind auth and tenancy.
       ...both("body", "subject", "text", "html", "snippet", "draft", "draftText", "finalText", "rawOutput"),
       ...both("fromName", "fromContact", "email", "phone", "customer_name", "to", "from", "replyTo"),
       // Per-business Gmail credentials (Phase 25).
       ...both("sealedRefreshToken", "code"),
   ];
   ```
   Keep `canPrettyPrint`, `mixin`, `base`, `timestamp` and the pretty transport exactly.
   One addition for Phase 31's "no PII in logs" test: when the pretty transport is off (always in
   tests), write through a **swappable sink**, so a test can capture what the real `logger` prints
   without every module importing a different instance:
   ```ts
   import type { DestinationStream } from "pino";
   let current: DestinationStream = pino.destination(1);                 // stdout
   const sink: DestinationStream = { write: (line: string) => current.write(line) };
   /** Tests only: send every log line to `stream` (e.g. Phase 31's logCapture). */
   export const setLogDestination = (stream: DestinationStream) => { current = stream; };
   // non-pretty branch: pino({ …options }, sink)
   ```
5. **pii.ts** (ADAPT: copy `@pt-api/src/utils/pii.ts` unchanged, then append):
   ```ts
   import crypto from "node:crypto";
   import { CONTACT_HASH_SALT } from "../constants/env";

   /** "ravi.kumar@gmail.com" → "r***r@gmail.com". Keeps the domain (useful for spotting spam waves). */
   export const maskEmail = (email: string): string => {
       const [local, domain] = email.split("@");
       if (!domain) return "***";
       const head = local.slice(0, 1);
       const tail = local.length > 2 ? local.slice(-1) : "";
       return `${head}***${tail}@${domain}`;
   };

   /** "+91 98765 43210" → "+91 98xxxx3210". Keeps country code and the last 4 digits. */
   export const maskPhone = (phone: string): string => {
       const digits = phone.replace(/\D/g, "");
       if (digits.length < 8) return "xxxx";
       const last4 = digits.slice(-4);
       const prefix = phone.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10)} ` : "";
       const lead = digits.slice(-10, -8);
       return `${prefix}${lead}xxxx${last4}`.trim();
   };

   /** A stable, non-reversible handle for one contact within this deployment: "c_3f9a1b2c". */
   export const contactRef = (contact: string): string =>
       "c_" + crypto.createHash("sha256").update(CONTACT_HASH_SALT + contact.trim().toLowerCase())
           .digest("hex").slice(0, 8);
   ```
   Phase 20 uses `maskPhone` for the `masked_contact` safety check. Phase 28 adds the rest of
   `@pt-api/src/utils/pii.ts` (`redactForTrace`) for audit diffs.
6. **pii.test.ts** (runs once Phase 31 adds Vitest; until then, check with `tsx -e`):
   ```ts
   import { describe, expect, it } from "vitest";
   import { maskEmail, maskPhone, contactRef } from "./pii";

   describe("pii masks", () => {
       it("masks emails but keeps the domain", () => expect(maskEmail("ravi.kumar@gmail.com")).toBe("r***r@gmail.com"));
       it("masks Indian mobiles", () => expect(maskPhone("+91 98765 43210")).toBe("+91 98xxxx3210"));
       it("is stable and case-insensitive", () => expect(contactRef("A@b.co")).toBe(contactRef(" a@b.co ")));
   });
   ```
7. **app.ts:** `app.use(requestId)` as the **first** middleware (so even a helmet or CORS rejection
   carries an id). **errorHandler / index / worker:** replace every `console.*` with `logger.*`,
   resolving the `// Phase 02:` comments.
8. **A rule for every later phase**, written into `tasks/lessons.md` now: *log `messageId`,
   `orgId`, `category`, `stage`, counts and durations; never a body, a contact or a draft.*
9. Commit: `feat(api): structured logging, request ids, PII redaction`.

## 7. Verify

```bash
pnpm --filter api dev
curl -si localhost:5000/health | grep -i x-request-id
# X-Request-Id: 6b0c…   (a UUID)

curl -si -H 'X-Request-Id: my-trace-123' localhost:5000/health | grep -i x-request-id
# X-Request-Id: my-trace-123

curl -si -H 'X-Request-Id: <script>' localhost:5000/health | grep -i x-request-id
# X-Request-Id: <a fresh UUID>       (unsafe incoming ids are replaced)

# The dev terminal shows one line per request, path without query string:
curl -s 'localhost:5000/nope?token=abc' >/dev/null
# INFO request completed {"requestId":"…","method":"GET","path":"/nope","status":404,"durationMs":1}

# Redaction (pnpm --filter … exec runs inside apps/api):
NODE_ENV=production CONTACT_HASH_SALT=x PORT=1 CORS_ORIGIN=x pnpm --filter api exec tsx -e '
const { logger } = require("./src/utils/logger");
logger.info({ body: "my number is 9876543210", fromName: "Ravi", data: { email: "a@b.co", phone: "98765" },
              messageId: "0193…", category: "booking" }, "check");'
# {"level":30,…,"body":"[redacted]","fromName":"[redacted]","data":{"email":"[redacted]","phone":"[redacted]"},
#  "messageId":"0193…","category":"booking","msg":"check"}

CONTACT_HASH_SALT=x NODE_ENV=x PORT=1 CORS_ORIGIN=x pnpm --filter api exec tsx -e \
  'const p=require("./src/utils/pii");console.log(p.maskEmail("ravi.kumar@gmail.com"),p.maskPhone("+91 98765 43210"))'
# r***r@gmail.com +91 98xxxx3210

diff -q ~/Code/paper-trail/apps/api/src/middleware/requestId.ts apps/api/src/middleware/requestId.ts
# (no output)
```

## 8. Definition of done

- [ ] Every response has `X-Request-Id`; unsafe incoming ids are replaced.
- [ ] One access-log line per request, with no query string.
- [ ] Message content, contacts and secrets print as `[redacted]`, top level and one level deep.
- [ ] `requestContext.ts` differs from PaperTrail's only in the context type; `runAsSystem` is kept.
- [ ] `maskEmail`, `maskPhone` and `contactRef` behave as in the tests.
- [ ] No `console.*` left in `apps/api/src` (`grep -rn "console\." apps/api/src` → nothing outside scripts).
- [ ] The "ids, not content" rule is in `tasks/lessons.md`. Committed.

## 9. Interview angle

*"How do you debug a bad draft if you never log the message?"* Every log line carries `orgId`,
`messageId` and the request or job id through `AsyncLocalStorage`. I find the failing line by
`messageId`, then open that message in the app, behind the same auth and tenant rules as everyone
else. The content stays in one place that has access control and a retention policy. Logs get
copied to drains and laptops and are kept for months; a customer's phone number has no business
there.

*"Isn't redaction enough?"* No. pino's redaction is a fixed set of paths, compiled for speed. It
catches the obvious keys at the top level and one level down, and misses a body nested three levels
deep or interpolated into a message string. So the rule is cultural, "log ids, not content", and the
redaction list is the backstop that catches the mistakes.
