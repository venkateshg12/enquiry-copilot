# Phase 01 — API bootstrap: env, errors, envelope, `createApp`, health, shutdown

## 1. Goal

Turn the `apps/api` placeholder into a real Express 5 server with PaperTrail's foundation, before
any feature exists:
- environment validation **at import time** (a missing secret stops the deploy);
- the error trio `AppError` / `appAssert` / `catchError`;
- the `ok()` / `fail()` envelope, used by every response including Zod errors;
- `notFound` and one `errorHandler`, mounted last;
- `createApp()` in `app.ts` (no side effects), `index.ts` that only listens and shuts down, and
  `worker.ts` as the second entry point (empty for now);
- `GET /health`;
- an ordered graceful shutdown with a force-exit timer.

## 2. What I will understand after this phase

1. Why env is read when the module loads, not where a value is used.
2. How `appAssert`'s `asserts condition` signature narrows types after the call.
3. Why `catchError` still earns its place in Express 5, which forwards rejected promises itself.
4. Why the error handler takes four parameters and is mounted last.
5. Why `app.ts`, `index.ts` and `worker.ts` are three files.
6. Why shutdown goes server → workers → pub/sub → cache → database, with a timer.

## 3. Prerequisites

- Phase 00 done (`pnpm build` green, containers healthy).
- Read `@pt-api/src/{app,index,worker}.ts` once end to end: you copy their *shape* now and their
  *contents* phase by phase.

## 4. Files

```
apps/api/
├── .env.example                         ADAPT  @pt-api/.env.example          (only the vars below)
├── package.json                         ADAPT  (+ express, helmet, cors, cookie-parser, dotenv; worker script)
└── src/
    ├── index.ts                         ADAPT  @pt-api/src/index.ts          (listen + shutdown; no DB/cache/workers yet)
    ├── app.ts                           ADAPT  @pt-api/src/app.ts            (helmet, cors, json, cookies, /health, 404, errors)
    ├── worker.ts                        NEW    (entry point; closeWorkers() is a no-op until Phase 08)
    ├── constants/
    │   ├── env.ts                       ADAPT  @pt-api/src/constants/env.ts  (getEnv + NODE_ENV, PORT, CORS_ORIGIN, CLIENT_URL, RUN_WORKERS_IN_API)
    │   ├── https.ts                     COPY   @pt-api/src/constants/https.ts
    │   └── appErrorCode.ts              ADAPT  @pt-api/src/constants/appErrorCode.ts (drop upload/file codes)
    ├── utils/
    │   ├── errors/{appError,appAssert,catchError,index}.ts   COPY  @pt-api/src/utils/errors/
    │   └── api/{apiEnvelope,index}.ts                         COPY  @pt-api/src/utils/api/
    └── middleware/
        ├── notFound.ts                  COPY   @pt-api/src/middleware/notFound.ts
        └── errorHandler.ts              ADAPT  @pt-api/src/middleware/errorHandler.ts (no Sentry until Phase 32; no cookie clearing until Phase 04)
```

Dependencies (versions as PaperTrail, so COPY files compile identically):

```bash
pnpm --filter api add express@^5.2.1 helmet@^8.3.0 cors@^2.8.6 cookie-parser@^1.4.7 dotenv@^17.4.2
pnpm --filter api add -D @types/express@^5.0.6 @types/cors@^2.8.19 @types/cookie-parser@^1.4.10
```

`morgan` is not added: Phase 02's request logger replaces it.

## 5. Concepts

**Fail at boot.** `env.ts` calls `getEnv(key, default?)` for every variable at import time and throws
when one is missing without a default. The alternative (reading `process.env.X` at the point of use)
means a missing `NVIDIA_API_KEY` is discovered by the first customer message, possibly days after a
deploy that "worked". Each later phase adds its own variables here and to `.env.example`, never
earlier: the server must boot with exactly the config the current phase needs.

`CLIENT_URL` defaults to the first `CORS_ORIGIN` entry. It's used for links inside emails (verify,
reset, invite). PaperTrail added this after a comma-joined origin list ended up inside an email link.

**The error trio.**
- `AppError(status, message, errorCode?)`: an `Error` with an HTTP status and a machine code.
- `appAssert(cond, status, message, code?)` is typed `asserts condition`, so after
  `appAssert(message, NOT_FOUND, "Message not found")` TypeScript knows `message` isn't null.
  Services read as a list of rules.
- `catchError(handler)`: Express 5 already forwards rejections, so this is belt-and-braces. It stays
  because every copied controller uses it and it makes "errors go to the handler" explicit.

**The envelope.** `{ status: "success" | "error", data, meta?, errors? }` for every JSON response.
PaperTrail fixed e-commerce's one exception: Zod failures are now inside the envelope, with a
`path` per error, so the web app shows field errors next to fields.

**Why three entry points.**
- `app.ts` exports `createApp()`, which builds the Express app with **no side effects**: no
  `listen`, no DB connection. Supertest imports it directly (Phase 31).
- `index.ts` connects, listens, and shuts down. With `RUN_WORKERS_IN_API !== "false"` it also starts
  the workers in-process (one process in dev and on a free tier).
- `worker.ts` runs only the queue workers and schedulers (`pnpm --filter api worker`), for
  production where a slow model call must never hold an HTTP thread.

**Ordered shutdown.** A deploy sends `SIGTERM`. Stop accepting connections, let in-flight requests
finish, then close workers (they finish the current job), pub/sub, the cache, and the database last,
because everything before it may still write. A 10-second timer force-exits if a keep-alive client
holds the server open. `unhandledRejection` and `uncaughtException` go down the same path, logged.

## 6. Steps

1. **env.ts.** Copy PaperTrail's `getEnv` verbatim (including its message), then only:
   ```ts
   export const NODE_ENV = getEnv("NODE_ENV");
   export const PORT = getEnv("PORT");
   export const CORS_ORIGIN = getEnv("CORS_ORIGIN");
   // Single origin for links inside emails; CORS_ORIGIN may list several.
   export const CLIENT_URL = getEnv("CLIENT_URL", CORS_ORIGIN.split(",")[0].trim());
   // "false" in production, where src/worker.ts runs as its own process.
   export const RUN_WORKERS_IN_API = getEnv("RUN_WORKERS_IN_API", "true");
   ```
   `.env.example`:
   ```
   NODE_ENV=development
   PORT=5000
   # The web app origin(s), comma-separated. The widget is NOT listed: intake CORS is per form (Phase 13).
   CORS_ORIGIN=http://localhost:3000
   CLIENT_URL=http://localhost:3000
   RUN_WORKERS_IN_API=true
   ```

2. **Copy** `constants/https.ts`, `utils/errors/*`, `utils/api/*`, `middleware/notFound.ts`. Run
   `diff -q` against each source.

3. **appErrorCode.ts.** Keep `InvalidAccessToken`, `Forbidden`, `TokenExpired`,
   `GmailNotConfigured`, `GmailAuthInvalid`, `GmailSendFailed`, `ValidationError`, `QuotaExceeded`,
   `TooManyRequests`. Drop `UploadTooLarge`, `UnsupportedFileType`. Later phases append their own
   codes (`BudgetExceeded`, `FormDisabled`, `StrongFlagsNeedReason`, …).

4. **errorHandler.ts.** Copy, then remove the two Sentry lines (Phase 32 adds them back) and the
   refresh-path cookie clearing (Phase 04 adds `clearAuthCookies`, then this line comes back). Keep the
   Zod branch exactly. Until Phase 02, replace `logger.error` with `console.error`; mark it
   `// Phase 02: logger`. Add one branch after the Zod one (the only ADAPT beyond removals), because
   the public intake route will receive malformed bodies from the internet and a 500 there would page
   you for someone else's bug:
   ```ts
   // express.json() rejects a malformed body with a SyntaxError typed "entity.parse.failed".
   if ((error as { type?: string })?.type === "entity.parse.failed") {
       return res.status(BAD_REQUEST).json(fail("Malformed JSON body", appErrorCode.ValidationError));
   }
   if ((error as { type?: string })?.type === "entity.too.large") {
       return res.status(413).json(fail("Request body too large", appErrorCode.ValidationError));
   }
   ```

5. **app.ts.**
   ```ts
   import express from "express";
   import helmet from "helmet";
   import cors from "cors";
   import cookieParser from "cookie-parser";
   import { CORS_ORIGIN, NODE_ENV } from "./constants/env";
   import { ok } from "./utils/api";
   import { notFound } from "./middleware/notFound";
   import { errorHandler } from "./middleware/errorHandler";

   /*
     Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
     the integration tests (Phase 31) call it directly with Supertest.
    */
   export const createApp = () => {
       const app = express();

       // Phase 02: requestId first. Phase 06: trust proxy + limiters.
       app.use(
           helmet({
               crossOriginResourcePolicy: { policy: "cross-origin" },
               hsts: NODE_ENV === "production" ? undefined : false,
           })
       );

       const corsOrigin = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
       app.use(cors({ origin: corsOrigin, credentials: true }));
       // Phase 13: the public intake route is mounted BEFORE this cors() with its own per-form CORS.

       app.use(express.json({ limit: "100kb" }));   // messages are ≤ 5,000 chars; nothing here is big
       app.use(cookieParser());

       // Health first, so routers that call router.use(authenticate) can never shadow it.
       app.get("/health", (_req, res) => {
           // Phase 03: database. Phases 06–07: redis, cache.
           res.status(200).json(ok({ status: "ok" }));
       });

       // Routes are registered here, phase by phase.

       app.use(notFound);
       app.use(errorHandler);
       return app;
   };
   ```
   Note the JSON limit: PaperTrail uses `1mb` for document metadata. Here a request body is a message
   or a form; 100 kB is generous and caps abuse of the public intake route.

6. **worker.ts.**
   ```ts
   import "dotenv/config";

   /*
     The queue workers' entry point. Phase 08 adds the email worker, Phase 13 the outbox relay,
     Phase 21 the pipeline worker. index.ts imports closeWorkers/initSchedulers when it runs them
     in-process (RUN_WORKERS_IN_API=true).
    */
   export const initSchedulers = async () => {};
   export const startRelay = () => {};
   export const closeWorkers = async () => {};

   if (require.main === module) {
       console.log("worker started (no workers until Phase 08)"); // Phase 02: logger
   }
   ```

7. **index.ts.** Adapt PaperTrail's: keep `main()`, the `RUN_WORKERS_IN_API` branch (calling the
   no-op `initSchedulers()` / `startRelay()`), `app.listen(PORT, "0.0.0.0")`, and the whole shutdown
   block with `SHUTDOWN_GRACE_MS = 10_000`. Remove `instrument`, `connectDB`/`disconnectDB`, `cache`,
   `closePubSub`, `setCallRecorder` and `flushObservability`, and leave a comment where each returns:
   ```ts
   // Phase 03: await connectDB() / disconnectDB()
   // Phase 07: await cache.close()
   // Phase 15: setCallRecorder(recordCall)
   // Phase 21: await closePubSub()
   // Phase 32: import "./instrument" first; await flushObservability()
   ```

8. **Scripts.** In `apps/api/package.json` add `"worker": "tsx watch src/worker.ts"` and
   `"start:worker": "node dist/worker.js"`.

9. `cp apps/api/.env.example apps/api/.env`, run, verify, commit
   `feat(api): bootstrap (env, errors, envelope, createApp, health, shutdown)`.

## 7. Verify

```bash
pnpm --filter api dev
# Server is listening to the port: 5000

curl -s localhost:5000/health
# {"status":"success","data":{"status":"ok"}}

curl -s localhost:5000/nope
# {"status":"error","data":null,"errors":[{"message":"Route not Found: GET /nope"}]}

curl -s -X POST localhost:5000/health -H 'content-type: application/json' -d '{bad'
# HTTP 400 {"status":"error","data":null,"errors":[{"message":"Malformed JSON body","code":"VALIDATION_ERROR"}]}

curl -sI localhost:5000/health | grep -i -E "x-content-type-options|x-frame-options"
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN

# Fail at boot:
CORS_ORIGIN= pnpm --filter api exec tsx src/index.ts
# Error: Missing Environment varaible CORS_ORIGIN

# Ordered shutdown (Ctrl-C in the dev terminal):
# [shutdown] SIGINT — closing
# [shutdown] complete

for f in constants/https.ts utils/errors/appError.ts utils/errors/appAssert.ts utils/errors/catchError.ts \
         utils/api/apiEnvelope.ts middleware/notFound.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
# (no output)
```

## 8. Definition of done

- [ ] `/health` answers in the envelope; unknown routes 404 in the envelope.
- [ ] Removing a required env var stops the server at startup with a clear message.
- [ ] `createApp()` has no side effects (importing `app.ts` doesn't listen or connect).
- [ ] `worker.ts` runs on its own (`pnpm --filter api worker`) and exits cleanly.
- [ ] Ctrl-C prints the shutdown lines; a hung request is cut off after 10 s.
- [ ] Every COPY file is identical to its PaperTrail source; every removed line has a `// Phase NN:`
      comment.
- [ ] `pnpm typecheck && pnpm lint` green. Committed.

## 9. Interview angle

*"Walk me through how an error becomes a response."* A service calls
`appAssert(reply, NOT_FOUND, "Reply not found")`. That throws an `AppError` with a status. The
controller is wrapped in `catchError`, which forwards it to `next`. The single error handler at the
end of the chain maps `ZodError` to a 400 with field paths, `AppError` to its own status and code,
and anything else to a 500 that's logged but never leaks a stack trace. Every response, including
validation failures, has the same envelope, so the web app has one error path.

*"Why split app.ts and index.ts?"* My e-commerce backend built the app inside `main()`, so it couldn't
be tested without a port and a live database. Here `createApp()` is pure, the integration tests
import it with Supertest, and `index.ts` is only process lifecycle. `worker.ts` is a third entry
point, so a slow model call in production runs in a process that serves no HTTP.
