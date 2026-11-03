# Architecture

The AI Enquiry Assistant reads a small business's incoming customer messages, classifies them,
extracts the details, drafts a reply from the business's own info sheet, checks the draft **in code**,
and waits for a person to approve, edit or reject it. Nothing is ever sent without that approval.

It is built on the e-commerce architecture (`~/Code/e-commerce`) in the **PostgreSQL + Prisma** form
PaperTrail implemented (`~/Code/paper-trail`, ADR 0010 there). PaperTrail is the main copy source:
it already has org tenancy, the transactional outbox, the NVIDIA model layer with breakers and
fallbacks, BullMQ pipelines with a DLQ, SSE progress, cost metering, PII masking, and an eval harness.
See [inherited-architecture.md](inherited-architecture.md) for each piece.

---

## 1. The system

```
 Business website                         The business's Gmail inbox
 <script src=".../enquiry.js">            (per-business OAuth: gmail.readonly + gmail.send)
        │ POST /intake/form/:formKey                │  gmail-poll job (history API, every 60 s)
        ▼                                           ▼
 ┌──────────────────────── apps/api (Express 5, CommonJS) ────────────────────────┐
 │ intake service: one transaction → Message row + OutboxEvent("message.received")│
 │ outbox relay (FOR UPDATE SKIP LOCKED) → BullMQ "pipeline"                      │
 │                                                                                │
 │ worker (apps/api/src/worker.ts):                                               │
 │   process-message:  classify ─► spam (≥0.8)? stop                              │
 │                        └─► extract ─► select info entries ─► draft ─► checks   │
 │                     AiResult row + ModelCall rows (tokens, cost, latency)      │
 │                     publish "message.updated" (Redis pub/sub → SSE)            │
 │                                                                                │
 │ approval transaction: Reply row + Message.status + AuditLog + OutboxEvent      │
 │   ("reply.approved") ─► relay ─► "send-reply" job ─► Gmail send (threaded)     │
 └────────────────────────────────────────────────────────────────────────────────┘
        ▲ cookies + axios                    │ SSE /events/stream
 ┌──────┴────────────── apps/web (Next.js App Router) ────────────────────────────┐
 │ inbox · message detail (draft editor, flags) · bookings · info sheet · stats   │
 │ settings (team, invites, form widget, Gmail connection, tone, retention)      │
 └────────────────────────────────────────────────────────────────────────────────┘

 PostgreSQL 17 (Neon) · redis :6379 noeviction (BullMQ, limiter, pub/sub) · redis-cache :6380 volatile-lru
 NVIDIA NIM: a cheap model for classify/extract, a stronger one for drafts, a fallback for each
```

### Why sending goes through the outbox

Approving writes the `Reply`, flips the message status, writes the audit entry and the
`reply.approved` outbox event **in one transaction**. If the API dies after the commit, the relay
still sends. If the transaction fails, nothing is sent. A crash can't produce an approved reply that
was never sent, or a sent reply that was never approved. The `send-reply` job is idempotent: it checks
`Reply.sendStatus` and uses `jobId = reply-<replyId>`.

### Why the pipeline is one job, not a BullMQ flow

PaperTrail fans out per page (a flow with children). A message is one small text, and its steps are
strictly sequential and cheap. `process-message` runs the steps in order and **checkpoints after
each step** (an `AiResult` row with `stage`), so a retry resumes from the last finished step instead
of paying for classify again. Rejected alternative: a flow of four jobs. More moving parts, no
parallelism to gain. Write this as an ADR in Phase 33.

---

## 2. Monorepo layout

```
ai-enquiry-assistant/
├── package.json · pnpm-workspace.yaml · turbo.json · docker-compose.yml · Makefile · .prettierrc
├── apps/
│   ├── api/                Express 5 + Prisma 7.10.1 + BullMQ (API and worker entry points)
│   │   ├── prisma/{schema.prisma,migrations/} · prisma.config.ts
│   │   ├── src/{index,app,worker}.ts
│   │   ├── src/ai/         llm.ts · providers/{nvidia,fake,replay}.ts · breakers · concurrency · reliability · modelJson
│   │   │                   prompts/{classify,extract,draft,judge}.v<N>.ts + index.ts (the prompt registry)
│   │   ├── src/pipeline/   classify.ts · extract.ts · selectInfo.ts · draft.ts · checks/{numbers,phrases,length,sensitive,injection,index}.ts
│   │   ├── src/{config,constants,controllers,db,jobs,middleware,routes,services,types,utils}/
│   │   ├── evals/          messages.jsonl · run.ts · metrics.ts · review.ts · reports/
│   │   └── test/           integration tests (Testcontainers)
│   ├── web/                Next.js App Router, TanStack Query, Zustand, axios, Tailwind 4, shadcn/ui
│   └── widget/             Vite library build → dist/enquiry.js (one file, Shadow DOM, no framework)
├── packages/
│   ├── types/              @repo/types: Zod schemas (API requests/responses, pipeline contracts, labels)
│   ├── typescript-config/  COPY @pt-root/packages/typescript-config
│   └── eslint-config/      COPY @pt-root/packages/eslint-config
└── docs/ · tasks/
```

---

## 3. Tenancy: a business is an org

PaperTrail's tenancy is copied **with its names**: `Org`, `Membership`, `Invite`, `orgId`,
`OrgRole { owner admin reviewer viewer }`, `resolveOrg`, `requireOrgRole`, and the Prisma tenant
extension that scopes every query on a tenant table to the request's org. The UI and the docs say
"business" and "staff". The code keeps PaperTrail's names so those files stay COPY (and so the
cross-tenant tests port unchanged).

| Role | Can |
| --- | --- |
| `owner` | everything, including deleting the business and Gmail connection |
| `admin` | info sheet, tone, team, invites, widget, retention |
| `reviewer` | read the inbox, edit drafts, approve/reject, manage bookings |
| `viewer` | read the inbox and stats |

One account can belong to several businesses (the org switcher). A consultant setting up two pilots
is exactly that case.

---

## 4. The API's shape

Same rules as PaperTrail: route → controller (`catchError`, Zod parse with `@repo/types`, one service
call, `ok()`) → service (`appAssert`, Prisma via `tx`/`prisma`, never `req`/`res`). `createApp()` in
`app.ts`. Env validated at import. Envelope everywhere. Cursor pagination on `(createdAt desc, id
desc)`. UUIDv7 ids. snake_case tables.

### Endpoints

| Area | Routes | Auth | Phase |
| --- | --- | --- | --- |
| Health | `GET /health` | none | 01 |
| Auth | `/auth/{register,login,refresh,logout,me,verify/:token,google,password/forgot,password/reset}` | mixed | 04–05 |
| Sessions | `GET /session`, `DELETE /session/:id` | user | 05 |
| Businesses | `POST /orgs`, `GET /orgs`, `GET/PATCH /orgs/:orgId` | member/owner | 10 |
| Team | `/orgs/:orgId/members`, `/orgs/:orgId/invites`, `POST /invites/:token/accept` | admin | 10–11 |
| Info sheet | `/orgs/:orgId/info-entries` (CRUD, reorder, import/export JSON) | admin | 12 |
| Intake | `POST /intake/form/:formKey` (public, CORS per form; allows the widget's `X-Enquiry-Visitor` header), `/orgs/:orgId/forms`, `GET /widget/enquiry.js` (302 to the hashed build) | none / admin | 13–14 |
| Messages | `GET /orgs/:orgId/messages` (filters, cursor), `GET …/messages/counts`, `GET …/messages/:id`, `POST …/messages/:id/reprocess`, `POST …/messages/:id/checks/preview` (re-runs the server checks on an edited draft) | reviewer | 21, 23 |
| Held messages | `POST /orgs/:orgId/messages/reprocess-waiting` (releases `budget_reached` and `intake_cap` messages) | admin | 22 |
| Replies | `POST …/messages/:id/approve` · `…/reject` · `…/spam` · `PATCH …/messages/:id/draft` | reviewer | 24 |
| Live | `GET /orgs/:orgId/events/stream` (SSE) | viewer | 21 |
| Gmail (per business) | `/orgs/:orgId/gmail/{connect,status,disconnect}`, `GET /orgs/gmail/callback` (org from the signed `state`) | owner | 25 |
| Gmail (system sender setup) | `/api/auth/gmail/*` (PaperTrail's one-time authorization of the system sender; off in production unless `GMAIL_OAUTH_SETUP=true`) | platform admin | 08 |
| Bookings | `/orgs/:orgId/bookings` (list, confirm, decline, reschedule) | reviewer | 26 |
| Stats | `GET /orgs/:orgId/stats?from&to` | viewer | 27 |
| Privacy | `PATCH /orgs/:orgId/retention`, `DELETE …/messages/:id`, `POST …/contacts/erase` | owner | 28 |
| Usage | `GET /orgs/:orgId/usage` | admin | 22 |
| DLQ | `GET /admin/dlq`, `POST /admin/dlq/:jobId/replay`, `DELETE /admin/dlq/:jobId` | platform admin | 21 |

### Queues

| Queue | Jobs | Phase |
| --- | --- | --- |
| `email` | `send-email` (system mail: verify, reset, invite) | 08 |
| `pipeline` | `process-message` (classify → extract → select → draft → checks, checkpointed) | 21 |
| `send-reply` | `send-reply` via the business's Gmail, `jobId = reply-<replyId>` | 24–25 |
| `gmail-poll` | one repeatable job per connected business (`upsertJobScheduler`, every 60 s) | 25 |
| `maintenance` | `purge-expired` (hourly), `retention` (nightly) | 08, 28 |
| — (not a queue) | the **outbox relay**: PaperTrail's polling loop in `worker.ts` (200 ms busy, 2 s idle), claims rows with `FOR UPDATE SKIP LOCKED` | 13 |
| `dead-letter` | failed jobs after their last attempt, with replay | 21 |

---

### Environment variables

Every variable, and the phase that adds it to `apps/api/src/constants/env.ts` (validated at import;
the server refuses to start without the required ones).

| Phase | Variables |
| --- | --- |
| 01 | `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `CLIENT_URL`, `RUN_WORKERS_IN_API` |
| 02 | `LOG_LEVEL`, `SERVICE_NAME`, `CONTACT_HASH_SALT` |
| 03 | `DATABASE_URL` |
| 04 | `JWT_SECRET`, `JWT_REFRESH_SECRET` |
| 05 | `GOOGLE_CLIENT_ID` |
| 06 | `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `TRUSTED_PROXY_CIDRS`, `DEBUG_IP_ENDPOINT`, `INTAKE_DAILY_CAP` (default 300) |
| 07 | `CACHE_REDIS_HOST`, `CACHE_REDIS_PORT`, `CACHE_REDIS_USERNAME`, `CACHE_REDIS_PASSWORD`, `CACHE_ENABLED` |
| 08 | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_NAME`, `GMAIL_OAUTH_SETUP`, `ENABLE_QUEUE_DASHBOARD`, `QUEUE_DASHBOARD_USER`, `QUEUE_DASHBOARD_PASSWORD`, `WORKER_PORT` |
| 15 | `LLM_PROVIDER`, `NVIDIA_API_KEY`, `LLM_FAST_MODEL`, `LLM_FAST_FALLBACK_MODEL`, `LLM_DRAFT_MODEL`, `LLM_DRAFT_FALLBACK_MODEL`, `LLM_JUDGE_MODEL`, `NVIDIA_GUIDED_JSON`, `NVIDIA_FAULT_INJECT`, `FAKE_LLM_FIXTURES`, `FAKE_LLM_SCRIPT`, `FAKE_LLM_DELAY_MS` (the last three refused in production) |
| 22 | `PLATFORM_DAILY_BUDGET_USD`, `BUDGET_WARN_RATIO` |
| 25 | `SECRET_BOX_KEY`, `OAUTH_STATE_SECRET`, `GMAIL_CHANNEL_REDIRECT_URI`, `GMAIL_POLL_INTERVAL_MS` |
| 32 | `DIRECT_DATABASE_URL` (Neon's unpooled URL, read by `prisma.config.ts` for migrations), `SENTRY_DSN`, Langfuse keys (optional) |
| web 09 | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |

**The widget sets no cookies.** A cookie set from a business's own website would be a blocked
third-party cookie. The widget keeps a random id in `localStorage` and sends it as
`X-Enquiry-Visitor` (16–64 chars of `[A-Za-z0-9_-]`). It's a fairness key for the dual limiter only;
the IP bucket next to it is the real limit. Each form's CORS config allows that header.

## 5. The AI layer

- **COPY of PaperTrail's model layer** (`@pt-api/src/ai`): one `complete()` entry point, NVIDIA
  provider (OpenAI-compatible chat completions), a `fake` provider for tests and CI, a `replay`
  provider for recorded fixtures, per-model circuit breakers, a concurrency limiter, retry with
  backoff on 429/5xx, JSON-mode parsing with a repair retry (`modelJson.ts`).
- **Models by purpose** (`constants/llm.ts`): `classify` and `extract` use a cheap fast model;
  `draft` a stronger one; each with a fallback. Model ids and prices are checked on NVIDIA's catalogue
  when you build Phase 15, never assumed.
- **Prompt registry** (`src/ai/prompts/index.ts`): every prompt is a versioned module
  (`classify.v1.ts`). Every `AiResult` and `ModelCall` stores `promptVersion`. A prompt change is a new
  file, never an edit of a shipped one, so results stay comparable.
- **Customer text is data.** It's wrapped in `<customer_message>…</customer_message>` (any closing tag
  inside it is neutralised), and the system prompt says it's data.
- **There's no auto-send** anywhere in the code, not even behind a flag.

Contracts: [pipeline-contracts.md](pipeline-contracts.md). Checks: [safety-checks.md](safety-checks.md).

---

## 6. The web app's shape

COPY/ADAPT of PaperTrail's Next.js app (`@pt-web`): `src/lib/api.ts` (axios, silent refresh queue),
`providers.tsx` (TanStack Query), `store/auth.store.ts`, `AuthLoader`, `RequireAuth`, `GuestOnly`,
`RoleGuard`, `OrgSwitcher` (labelled "Business"), the shadcn primitives, and the public auth screens.
New screens: inbox, message detail, info sheet editor, bookings, stats, form widget settings, Gmail
connection.

---

## 7. Deployment

| Piece | Host |
| --- | --- |
| `apps/web` | Vercel |
| `apps/widget` | served by the API at `GET /widget/enquiry.js` (long cache, versioned file name) |
| `apps/api` + worker | Render web service + background worker (`RUN_WORKERS_IN_API=false`) |
| PostgreSQL | Neon (`sslmode=require`); migrations by `prisma migrate deploy` at API start |
| Redis ×2 | queue instance `noeviction`, cache instance `volatile-lru` |
| Models | NVIDIA NIM (server key, per-business monthly budget) |

---

## 8. Rules that cut across everything

1. **No reply leaves without a human approval.** The only path to `send-reply` is the approval
   transaction's outbox event.
2. **Facts come only from the info sheet** (or the customer's own message). Code checks every draft.
3. **Drafts never confirm a booking.** Staff confirm in the bookings list.
4. **Customer text is data**, never instructions.
5. **Message bodies, names, phones and emails never reach logs** (pino redaction + masked ids).
6. **Per-business Gmail refresh tokens are sealed** (AES-256-GCM, `secretBox.ts`), narrowest scopes.
7. **Every AI result stores** `promptVersion`, model, tokens, cost and latency.
8. **Results in the README are generated** from eval reports, never typed.
9. **Copied names stay copied** (`Org`, `orgId`, PaperTrail's field names). Rename nothing for style.
10. **Stay inside the current phase.** A later-phase call becomes a `// Phase NN:` comment.
