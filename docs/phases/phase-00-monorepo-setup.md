# Phase 00 — Monorepo, packages, docker-compose

## 1. Goal

Create the empty but **building** monorepo every later phase lands in:
- pnpm + Turborepo at the root, configured like PaperTrail (itself copied from e-commerce);
- three shared packages: `@repo/types` (Zod schemas shared by API, web and widget),
  `@repo/typescript-config`, `@repo/eslint-config`;
- three app placeholders: `apps/api` (Express, CommonJS), `apps/web` (Next.js, Phase 09),
  `apps/widget` (Vite library, Phase 14);
- a `docker-compose.yml` with exactly the infrastructure this project needs: **PostgreSQL 17**,
  `redis` (noeviction) and `redis-cache` (volatile-lru). No MinIO: there are no file uploads.

At the end, `pnpm build`, `pnpm typecheck` and `pnpm lint` are green on an almost empty repo, and
`docker compose up -d` brings up three healthy containers.

## 2. What I will understand after this phase

1. Why the repo is a monorepo at all: `@repo/types` is the one place a request shape, a pipeline
   contract or a label format is defined, and the API, the web app, the widget and the eval scripts
   all import it.
2. Why `@repo/types` builds to **CommonJS** (`dist/`) while the web app could read TypeScript source.
3. Why there are **two** Redis instances with different eviction policies.
4. Why `apps/api` is CommonJS + `tsx` and not ESM: COPY files from PaperTrail must stay identical.
5. What Turborepo's `dependsOn: ["^build"]` does for `typecheck` (packages build before apps check).

## 3. Prerequisites

- Node ≥ 20 (`node -v`), pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`).
- Docker with Compose v2 (`docker compose version`).
- Read [../reference/architecture.md](../reference/architecture.md) §2 (layout) and
  [../reference/inherited-architecture.md](../reference/inherited-architecture.md) (shorthands).
- Nothing else is running on ports 5432, 6379, 6380 (stop PaperTrail's stack: `cd ~/Code/paper-trail
  && docker compose down`).

## 4. Files

```
ai-enquiry-assistant/
├── package.json                      ADAPT  @pt-root/package.json          (name; same scripts and devDependencies)
├── pnpm-workspace.yaml               COPY   @pt-root/pnpm-workspace.yaml
├── turbo.json                        COPY   @pt-root/turbo.json
├── .prettierrc                       COPY   @pt-root/.prettierrc
├── .gitignore                        COPY   @pt-root/.gitignore           (+ apps/api/src/generated/, apps/api/evals/reports/*.json is NOT ignored)
├── Makefile                          ADAPT  @pt-root/Makefile             (drop load/minio targets; keep up/down/test/test-int/eval/db-migrate)
├── docker-compose.yml                ADAPT  @pt-root/docker-compose.yml   (postgres + redis + redis-cache only)
├── packages/
│   ├── typescript-config/            COPY   @pt-root/packages/typescript-config/   (base.json, nextjs.json, react-library.json, package.json)
│   ├── eslint-config/                COPY   @pt-root/packages/eslint-config/       (base.js, next.js, react-internal.js, package.json)
│   └── types/
│       ├── package.json              COPY   @pt-root/packages/types/package.json
│       ├── tsconfig.json             COPY   @pt-root/packages/types/tsconfig.json
│       └── src/
│           ├── index.ts              NEW    (re-exports; grows each phase)
│           ├── api.ts                COPY   @pt-root/packages/types/src/api.ts       (envelope schemas)
│           ├── id.ts                 COPY   @pt-root/packages/types/src/id.ts        (UUID id schema)
│           └── pagination.ts         COPY   @pt-root/packages/types/src/pagination.ts (cursor query)
└── apps/
    ├── api/{package.json,tsconfig.json,eslint.config.mjs,src/index.ts}   NEW placeholder (Phase 01 fills it)
    ├── web/README.md                 NEW    placeholder (Phase 09)
    └── widget/README.md              NEW    placeholder (Phase 14)
```

`user.ts`, `cookie.ts` and `org.ts` are **not** copied yet: they arrive with the phases that use them
(04, 10). Copying them now would pull `@types/express` usage into a package nothing imports yet.

## 5. Concepts

**One source of truth for shapes.** PaperTrail's `@repo/types` holds every Zod schema that crosses
a process boundary. Here that includes the pipeline contracts
([pipeline-contracts.md](../reference/pipeline-contracts.md)): `classifyOutput` is used by the API to
validate the model's answer, by the web app to type the inbox row, and by `evals/run.ts` to score it.
Three copies of one shape drift; one copy can't.

**Why CommonJS for the package.** `apps/api` is CommonJS (so COPY files keep `require` semantics and
`tsx` runs them unchanged). A CommonJS consumer can't `require` an ESM-only package. `@repo/types`
builds with `tsc` to `dist/` as CommonJS, and Next.js can consume CommonJS fine. This is PaperTrail's
setup, kept as-is.

**Two Redis instances** (e-commerce's lesson, unchanged):

| Instance | Policy | Holds | Why |
| --- | --- | --- | --- |
| `redis` :6379 | `noeviction`, AOF on | BullMQ queues, rate-limit counters, pub/sub | an evicted job is a lost customer message or a reply never sent |
| `redis-cache` :6380 | `volatile-lru`, 256 MB, no persistence | response cache, session check | a cache that can't evict grows until it falls over; an empty cache after restart is correct |

**PostgreSQL 17, locally in Docker.** Production is Neon. The local container uses the same major
version so `prisma migrate` produces the same SQL in both. Migrations are applied by Prisma (Phase
03), never by the app at runtime.

**Turborepo pipeline.** `build` depends on `^build` (dependencies first), so `@repo/types` compiles
before `apps/api` typechecks against its `dist/` types. `dev` is uncached and persistent.

**Pin, don't `pnpm add` bare (learned building the Playbook, 2 Nov 2026).** A bare
`pnpm add -D typescript` installs TypeScript 7, and the latest `eslint-*` plugins want ESLint 10,
while the copied `@repo/eslint-config` is on **ESLint 9**. Keep exactly the versions written here:
`typescript` **5.9.2** at the root and PaperTrail's `^6.0.3` in `apps/api` (as `@pt-api`), and
`eslint` `^9`. Add a plugin only at a version whose peer range includes ESLint 9. And `@repo/types` is
consumed through its **built `dist/`**, never through a `paths` alias to its source: it's
`"type": "commonjs"`, and tsx loading the TS source as CJS silently loses every `export *` name. So
`pnpm --filter @repo/types build` runs before any `tsx` script (turbo's `^build` does it for `dev`).

## 6. Steps

1. **Init.**
   ```bash
   cd ~/Code/ai-enquiry-assistant
   git init -b main
   ```
   (The folder already has `docs/`, `tasks/`, `README.md`, `CLAUDE.md`. Keep them.)

2. **Root files.** Copy `pnpm-workspace.yaml`, `turbo.json`, `.prettierrc`, `.gitignore` from
   `~/Code/paper-trail/`. Then write `package.json`:
   ```json
   {
     "name": "ai-enquiry-assistant",
     "private": true,
     "scripts": {
       "build": "turbo run build",
       "dev": "turbo run dev",
       "lint": "turbo run lint",
       "format": "prettier --write \"**/*.{ts,tsx,md}\"",
       "typecheck": "turbo run typecheck",
       "test": "turbo run test"
     },
     "devDependencies": { "prettier": "^3.7.4", "turbo": "^2.9.18", "typescript": "5.9.2" },
     "engines": { "node": ">=20" },
     "packageManager": "pnpm@9.15.4"
   }
   ```
   Append to `.gitignore`:
   ```
   # Prisma client is generated on install (Phase 03)
   apps/api/src/generated/
   ```

3. **docker-compose.yml.** Start from PaperTrail's and keep only these services:
   ```yaml
   services:
     postgres:
       image: postgres:17-alpine
       container_name: enquiry-postgres
       environment:
         POSTGRES_USER: enquiry
         POSTGRES_PASSWORD: enquiry
         POSTGRES_DB: enquiry
       ports: ["5432:5432"]
       volumes: [postgres_data:/var/lib/postgresql/data]
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U enquiry -d enquiry"]
         interval: 5s
         timeout: 3s
         retries: 20

     # Queues, rate limits, pub/sub. Must never evict (BullMQ loses jobs otherwise).
     redis:
       image: redis:7
       container_name: enquiry-redis
       ports: ["6379:6379"]
       volumes: [redis_data:/data]
       command: redis-server --appendonly yes --maxmemory-policy noeviction
       healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 5 }

     # Response cache. volatile-lru evicts only keys with a TTL: every cache entry has one, the
     # namespace version counters don't. No persistence: an empty cache after restart is correct.
     redis-cache:
       image: redis:7
       container_name: enquiry-redis-cache
       ports: ["6380:6379"]
       command: redis-server --save "" --appendonly no --maxmemory 256mb --maxmemory-policy volatile-lru
       healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 5 }

   volumes:
     postgres_data:
     redis_data:
   ```
   The `app` profile (api, worker, web containers) is added in Phase 32.

4. **Makefile.** From PaperTrail's, keep `help up down logs test test-int eval eval-gate db-migrate
   lint typecheck build`; drop `e2e` and `load` until Phases 31–32 add them back. Change `up`/`down`
   to plain `docker compose up -d` / `docker compose down` (no `--profile app` yet).

5. **Shared packages.**
   ```bash
   mkdir -p packages && cp -r ~/Code/paper-trail/packages/typescript-config packages/
   cp -r ~/Code/paper-trail/packages/eslint-config packages/
   rm -rf packages/*/node_modules
   mkdir -p packages/types/src
   cp ~/Code/paper-trail/packages/types/{package.json,tsconfig.json} packages/types/
   cp ~/Code/paper-trail/packages/types/src/{api,id,pagination}.ts packages/types/src/
   ```
   `packages/types/src/index.ts`:
   ```ts
   export * from "./id";
   export * from "./pagination";
   export * from "./api";
   ```

6. **API placeholder** (Phase 01 replaces `src/index.ts`).
   `apps/api/package.json`:
   ```json
   {
     "name": "api",
     "version": "0.1.0",
     "private": true,
     "main": "src/index.ts",
     "type": "commonjs",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js",
       "typecheck": "tsc --noEmit",
       "lint": "eslint src --max-warnings 0"
     },
     "dependencies": { "@repo/types": "workspace:*", "zod": "^4.4.3" },
     "devDependencies": {
       "@repo/eslint-config": "workspace:*",
       "@types/node": "^25.9.3",
       "eslint": "^9.39.1",
       "tsx": "^4.22.4",
       "typescript": "^6.0.3"
     }
   }
   ```
   `apps/api/tsconfig.json`: COPY `@pt-api/tsconfig.json` (NodeNext, `rootDir: src`, strict).
   `apps/api/eslint.config.mjs`: COPY `@pt-api/eslint.config.mjs`, but empty the COPY-file override
   list's `files` to `["src/utils/rateLimiter/**", "src/middleware/visitorId.ts",
   "src/services/gmail.service.ts"]` (the files this project copies byte-identical).
   `apps/api/src/index.ts`:
   ```ts
   console.log("api placeholder: Phase 01 replaces this file");
   ```

7. **Web and widget placeholders.** A one-line `README.md` in each (`Phase 09` / `Phase 14`). Not
   packages yet (no `package.json`), so pnpm ignores them.

8. **Install and check.**
   ```bash
   pnpm install
   pnpm build && pnpm typecheck && pnpm lint
   docker compose up -d && docker compose ps
   ```

9. **Commit.** `chore: monorepo, shared packages, docker-compose`.

## 7. Verify

```bash
pnpm build
# • Packages in scope: @repo/eslint-config, @repo/types, @repo/typescript-config, api
# Tasks: 2 successful, 2 total

ls packages/types/dist
# api.d.ts  api.js  id.d.ts  id.js  index.d.ts  index.js  pagination.d.ts  pagination.js

diff -r ~/Code/paper-trail/packages/typescript-config packages/typescript-config -x node_modules && echo SAME
# SAME
diff -q ~/Code/paper-trail/packages/types/src/id.ts packages/types/src/id.ts && echo SAME
# SAME

docker compose ps --format '{{.Name}} {{.Status}}'
# enquiry-postgres Up … (healthy)
# enquiry-redis Up … (healthy)
# enquiry-redis-cache Up … (healthy)

docker exec enquiry-redis redis-cli CONFIG GET maxmemory-policy
# maxmemory-policy noeviction
docker exec enquiry-redis-cache redis-cli CONFIG GET maxmemory-policy
# maxmemory-policy volatile-lru

docker exec enquiry-postgres psql -U enquiry -d enquiry -c "select version();" | head -3
# PostgreSQL 17.x …
```

If `pnpm build` says `api` has no build output, that's fine: the placeholder `tsc` emits
`dist/index.js`.

## 8. Definition of done

- [ ] `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` all succeed.
- [ ] `typescript-config`, `eslint-config` and the three copied `types/src` files are identical to
      PaperTrail's (`diff` prints nothing).
- [ ] `docker compose ps` shows three healthy containers; the two Redis policies are as in §5.
- [ ] `.gitignore` excludes `.env*` (but keeps `.env.example`) and `apps/api/src/generated/`.
- [ ] No MinIO, no app containers, no extra packages.
- [ ] Committed.

## 9. Interview angle

*"Why a monorepo for a small app?"* Because the dangerous bugs here are shape mismatches: the model
returns a category the inbox doesn't know, or the eval scores a field the API renamed. With one
`@repo/types` package, the classify contract is one Zod schema. The API validates model output with
it, the web app types the inbox with it, and the eval harness scores against it. A rename breaks the
build in all three places at once instead of breaking production in one.

*"Why two Redis servers?"* They need opposite failure behaviour. The queue holds customer messages
waiting to be processed and approved replies waiting to be sent; evicting one silently loses it, so
it runs `noeviction`. The cache must evict or it grows without bound, so it runs `volatile-lru` with
no persistence. I learned that split in my e-commerce backend and kept it in every project since.
