# Phase 00 — Monorepo, packages, docker-compose

## 1. Goal

A green skeleton:
- pnpm + Turborepo with the shared packages copied from PaperTrail;
- `apps/api` printing one line;
- an empty `apps/widget` workspace;
- `docker-compose.yml` with a MongoDB single-node replica set and two Redis instances.

These are the same steps as `~/Code/prompt-lab/docs/phases/phase-00-monorepo-setup.md`, with the
differences below.

## 2. What I will understand after this phase

1. Why a third app (`widget`) lives in the monorepo.
2. Why two Redis instances (queue `noeviction`, cache `volatile-lru`) and a replica set (the outbox and
   approval transactions).

## 3. Prerequisites

Node ≥ 20, pnpm 9, Docker Compose v2, `~/Code/paper-trail` present.

## 4. Files

```
ai-enquiry-assistant/
├── package.json · Makefile · docker-compose.yml        ADAPT  @pt-root/   (name "ai-enquiry-assistant"; drop minio; containers "enquiry-*")
├── turbo.json · pnpm-workspace.yaml · .gitignore · .prettierrc · .prettierignore · .dockerignore   COPY  @pt-root/
├── packages/{typescript-config,eslint-config}/        COPY   @pt-root/packages/
├── packages/types/{package.json,tsconfig.json}        COPY   @pt-root/packages/types/
├── packages/types/src/index.ts                        NEW    (empty barrel)
├── apps/api/{tsconfig.json,eslint.config.mjs}         COPY   @pt-api/
├── apps/api/package.json                              ADAPT  @pt-api/package.json  (name "api"; drop aws-sdk, pdfjs, undici, langfuse/otel/sentry; scripts: + eval, seed)
├── apps/api/src/index.ts · .env.example               NEW    (temporary)
└── apps/widget/package.json                           NEW    (filled in Phase 13)
```

## 5. Concepts

**Three apps, one repo.**
- The **API** (and its worker) runs the pipeline.
- The **web** app is the staff dashboard.
- The **widget** is a tiny script businesses paste into their own website.

It talks to the API's public intake endpoint, and it shares Zod schemas with the API through
`@repo/types`, so the form validates exactly what the API accepts. All three get built and tested
together.

## 6. Steps

Run Prompt Lab's Phase 00 steps with `prompt-lab` → `ai-enquiry-assistant` and `promptlab-*` →
`enquiry-*`, but **skip** `packages/scoring`. Then:

```bash
mkdir -p apps/widget && cat > apps/widget/package.json <<'EOF'
{ "name": "widget", "private": true, "version": "0.1.0", "scripts": { "build": "echo widget arrives in Phase 13" } }
EOF
```

`.env.example` (API): `NODE_ENV=development`, `PORT=5000`.

## 7. Verify

```bash
pnpm install && pnpm build && pnpm typecheck && pnpm lint
docker compose up -d && docker compose ps                    # redis, redis-cache, mongo healthy
docker exec enquiry-mongo mongosh --quiet --eval "rs.status().set"   # rs0
diff -q ~/Code/paper-trail/turbo.json turbo.json
```

## 8. Definition of done

- [ ] Green build, healthy services, COPY files identical.
- [ ] Commit: `chore: monorepo skeleton`.

## 9. Interview angle

*"Why a monorepo for a small product?"* The embeddable form, the API and the dashboard share
validation schemas. When the form accepts a field, the API accepts it too.
