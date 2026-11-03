# Phase 06 — Rate limiting (+ intake limiters)

## 1. Goal

Copy PaperTrail's rate limiter, which is e-commerce's limiter unchanged. It is effectively a small
library:
- three atomic Lua scripts (sliding window, punitive lockout, dual bucket);
- a Redis store with a circuit breaker and an in-memory fallback;
- trusted-proxy client-IP extraction;
- an anonymous `visitorId` cookie;
- a global dual-bucket limiter;
- the auth limiters.

Then declare the limiters for the **public intake form**, the one endpoint anyone on the internet can
hit and the one whose every accepted request costs model calls. They're attached in Phase 13:
- a visitor + IP dual bucket;
- a punitive per-IP lockout;
- a per-form burst limiter;
- a **per-business daily intake cap** that holds messages instead of rejecting them.

Remove the Phase 05 placeholders in `auth.route.ts` and restore PaperTrail's exact limiter wiring.

## 2. What I will understand after this phase

1. Why the check must be a Lua script (atomic) and not `INCR` + `EXPIRE` from Node.
2. Sliding window vs fixed window, and why the sliding window uses a sorted set.
3. Punitive lockout vs plain window, and why the login *account* axis is deliberately not punitive.
4. How the dual bucket charges both or neither.
5. How the circuit breaker keeps the API up when Redis is sick.
6. Why a public form needs four layers, and why the last one **holds** instead of returning 429.
7. Why the widget can't rely on a `visitorId` cookie, and what it sends instead.

## 3. Prerequisites

- Phase 05 done (`authenticate`, `/auth/me`, Google sign-in).
- `docker compose up -d redis` (`enquiry-redis` on :6379, `noeviction`, from Phase 00).

## 4. Files

```
apps/api/src/
├── config/
│   ├── redis.ts                      COPY   @pt-api/src/config/redis.ts            (all three ioredis configs; the cache one is used in Phase 07)
│   └── rateLimiter.ts                ADAPT  @pt-api/src/config/rateLimiter.ts      (drop upload/document/api-key/org limiters; add intake limiters)
├── constants/
│   ├── rateLimiter.constant.ts       ADAPT  @pt-api/src/constants/rateLimiter.constant.ts  (+ INTAKE_* prefixes)
│   └── env.ts                        ADAPT  (+ REDIS_*, TRUSTED_PROXY_CIDRS, DEBUG_IP_ENDPOINT, INTAKE_DAILY_CAP)
├── types/rateLimiter.types.ts        COPY   @pt-api/src/types/rateLimiter.types.ts
├── utils/rateLimiter/
│   ├── circuitBreaker.ts             COPY   @pt-api/src/utils/rateLimiter/circuitBreaker.ts
│   ├── ipExtractor.ts                COPY   @pt-api/src/utils/rateLimiter/ipExtractor.ts
│   ├── luaScript.ts                  COPY   @pt-api/src/utils/rateLimiter/luaScript.ts
│   ├── memoryStore.ts                COPY   @pt-api/src/utils/rateLimiter/memoryStore.ts
│   ├── redisStore.ts                 COPY   @pt-api/src/utils/rateLimiter/redisStore.ts
│   └── index.ts                      COPY   @pt-api/src/utils/rateLimiter/index.ts
├── services/intakeCap.service.ts     NEW    (checkIntakeCap: the per-business daily cap, used by Phase 13)
├── middleware/
│   ├── rateLimiter.ts                COPY   @pt-api/src/middleware/rateLimiter.ts
│   └── visitorId.ts                  COPY   @pt-api/src/middleware/visitorId.ts
├── types/express.d.ts                ADAPT  (resolve Phase 04's comment: + visitorId?: string)
├── routes/auth.route.ts              ADAPT  (= @pt-api/src/routes/auth.route.ts limiter wiring; replaces the Phase 05 placeholders)
└── app.ts                            ADAPT  (trust proxy, visitorId, globalLimiter, /debug-ip; as @pt-api/src/app.ts)
```

All COPY sources are themselves byte-identical to `@ec-api/src/utils/rateLimiter/*` and
`@ec-api/src/middleware/{rateLimiter,visitorId}.ts`; PaperTrail only added comments. Diff against
`@pt-api`, because that's the version whose imports match this repo.

```bash
pnpm --filter api add ioredis@^5.11.1 ipaddr.js@^2.5.0 proxy-addr@^2.0.8
pnpm --filter api add -D @types/proxy-addr@^2.0.3
```

## 5. Concepts

**Atomic or wrong.** "Read the count, compare, increment" from Node is three round trips. Two
requests can both read 9 under a limit of 10 and both pass. Each Lua script runs as one command inside
Redis, so the check and the write can't interleave.

**Sliding window.** A fixed window (`INCR` a per-minute key) lets 2× the limit through at a minute
boundary. The sliding window keeps a sorted set of hit timestamps per key, drops those older than the
window, counts the rest and adds the new hit only if it's allowed. Exact, at the cost of one set
member per hit, which is fine at these limits.

**Punitive.** Once the limit is exceeded, a lock key is set with a TTL and the counter resets. Every
request is rejected until the lock expires. Good for an IP walking a password list. Bad for a key
anyone can choose: the login **account** limiter is a plain window, because anyone can type a
victim's email, and a lockout there would let anyone lock anyone out.

**Dual bucket.** One script checks a visitor bucket and an IP bucket together. If either rejects,
**neither is charged**. A visitor blocked by a noisy neighbour's IP bucket doesn't also burn their own
budget.

**Circuit breaker.** After 10 Redis failures, the store goes `OPEN` and serves from an in-memory store
with the same semantics for 30 s, then `HALF_OPEN` sends one probe. Limits become per process during
an outage (looser, not off). A sick Redis never blocks traffic.

**Client IP.** `CF-Connecting-IP` is believed only when the TCP peer is in `TRUSTED_PROXY_CIDRS`.
Otherwise `proxy-addr` walks `X-Forwarded-For` from the right and stops at the first untrusted hop.
Express's `trust proxy` uses the same function, so `req.ip` and the limiter agree.

### Spam on a public form is a cost attack

Every accepted submission triggers three model calls (classify, extract, draft). A bot posting the
form 10,000 times is 30,000 calls on the business's budget. The layers, cheapest first:

| # | Layer | Where | Behaviour |
| --- | --- | --- | --- |
| 1 | Honeypot field + minimum fill time (2 s) | Phase 13/14 | silently accepted, never stored |
| 2 | `intakeDualLimiter`: visitor 5 / 10 min **and** IP 30 / 10 min | here, attached in 13 | 429 |
| 3 | `intakePunitiveLimiter`: IP over 60 / hour → locked 1 hour | here, attached in 13 | 429 |
| 4 | `intakeFormLimiter`: one form, 120 / 10 min (burst against one business) | here, attached in 13 | 429 |
| 5 | **Per-business daily cap** (`INTAKE_DAILY_CAP`, default 300 / 24 h) | `checkIntakeCap`, called in 13 | **message stored, pipeline not started** |
| 6 | The classifier's `spam` category | Phase 16 | stops after one cheap call |

Why the IP bucket is generous: a college campus, an office or a mobile carrier puts hundreds of people
behind one address. The visitor bucket does the fine-grained work; the IP bucket catches the obvious
flood.

**Why layer 5 holds instead of rejecting.** A 429 at the cap would drop real customers' messages on
the business's busiest day, which is worse for the owner than a large AI bill. Over the cap the message
is still saved, but no `message.received` outbox event is written, so no model is called. Staff see it
with a "daily AI limit reached" note and can reprocess it (Phase 23) or raise the cap. The cap counts
**accepted** messages, so layers 2–4 rejections don't use it up.

**The visitor key on a widget.** The widget runs on the business's site and posts to the API's origin.
A `visitorId` cookie there is a third-party cookie, which Safari and Firefox block and Chrome
restricts. So the intake visitor key is, in order: an `X-Enquiry-Visitor` header (a random id the
widget keeps in `localStorage`, Phase 14), else the cookie, else the IP. The header is trivially
spoofable, and that's acceptable: it's a **fairness** key, not a security boundary. The IP bucket
beside it is what a spoofer can't escape.

## 6. Steps

1. Copy the COPY files and `diff` each against its source (expect no output):
   ```bash
   for f in utils/rateLimiter/{circuitBreaker,ipExtractor,luaScript,memoryStore,redisStore,index}.ts \
            middleware/{rateLimiter,visitorId}.ts types/rateLimiter.types.ts config/redis.ts; do
     diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
   ```
2. `env.ts`: add, after the JWT block:
   ```ts
   export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");
   export const DEBUG_IP_ENDPOINT = getEnv("DEBUG_IP_ENDPOINT", "false");
   export const REDIS_HOST = getEnv("REDIS_HOST");
   export const REDIS_PORT = getEnv("REDIS_PORT");
   export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
   export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");
   // Accepted form/email messages per business per 24 h before new ones are held (Phase 13).
   export const INTAKE_DAILY_CAP = getEnv("INTAKE_DAILY_CAP", "300");
   ```
   `config/redis.ts` imports `CACHE_REDIS_*` too. Add those four lines now, exactly as in
   `@pt-api/src/constants/env.ts` (defaulting to the queue instance's host and port 6380), so the COPY
   file compiles. The cache itself is Phase 07. `.env.example` gains `REDIS_HOST=localhost`,
   `REDIS_PORT=6379`.
3. `constants/rateLimiter.constant.ts`: start from PaperTrail's file. Delete `UPLOAD_PRESIGN_PREFIX`,
   `DOCUMENT_WRITE_PREFIX`, `API_KEY_PREFIX`, `ORG_PREFIX`. Keep `INVITE_SOURCE_PREFIX` and
   `INVITE_TARGET_PREFIX` (staff invites, Phase 11). Add:
   ```ts
   export const INTAKE_VISITOR_PREFIX = "rl:intake:visitor";
   export const INTAKE_IP_PREFIX = "rl:intake:ip";
   export const INTAKE_IP_PUNITIVE_PREFIX = "rl:intake:ip:punitive";
   export const INTAKE_FORM_PREFIX = "rl:intake:form";
   export const INTAKE_CAP_PREFIX = "rl:intake:cap";
   export const TEN_MINUTES_MS = 10 * 60 * 1000;
   ```
4. `config/rateLimiter.ts`: start from PaperTrail's file. Delete `callerKeyResolver`,
   `uploadPresignLimiter`, `documentWriteLimiter`, `apiKeyLimiter` and `orgApiLimiter`. Keep everything
   else: global, all auth limiters, `protectedApiLimiter`, both invite limiters. Append:
   ```ts
   /*
     Intake (Phase 13). The widget posts cross-site, where a visitorId cookie is a blocked
     third-party cookie, so the widget sends its own random id. It's a fairness key, not a security
     boundary: the IP bucket beside it is what a spoofer can't escape.
    */
   const VISITOR_HEADER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
   const intakeVisitorKeyResolver = (req: Request): string => {
       const header = req.get("x-enquiry-visitor");
       if (header && VISITOR_HEADER_PATTERN.test(header)) return `w:${header}`;
       return visitorKeyResolver(req);
   };

   // A person might send two or three messages; five in ten minutes from one browser is a script.
   // The IP pool is generous because campuses and carriers put hundreds of people on one address.
   export const intakeDualLimiter = createDualRateLimiter({
       visitorPrefix: INTAKE_VISITOR_PREFIX,
       ipPrefix: INTAKE_IP_PREFIX,
       windowMs: TEN_MINUTES_MS,
       visitorLimit: 5,
       ipLimit: 30,
       visitorKeyResolver: intakeVisitorKeyResolver,
       ipKeyResolver: (req: Request) => extractClientIp(req),
   });

   // A source that keeps going past the pool is a bot: lock it out for an hour.
   export const intakePunitiveLimiter = createRateLimiter({
       prefix: INTAKE_IP_PUNITIVE_PREFIX,
       windowMs: ONE_HOUR_MS,
       blockDurationMs: ONE_HOUR_MS,
       max: 60,
       keyResolver: ipKeyResolver,
   });

   // A distributed flood against one business's form. Keyed by the public form key from the URL.
   export const intakeFormLimiter = createRateLimiter({
       prefix: INTAKE_FORM_PREFIX,
       windowMs: TEN_MINUTES_MS,
       max: 120,
       keyResolver: (req: Request) => `form:${String(req.params.formKey ?? "unknown")}`,
   });
   ```
   Order on the route (Phase 13): `intakePunitiveLimiter, intakeDualLimiter, intakeFormLimiter`. The
   punitive check goes first so a locked bot costs one Redis call.
5. `services/intakeCap.service.ts`:
   ```ts
   import { getDefaultStore } from "../middleware/rateLimiter";
   import { INTAKE_CAP_PREFIX, ONE_DAY_MS } from "../constants/rateLimiter.constant";
   import { INTAKE_DAILY_CAP } from "../constants/env";

   export type IntakeCapResult = { withinCap: boolean; count: number; cap: number };

   /*
     The per-business cap. Unlike the limiters it never rejects: over the cap the caller still saves
     the message but doesn't start the pipeline, so a flood can't run up the model bill and a real
     customer's message is never lost. A sliding 24 h window (not a calendar day) needs no timezone
     and can't be gamed at midnight. It runs on the limiter's store, so it inherits the circuit
     breaker: with Redis down the count is per process, which is looser, never stricter.
     Call it only for messages that will be stored, after the honeypot and the limiters.
    */
   export const checkIntakeCap = async (orgId: string): Promise<IntakeCapResult> => {
       const cap = Number(INTAKE_DAILY_CAP);
       const result = await getDefaultStore().increment(`${INTAKE_CAP_PREFIX}:${orgId}`, ONE_DAY_MS, cap);
       return { withinCap: result.allowed, count: result.totalHits, cap };
   };
   ```
6. `types/express.d.ts`: replace Phase 04's `// Phase 06: visitorId.` with `visitorId?: string;`
   (optional: requests before `visitorIdMiddleware`, and every job, have none). Keep the
   `// Phase 10:` part of the comment.
   `routes/auth.route.ts`: replace the Phase 05 `// Phase 06:` placeholders with PaperTrail's limiter
   chains, route for route (`@pt-api/src/routes/auth.route.ts` lines 41–55): register, login (source,
   account, pair), refresh (source, session), verify, resend, forgot (source, account, pair), reset,
   Google (`loginSourceLimiter`), and `protectedApiLimiter` after `authenticate` on `/me`. Then
   `diff` the file against PaperTrail's. The only differences left should be routes this project
   doesn't have.
7. `app.ts` (as `@pt-api/src/app.ts`):
   ```ts
   app.set("trust proxy", trustProxy);          // before anything reads req.ip
   // … requestId, helmet, cors, cookieParser, json …
   app.use(visitorIdMiddleware);
   app.use(globalLimiter);
   // Copy PaperTrail's /debug-ip block verbatim (resolvedIp, expressReqIp, tcpPeer,
   // peerIsTrustedProxy, visitorId, the proxy headers), declared before the routers.
   ```
   `globalLimiter` must come after `cookieParser` (it reads the cookie) and before every router.
8. `index.ts`: copy PaperTrail's production warning when `TRUSTED_PROXY_CIDRS` is empty
   (`@pt-api/src/index.ts`, the `NODE_ENV === "production" && !TRUSTED_PROXY_CIDRS.trim()` block).
   Behind Render's proxy, an empty list means every request appears to come from the proxy, and the IP
   buckets become one global bucket. Use `/debug-ip` once after the first deploy (Phase 32) to set the
   list, then switch it off.

## 7. Verify

```bash
docker compose up -d redis && pnpm --filter api dev
curl -si -X POST localhost:5000/auth/login -H 'content-type: application/json' \
  -d '{"email":"a@b.co","password":"wrong-password-1"}' | grep -i x-ratelimit
# X-RateLimit-Limit: 10
# X-RateLimit-Remaining: 9

for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:5000/auth/login \
  -H 'content-type: application/json' -d '{"email":"a@b.co","password":"wrong-password-1"}'; done; echo
# 401 401 401 401 401 401 401 401 401 401 429      (the 11th is locked out for 30 min)

DEBUG_IP_ENDPOINT=true pnpm --filter api dev   # in another terminal, then:
curl -s localhost:5000/debug-ip
# {"status":"success","data":{"resolvedIp":"::1","expressReqIp":"::1","tcpPeer":"::1","peerIsTrustedProxy":false,"visitorId":"…",…}}

# Circuit breaker: stop Redis and the API keeps answering (memory fallback).
docker stop enquiry-redis
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/health        # 200
docker start enquiry-redis

# The cap (from a REPL or a throwaway script with INTAKE_DAILY_CAP=2):
pnpm --filter api exec tsx -e 'import("./src/services/intakeCap.service").then(async m => {
  for (let i = 0; i < 3; i++) console.log(await m.checkIntakeCap("00000000-0000-7000-8000-000000000001")); process.exit(0) })'
# { withinCap: true, count: 1, cap: 2 }  { withinCap: true, count: 2, cap: 2 }  { withinCap: false, count: 2, cap: 2 }

pnpm --filter api typecheck && pnpm --filter api lint
```

The intake limiters themselves are exercised in Phase 13's Verify, once the route exists.

## 8. Definition of done

- [ ] Every COPY file is identical to `@pt-api` (`diff -q` prints nothing).
- [ ] `auth.route.ts` has PaperTrail's limiter chains; no `// Phase 06:` comments remain anywhere.
- [ ] `globalLimiter` and `visitorIdMiddleware` are mounted; `trust proxy` uses `trustProxy`.
- [ ] Intake limiters and `checkIntakeCap` exist and compile (attached in Phase 13).
- [ ] With Redis stopped, the API still serves requests.
- [ ] `.env.example` lists every new variable.
- [ ] Commit: `feat(api): rate limiting with intake limiters and the daily intake cap`.

## 9. Interview angle

*"What stops a bot from running up a business's AI bill through the public form?"* Layers, cheapest
first. A honeypot and a fill-time check stop dumb bots for free. A visitor-plus-IP dual bucket and a
punitive IP lockout stop scripts. A per-form limit stops a distributed flood. The last layer is a
daily cap per business, and it doesn't reject: over the cap the message is saved but no model is
called, because losing a real customer's message is worse than a bill. The classifier's spam category
only comes after all that, because it's the one layer that costs money.

*"Your widget sends a visitor id in a header. Can't a bot fake it?"* Yes, and that's fine. It's a
fairness key, so one person's retries don't eat their neighbour's budget. It isn't a security
boundary. The IP bucket next to it is the part a bot can't spoof, and the dual-bucket script charges
both or neither.
