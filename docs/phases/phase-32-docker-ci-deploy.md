# Phase 32 — Docker, CI with the eval gate, observability, deploy

## 1. Goal

Ship it the way it was built:

- **one API image** (multi-stage, non-root, `tini`), run as two processes: the API (`node dist/index.js`)
  and the worker (`node dist/worker.js`). Migrations run before the API starts;
- a compose **`app` profile** that runs the whole stack locally from images;
- **GitHub Actions**:
  - `ci.yml`: lint, typecheck, unit, integration (Testcontainers), web build, widget build,
    Playwright;
  - `eval.yml`: the **eval gate** on the replay provider for every PR touching prompts or pipeline
    code, and a live run on demand;
- **observability**: optional Sentry (errors) and Langfuse (model traces), both scrubbed of customer
  data;
- a **deploy runbook**:
  - Neon (PostgreSQL), Render web service + background worker, two Redis instances with the right
    eviction policies;
  - Vercel (web), the widget URL;
  - Gmail OAuth consent screen notes;
  - an env checklist, smoke tests and rollback.

## 2. What I will understand after this phase

1. Why the API and the worker are the same image but separate processes in production.
2. Why migrations run as a step before start (and why Prisma's advisory lock makes concurrent starts
   safe).
3. How an eval gate on recorded answers protects prompt changes in CI at zero model cost.
4. What each piece of infrastructure must be configured as (eviction policies), and what breaks if it
   isn't.
5. How to keep customer data out of third-party observability tools.

## 3. Prerequisites

Phase 31 green locally. Accounts: GitHub, Neon, Render, Vercel, a Redis provider, NVIDIA (API key),
Google Cloud (the system Gmail sender from Phase 08 and the business Gmail OAuth client from
Phase 25).

## 4. Files

```
apps/api/Dockerfile                    ADAPT  @pt-api/Dockerfile        (no poppler-utils; prisma generate in build)
apps/web/Dockerfile                    ADAPT  @pt-web/Dockerfile        (local app profile only; Vercel builds prod)
.dockerignore                          COPY   @pt-root/.dockerignore
docker-compose.yml                     ADAPT  @pt-root/docker-compose.yml (no MinIO; app profile: api, worker, web)
.github/workflows/ci.yml               ADAPT  @pt-root/.github/workflows/ci.yml   (+ widget build; no OpenAPI drift step)
.github/workflows/eval.yml             ADAPT  @pt-root/.github/workflows/eval.yml (paths; this repo's eval CLI; --gate)
apps/api/evals/gate.ts                 ADAPT  @pt-api/evals/gate.ts     (this project's rules)
apps/api/evals/baseline.json           NEW    (written from the frozen dev-replay report)
apps/api/src/instrument.ts             ADAPT  @pt-api/src/instrument.ts (Sentry; beforeSend scrub)
apps/api/src/utils/tracing.ts          ADAPT  @pt-api/src/utils/tracing.ts (Langfuse; metadata only, no message text)
apps/web/next.config.ts                ADAPT  @pt-web/next.config.ts    (resolve Phase 09's comment: withSentryConfig, silent)
apps/web/sentry.{client,server}.config.ts  ADAPT  @pt-web/sentry.{client,server}.config.ts (DSN optional; beforeSend drops request bodies and masks emails/phones)
apps/widget/vite.config.ts             ADAPT  (Phase 14's file: emit dist/enquiry.<contenthash>.js + dist/manifest.json { file })
apps/api/src/routes/widget.route.ts    ADAPT  (serve dist/enquiry.<hash>.js with long cache; Phase 14 file) — reads the manifest at boot
docs/DEPLOY.md                         NEW    (the runbook below, kept current)
```

## 5. Concepts

**One image, two processes.** The API answers HTTP, and the worker runs the pipeline, the relay, sends,
Gmail polls and retention. In production `RUN_WORKERS_IN_API=false`, so a slow model call can never
hold up a request, and the two scale separately. Both are built from `apps/api/Dockerfile`. They differ
only in the command.

**Migrations before start.** The API's start command is
`npx --no-install prisma migrate deploy && node dist/index.js` (as in PaperTrail's compose). Prisma
takes a PostgreSQL advisory lock, so two instances starting together apply each migration once. The
worker never migrates. Its deploy waits for the API's. Migrations must be backward compatible for one
release (add a column, deploy, then use it), because the old worker may still run while the new API
migrates.

**The Dockerfile.** PaperTrail's: `pnpm fetch` on lockfiles only (cache-friendly), `pnpm install
--offline`, build `@repo/types`, build `api` (its `build` script runs `prisma generate && tsc`), then
`pnpm deploy --filter api --prod /out`. The runtime stage is `node:22-slim` + `tini` +
`ca-certificates` as user `node`. Drop `poppler-utils` (no PDFs here). The Prisma CLI stays a
production dependency because `migrate deploy` runs in the container (PaperTrail ADR 0010's stated
cost).

**The eval gate.** `gate.ts` (ADAPT of PaperTrail's) compares a run with `baseline.json`. The rules:

| Rule | Target |
| --- | --- |
| Planted-draft check recall | = 1.0 (hard) |
| `injection_followed` on the injection set (replay) | = 0 of the drafts the baseline had at 0 (hard) |
| `category_accuracy` (dev) | ≥ baseline − 2 points |
| `field_accuracy_mean` (dev) | ≥ baseline − 2 points |
| `valid_json` | ≥ baseline − 1 point |
| `cost_usd_per_100` | ≤ baseline × 1.25 |

Human-review metrics aren't gated: CI can't review. The gate runs on the **replay** provider: recorded
answers for `(model, promptVersion, content)`. A code-only change (checks, selection, normalisers)
re-scores the same recorded answers for free. A **prompt** change has no recordings, so the replay run
fails with "no recording for draft@4". That's deliberate: the PR author runs
`eval -- --split dev --provider nvidia --record` locally (or triggers `eval.yml` with `live`), commits
the new recordings, and the gate then compares. `baseline.json` is updated only in a PR that says why.

**CI layout** (ADAPT PaperTrail's `ci.yml`):
- `checks`: install, lint, typecheck, `api test`, `api test:int`, `web build`, `widget build`. The env
  block carries placeholders only: the API's env module validates at import, and nothing in this job
  connects to a real database.
- `eval`: `uses: ./.github/workflows/eval.yml` with `--provider replay --gate`.
- `e2e`: compose `postgres redis redis-cache`, Playwright with recorded answers, report uploaded.
- `image`: build (and on `main`, push to GHCR) after the three pass.

**Observability, scrubbed.**
- **Sentry** (`instrument.ts`, optional: on only when `SENTRY_DSN` is set). `beforeSend` deletes
  `request.data`, `request.cookies` and `request.headers.authorization`. It also runs the same
  redaction keys as the logger over `extra` and `contexts`, and replaces any email or phone pattern in
  the message text with `[redacted]`. Breadcrumbs from `console` are off.
- **Langfuse** (`tracing.ts`, optional: on only when its keys are set). Each model call becomes a
  span carrying `purpose`, `model`, `promptVersion`, tokens, cost, latency, outcome and `messageId`
  (an id, not content). **Input and output text are not sent.** You give up seeing prompts in
  Langfuse; the eval reports carry the fictional ones, and production text never leaves your database.
  `data-handling.md` "Never" covers this.
- Logs: pino JSON to stdout; Render keeps them. The redaction from Phase 02 applies.

**Infrastructure settings that matter.**

| Piece | Setting | If it's wrong |
| --- | --- | --- |
| Queue Redis | `maxmemory-policy noeviction`, persistence on | BullMQ silently loses jobs under memory pressure |
| Cache Redis | `volatile-lru`, no persistence | an unbounded cache, or stale entries surviving restarts |
| Neon | pooled URL for the app (`DATABASE_URL`), direct URL for migrations (`DIRECT_DATABASE_URL` if Phase 03's `prisma.config.ts` reads one; otherwise the direct URL for both) | migrations through a pooler can fail on advisory locks |
| Render API | health check path `/health`; `TRUSTED_PROXY_CIDRS` per Render's proxy | wrong client IPs → the rate limiter keys everyone together |
| Render worker | `RUN_WORKERS_IN_API=false` on **both** services' env, worker command `node dist/worker.js` | workers running twice (in the API and the worker) |
| Vercel web | `NEXT_PUBLIC_API_URL` = the API's URL | — |
| Cookies | web and API on one registrable domain → `SameSite=Lax`; on `*.vercel.app` + `*.onrender.com` → `SameSite=None; Secure` (the copied config), and strict browsers may still block third-party cookies: a custom domain fixes it | silent sign-in failures in Safari |

**The widget URL.** The API serves `GET /widget/enquiry.<contenthash>.js` with
`Cache-Control: public, max-age=31536000, immutable`, plus `GET /widget/enquiry.js`, which redirects
(302, `max-age=300`) to the current hash. Businesses embed the short URL. A new release reaches every
site within 5 minutes and can be rolled back the same way.

**Gmail OAuth, two clients.**
- The **system sender** (Phase 08): one account, your own, consent screen in testing mode, refresh
  token in env.
- The **business channel** (Phase 25): `gmail.readonly` + `gmail.send` are **restricted scopes**.
  While the app is unverified it works for up to 100 test users you add by hand, with an "unverified
  app" warning. That covers a pilot. Public launch needs Google's verification and a security
  assessment for restricted scopes. `LIMITATIONS.md` says so, and the runbook links the consent-screen
  checklist (privacy policy URL, homepage, scopes justification, demo video).

## 6. Steps

1. **Docker.** Adapt the Dockerfile, `.dockerignore` and the compose `app` profile (`api` runs
   `migrate deploy && node dist/index.js`; `worker` waits for `api`; `web`). Run
   `docker compose --profile app up --build` and use the app end to end with `LLM_PROVIDER=fake`.
2. **Gate.** Write `gate.ts`'s rules. Produce `baseline.json` from a reviewed dev run on replay (after
   Phase 30's final prompts), and commit it with the recordings it needs.
3. **CI.** Adapt `ci.yml` and `eval.yml`: paths filter (`apps/api/src/ai/**`, `apps/api/src/pipeline/**`,
   `apps/api/evals/**`, `packages/types/**`), the `workflow_dispatch` input (`replay` | `live`), and
   `NVIDIA_API_KEY` from secrets for live runs only. Open a PR that edits a check, then one that edits a
   prompt without recordings, and watch both behave as described.
4. **Observability.** Adapt `instrument.ts` and `tracing.ts`. Write a unit test that sends a fake
   event containing an email and a phone through `beforeSend` and asserts both are gone.
5. **Provision.**
   - Neon project (Postgres 17), a database user for the app.
   - Two Redis instances with the policies above.
   - Render: web service from the image (or the repo with the Dockerfile) and a background worker.
   - Vercel project for `apps/web` (root directory set, `pnpm` detected).
6. **Env checklist** (fill `docs/DEPLOY.md` from every phase's `env.ts`, never from memory). Groups:
   - core: `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `CLIENT_URL`, `DATABASE_URL` (+ direct URL),
     `JWT_SECRET`, `JWT_REFRESH_SECRET` (≥ 32 chars, different), `TRUSTED_PROXY_CIDRS`;
   - Redis: `REDIS_*`, `CACHE_REDIS_*`;
   - auth: `GOOGLE_CLIENT_ID`;
   - system mail: the Phase 08 `GMAIL_*` variables;
   - business channel: the Phase 25 OAuth client variables and `SECRET_BOX_KEY` (32 bytes, base64;
     losing it makes every stored Gmail token unreadable, so store it in a password manager too);
   - models: `LLM_PROVIDER=nvidia`, `NVIDIA_API_KEY`, the per-purpose model ids from
     `constants/llm.ts` overrides if any;
   - workers: `RUN_WORKERS_IN_API=false`;
   - optional: `SENTRY_DSN`, Langfuse keys.
7. **Deploy order.** API (migrates) → worker → web. Seed the demo business (Phase 33 seeds the demo
   data).
8. **Smoke tests** (`docs/DEPLOY.md`, run after every deploy):
   - `GET /health` → `200` with database, Redis and cache up;
   - sign in on the web app; the inbox loads;
   - submit the demo widget on a test page → the message appears in the inbox within ~15 s with a
     draft;
   - approve a draft to your own address (email channel) → it arrives threaded;
   - Bull Board is **not** reachable in production;
   - `GET /widget/enquiry.js` → 302 to a hashed file with the long cache header.
9. **Rollback.**
   - Render: redeploy the previous image for API and worker.
   - Vercel: promote the previous deployment.
   - Database: migrations are forward-only. Because each is backward compatible for one release, the
     previous image runs against the new schema. A destructive migration ships only a release after
     the code stopped using the column.

## 7. Verify

```bash
docker build -f apps/api/Dockerfile -t enquiry-api .
docker run --rm enquiry-api id -u                 # not 0 (runs as node)
docker compose --profile app up --build -d && curl -s localhost:5000/health
pnpm --filter api exec tsx evals/run.ts --split dev --provider replay --gate
```

Expected:
- the image builds without poppler and runs as a non-root user;
- `/health` returns `{"status":"success",…}` with database, Redis and cache up;
- the gate prints a table of rules with ✅ and exits 0; editing a planted case's expected flags locally
  makes it exit 1;
- on GitHub: `ci` green on a PR; `eval` shows the gate table in the job summary;
- after deploying, every smoke test passes, and Sentry's test event shows no email or phone.

## 8. Definition of done

- [ ] One API image; API and worker as separate Render services; migrations before start.
- [ ] Compose `app` profile runs the full stack from images.
- [ ] `ci.yml` (checks, eval gate, e2e, image) and `eval.yml` (replay on PRs, live on demand) green.
- [ ] Sentry/Langfuse optional and scrubbed, with a test proving the scrub.
- [ ] Deployed: Neon, Render ×2, two Redis with correct policies, Vercel, widget URL with redirect.
- [ ] `docs/DEPLOY.md`: env checklist from `env.ts`, smoke tests passed, rollback steps.
- [ ] Commit: `chore: docker, ci with eval gate, observability and deploy runbook`.

## 9. Interview angle

*"How do you stop a prompt change from quietly making things worse?"* Every PR that touches prompts,
checks or the pipeline runs the eval gate in CI. It runs on recorded model answers, so it's free and
deterministic. A prompt change has no recordings yet, so the gate forces the author to run it live once
and commit the answers before CI compares. The hard rules are 100 % planted-invention recall and no new
injection followed. Accuracy may drift two points at most. In production, the worker is a separate
process from the same image, so a slow model never blocks a request. Observability gets ids, tokens and
latency, never a customer's words.
