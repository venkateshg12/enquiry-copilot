# AI Enquiry Assistant

**Reads a small business's incoming customer messages, sorts them, pulls out the details and drafts
replies in the business's tone. A human approves every reply before it is sent.**

> Status: **planning**. This repository holds the build guides. Start at
> [docs/phases/README.md](docs/phases/README.md). The previous MongoDB-based plan (24 Oct 2026) is
> archived in [docs/_archive-2026-10-24/](docs/_archive-2026-10-24/).

## The rule that makes owners trust it

**The AI never sends anything on its own and never invents facts.** Prices, timings, services and
policies come only from the business's own **info sheet**. If the answer isn't there, the draft says
the team will confirm. Code (not the AI) checks every number in every draft before a human sees it.

## What it does

1. **Receives** messages from an embeddable website form and the business's Gmail inbox.
2. **Classifies** each one: `booking`, `price_or_info`, `complaint`, `follow_up`, `spam`, `other`.
3. **Extracts** name, phone/email, service, preferred date and time, urgency, and a question summary.
4. **Drafts** a reply in the business's tone, using only info-sheet facts.
5. **Checks** the draft in code: invented numbers, booking promises, length, sensitive data,
   injection.
6. **Waits** for a staff member to approve, edit or reject it in the inbox.
7. **Sends** the approved reply from the business's own address, and logs everything.

## Results (test set, filled in from real runs, never typed by hand)

| Step | Metric | Result |
| --- | --- | --- |
| Classify | Category accuracy | |
| Extract | Field accuracy / valid JSON | |
| Draft | Approved without edits | |
| Draft | Invented numbers caught by checks | |
| Draft | Injection attempts followed | |
| Overall | Cost per 100 messages / p95 time to draft | |

## Architecture

```
 Website widget ──► POST /intake/form/:formKey ─┐
                                                ├─► message saved + outbox event (one transaction)
 Gmail inbox ─────► poller (history API) ───────┘            │
                                                        relay → BullMQ pipeline
                         classify ─► (spam stops) ─► extract ─► draft ─► code safety checks
                                                                              │
 Next.js inbox (TanStack Query, SSE) ◄────────────────────────────────────────┘
   approve / edit / reject ──► approval transaction + outbox ──► send via the business's Gmail ──► activity log
```

Built on the architecture of [`~/Code/e-commerce`](../e-commerce), as ported and hardened in
[`~/Code/paper-trail`](../paper-trail):
- auth, rate limiting, cache, BullMQ and the Gmail sender;
- PostgreSQL + Prisma with the tenant extension (every query scoped to one business);
- organisations and roles (here, **businesses and staff**);
- the transactional outbox;
- encrypted secrets and PII redaction;
- the NVIDIA LLM reliability layer.

The website widget is adapted from [`~/Code/counseldesk`](../counseldesk). Prompts are evaluated with
[`~/Code/prompt-lab`](../prompt-lab). See [docs/reference/architecture.md](docs/reference/architecture.md).

## Stack

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm + Turborepo |
| Web | Next.js (App Router), TanStack Query + Table, Zustand, Tailwind, shadcn/ui |
| Widget | Vite-built single-file script (`<script src=".../enquiry.js">`) |
| API / worker | Express 5 + TypeScript (CommonJS + tsx), BullMQ |
| Data | PostgreSQL 17 (Neon) + Prisma 7.10.1; Redis ×2 (queue, cache) |
| Models | NVIDIA NIM by default (a cheap model for classify/extract, a stronger one for drafts); OpenAI / Anthropic / Gemini adapters optional |
| Email | Gmail API: per-business OAuth (read + send) for intake and replies; system mail for auth emails |
| Tests | Vitest, Supertest, Testcontainers, Playwright; prompt evals via Prompt Lab |
| Deploy | Vercel (web), Render (API + worker), Neon, hosted Redis ×2 |
