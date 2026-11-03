# Phase 07 — Response cache

## 1. Goal

Replace the Phase 04 stub with the real versioned cache. Domains:
- **`stats`**: dashboard aggregates (Phase 25);
- **`infoSheet`**: the business's info sheet as used by the pipeline, read on every draft (Phase 11).

The session and membership checks use their per-entity keys as in PaperTrail.

## 2. What I will understand after this phase

Versioned invalidation (O(1) bumps), single-flight, fail-as-miss, and why the info sheet is a good
cache candidate: read on every message, changed rarely, and must be fresh the moment it changes.

## 3. Prerequisites

Phase 06 done.

## 4. Files

`utils/cache/cache.ts` (ADAPT: domains) and `utils/cache/index.ts` (COPY) from `@pt-api/src/utils/cache/`;
the env, `/health` and shutdown changes as in `~/Code/prompt-lab/docs/phases/phase-07-cache.md`.

## 5. Concepts

```ts
export type CacheDomain = "stats" | "infoSheet";
```

The info sheet key is versioned **per business**: `cache.versionedKey(["infoSheet"], \`biz:${orgId}\`)`
plus a per-business version counter. Simplest: include the business's `infoSheetVersion` (a number on
the business, incremented on every info-sheet change, Phase 11) in the key suffix, so editing one
business never flushes another's.

That same `infoSheetVersion` is stored on each draft (Phase 18), so "which facts did this draft see" is
answerable later.

## 6. Steps

Copy, change the domain type, restore `CACHE_ENABLED`, `/health` with Redis, and `cache.close()` on
shutdown.

## 7. Verify

As in Prompt Lab Phase 07 (session keys appear and disappear; the app works with `redis-cache`
stopped).

## 8. Definition of done

- [ ] Commit: `feat(api): versioned cache`.

## 9. Interview angle

The info sheet is read on every message and changes rarely, so it's cached with a per-business version
that is also stamped on every draft.
