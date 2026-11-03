# Phase 07 — Response cache

## 1. Goal

Copy PaperTrail's cache-aside layer (e-commerce's cache, ported) onto the second Redis instance
(`redis-cache`, `volatile-lru`):
- versioned namespaces for O(1) invalidation;
- single-flight for concurrent misses;
- a circuit breaker;
- **never throws**: every failure reads as a miss.

Then use it for the one thing that exists so far: the **session check** in `authenticate`. Resolve
Phase 05's `// Phase 07:` comment so `authenticate.ts` becomes byte-identical to PaperTrail's, and make
sure `revokeSessions` clears the cached state.

Declare this project's versioned domains (`inbox | stats`; the info sheet uses a per-business key) and say exactly who reads and bumps each one,
so Phases 12, 23, 24 and 27 only fill in calls.

## 2. What I will understand after this phase

1. Why a cache must be allowed to evict and a queue must not, and why that takes two Redis instances.
2. Versioned namespaces vs deleting keys, and the stale-write race they close.
3. Single-flight: one database query per expired hot key, not one per request in flight.
4. Why the session check fails **closed** when Redis is down.
5. Per-entity keys vs versioned domains, and which this project uses where.
6. Why the cache's ioredis config gives up after 300 ms and disables the offline queue.

## 3. Prerequisites

- Phase 06 done (`config/redis.ts` with `getCacheRedisConfig`, `CACHE_REDIS_*` in `env.ts`).
- `docker compose up -d redis-cache` (`enquiry-redis-cache` on :6380).

## 4. Files

```
apps/api/src/
├── utils/cache/
│   ├── cache.ts                  ADAPT  @pt-api/src/utils/cache/cache.ts   (CacheDomain + its comment only)
│   └── index.ts                  COPY   @pt-api/src/utils/cache/index.ts
├── constants/env.ts              ADAPT  (+ CACHE_ENABLED; CACHE_REDIS_* already added in Phase 06)
├── middleware/authenticate.ts    ADAPT       resolve the Phase 05 comment: identical to @pt-api/src/middleware/authenticate.ts except Phase 05's log-context line
├── services/auth.service.ts      ADAPT  revokeSessions clears cache:session:<id> (as @pt-api/src/services/auth.service.ts)
├── app.ts                        ADAPT  /health reports `redis` from cache.ping() (as @pt-api/src/app.ts)
└── index.ts                      ADAPT  cache.close() in the shutdown sequence (as @pt-api/src/index.ts)
```

No new dependencies (ioredis came in Phase 06).

## 5. Concepts

**Two Redis instances.** The queue and limiter instance is `noeviction`: if BullMQ's keys were evicted
under memory pressure, jobs would vanish silently. A cache that can't evict grows until Redis refuses
writes. One instance can't be both. `redis-cache` runs `volatile-lru`, 256 MB, no persistence. It
evicts only keys with a TTL, and every cache entry has one. The version counters (`cache:ver:<domain>`)
deliberately don't, so they're never evicted. An empty cache after a restart is the correct state.

**Cache-aside that never throws.** `getOrSet(key, fetcher, ttl)` reads Redis; on a miss it runs the
fetcher, writes the result without awaiting, and returns it. Redis down, slow, not yet connected, or
`CACHE_ENABLED=false` all mean "miss". The caller reads Postgres as if there were no cache. The
circuit breaker (the limiter's `RedisCircuitBreaker` class, reused) stops a hung Redis from adding its
timeout to every request.

**Why 300 ms and no offline queue.** A miss costs one Postgres query, a few milliseconds. Waiting a
second for a sick Redis is worse than the query. With the offline queue on, commands issued while
disconnected pile up and replay on reconnect, so a request would wait for Redis to come back. With it
off, they fail instantly, which here means "miss".

**Versioned namespaces.** Each domain has a counter. `versionedKey(["stats"], "org:<id>:30d")` reads
the counters and produces `cache:stats.7:org:<id>:30d`. A write calls `cache.bump("stats")` after it
commits. The counter becomes 8, nobody reads `stats.7` keys again, and they age out by TTL. That's
O(1) however many keys exist. It also closes a race. A slow request that read old rows just before the
write, and writes them back just after it, writes under `stats.7`, which nobody reads.

**Per-entity keys** are for things you can name: `cache:session:<sessionId>`. They're deleted
directly (`cache.del`), because you know exactly which key changed.

**Session check.** A valid JWT only proves the token was issued. `authenticate` also checks the session
row still exists, so logout and "sign out this device" take effect immediately. The confirmed-active
state is cached for 60 s under `cache:session:<id>`, so most requests skip Postgres. Two things keep
that safe:
- **Every revocation goes through `revokeSessions`.** It deletes by id and then deletes each session's
  cache key. A direct `prisma.session.deleteMany` would leave `authenticate` trusting its cache for up
  to a minute.
- **It fails closed.** With Redis down, `cache.get` is a miss, so every request checks Postgres.
  Slower, never less safe.

### This project's domains

```ts
export type CacheDomain = "inbox" | "stats";
```

| Domain | What's cached (key suffix always starts `org:<orgId>`) | TTL | Read by | Bumped by |
| --- | --- | --- | --- | --- |
| `inbox` | the inbox's per-status **counts** (badges, tab totals). Message lists aren't cached: they change every few seconds and SSE keeps them live | 30 s | Phase 23 | every message status change (Phases 13, 21, 24, 28) |
| `stats` | the stats page aggregates (one SQL query per range) | 5 min | Phase 27 | approval, rejection, send result (Phase 24), pipeline completion (Phase 21) |

**The info sheet is a per-entity key, not a domain.** It's read three times for every message
(extract, select, draft), changes rarely, and must be fresh the moment it changes. A draft built from an
old price is exactly the error this product exists to prevent. The entries of one business can be
enumerated, so Phase 12 caches them under `cache:info:<orgId>` (5 min TTL) and `cache.del`s that key
after every info-entry or profile write commits. A versioned `info` domain would work too, but a bump
would retire **every** business's entry for one business's edit. This is e-commerce's own rule:
versioned namespaces for what can't be enumerated, per-entity keys for what can. The delete is the
freshness mechanism; the TTL is a backstop. What a draft was actually allowed to use is recorded
separately (`AiResult.infoEntryIds`, Phase 21), so provenance never depends on the cache.

**Two behaviours of the copied client (seen in the Playbook build, 2 Nov 2026).**
- A fresh process's first cache calls are **misses**: until the client is `ready`, reads fall
  through by design. A script or test that asserts cache behaviour must `await cache.ping()` first.
- Behind a TCP proxy (Docker Desktop's port forwarder locally, a hosted Redis's load balancer in
  production), a **restarted** Redis can leave ioredis "ready" on a dead socket, and the breaker keeps
  the cache off until the API restarts. That's safe here, because every read falls through to
  Postgres and the session check fails closed, so the file stays COPY. Know it when `/health` says
  `cache: down` after a Redis restart: restart the API.

## 6. Steps

1. Copy `utils/cache/index.ts`. Copy `cache.ts` and change only the domain type and its comment:
   ```ts
   /*
     The Enquiry Assistant's domains. Every key's suffix starts with `org:<orgId>`, so one business never
     reads another's entry. `inbox` backs the inbox tab counts (bumped by every message status change);
     `stats` the stats page (bumped by approvals, sends and pipeline completion). Message lists are not
     cached: SSE keeps them live. Sessions (`cache:session:<id>`) and the info sheet
     (`cache:info:<orgId>`, Phase 12) are per-entity keys, not domains.
    */
   export type CacheDomain = "inbox" | "stats";
   ```
   Then `diff` against PaperTrail's: only those lines should differ.
2. `env.ts`: `export const CACHE_ENABLED = getEnv("CACHE_ENABLED", "true");` with PaperTrail's comment
   (the emergency off-switch). `.env.example`: `CACHE_REDIS_HOST=localhost`, `CACHE_REDIS_PORT=6380`.
3. `middleware/authenticate.ts`: Phase 05 left the session lookup reading Postgres on every request,
   with a `// Phase 07:` comment. Replace the body with PaperTrail's `assertSessionActive` (the
   `SESSION_CACHE_TTL_SECONDS = 60` constant, `cache.get(sessionCacheKey(id))` first, the
   `isUuid` + `prisma.session.count` check, then `void cache.set(key, "1", 60)`). The file is now
   PaperTrail's **plus one documented exception**: Phase 05's `setRequestContext({ userId })` line
   (PaperTrail's file doesn't set the log context there). `diff` against
   `@pt-api/src/middleware/authenticate.ts` shows exactly that hunk and nothing else. Put a one-line
   comment above it (`// ADAPT: log context (Phase 05); otherwise identical to PaperTrail`). The
   Playbook made the same exception (its `tasks/lessons.md`).
4. `services/auth.service.ts`: `revokeSessions` gains the cache clear (PaperTrail's version):
   ```ts
   export const revokeSessions = async (where: Prisma.SessionWhereInput) => {
       const sessions = await prisma.session.findMany({ where, select: { id: true } });
       if (sessions.length === 0) return 0;
       const ids = sessions.map((session) => session.id);
       // By id, not by the original filter: a session created after the find is not part of this revocation.
       await prisma.session.deleteMany({ where: { id: { in: ids } } });
       await cache.del(...ids.map(sessionCacheKey));
       return ids.length;
   };
   ```
   Then grep for any other session deletion: `rg "session\.(delete|deleteMany)" apps/api/src`.
   The only hits allowed are inside `revokeSessions` and the Phase 08 `purge-expired` job. Expired
   rows can't have a live cache entry for longer than the 60 s TTL, and `authenticate` re-checks
   `expiresAt` on every miss.
5. `/health` (as PaperTrail):
   ```ts
   app.get("/health", async (_req, res) => {
       const [dbUp, redisReady] = await Promise.all([isDbHealthy(), cache.ping()]);
       return res.status(dbUp ? 200 : 503).json(ok({
           status: dbUp ? "ok" : "degraded",
           database: dbUp ? "up" : "down",
           redis: redisReady ? "up" : "down",
       }));
   });
   ```
   Only the database decides the status code: the app works without the cache.
6. `index.ts` shutdown order: stop accepting connections → close workers (Phase 08) → `cache.close()` →
   `disconnectDB()`, with PaperTrail's force-exit timer.
7. Leave a `// Phase NN:` comment where each domain will be bumped: the intake service (13), the
   pipeline (21), the approval service (24). Don't add the bumps yet. (Phase 12 deletes
   `cache:info:<orgId>` itself.)

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev
curl -s localhost:5000/health
# {"status":"success","data":{"status":"ok","database":"up","redis":"up"}}

# Log in (the account from Phase 04), then:
curl -s -b cookies.txt localhost:5000/auth/me > /dev/null
docker exec enquiry-redis-cache redis-cli --scan --pattern 'cache:session:*'
# cache:session:0193…                     (the session is cached)
docker exec enquiry-redis-cache redis-cli TTL "cache:session:<id>"
# (integer) 5x                            (≤ 60)

# Revoke the device from another session (DELETE /session/:id) or log out:
curl -s -b cookies.txt -X POST localhost:5000/auth/logout > /dev/null   # use the verb Phase 04 defines
docker exec enquiry-redis-cache redis-cli EXISTS "cache:session:<id>"
# (integer) 0                             (cleared by revokeSessions)
curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt localhost:5000/auth/me
# 401                                     (immediately, not after 60 s)

# Fail closed: stop the cache, authenticated requests still work (from Postgres).
docker stop enquiry-redis-cache
curl -s localhost:5000/health            # … "redis":"down"  (status 200)
curl -s -o /dev/null -w "%{http_code}\n" -b cookies2.txt localhost:5000/auth/me   # 200 for a live session
docker start enquiry-redis-cache

diff ~/Code/paper-trail/apps/api/src/middleware/authenticate.ts apps/api/src/middleware/authenticate.ts   # only the setRequestContext hunk
diff ~/Code/paper-trail/apps/api/src/utils/cache/cache.ts apps/api/src/utils/cache/cache.ts   # only CacheDomain + comment
pnpm --filter api typecheck
```

`cookies2.txt` is a second logged-in session, so the fail-closed check isn't confused by the
revocation above.

## 8. Definition of done

- [ ] `cache.ts` differs from PaperTrail's only in `CacheDomain` and its comment; `index.ts` is COPY.
- [ ] `authenticate.ts` is identical to PaperTrail's except the documented `setRequestContext` line; no `// Phase 07:` comments remain.
- [ ] `revokeSessions` is the only code that deletes live sessions, and it clears `cache:session:*`.
- [ ] `/health` reports `redis`; the status code depends only on the database.
- [ ] The app works with `redis-cache` stopped (sessions checked against Postgres).
- [ ] `// Phase 12/13/21/24:` comments mark where each domain will be bumped.
- [ ] Commit: `feat(api): versioned cache and cached session checks`.

## 9. Interview angle

*"How do you invalidate a cache without deleting keys?"* Versioned namespaces. Each domain has a
counter baked into every key. A write bumps the counter after it commits, so old keys are never read
again and expire on their own. It's O(1), and it closes the race where a slow reader writes stale data
back after an invalidation: it writes under the old version, which nobody reads.

*"You cache the session check. Doesn't that delay logout?"* No. Revocation has one door,
`revokeSessions`, and it deletes the cache key along with the row, so the next request misses and finds
no session. The 60 s TTL only bounds one narrow race. If Redis is down, every request reads Postgres:
the check fails closed, never open.

*"Why cache the info sheet if correctness matters so much?"* Because it's read three times for every
message and edited a few times a week. Freshness comes from bumping the domain after every write, not
from the TTL. And what a draft was allowed to use is stored on the AI result, so an audit never
depends on what was in the cache.
