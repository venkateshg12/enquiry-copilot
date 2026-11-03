# Phase 09 — Next.js web foundation

## 1. Goal

Copy PaperTrail's web app foundation (`@pt-web`), which is e-commerce's client architecture ported to
Next.js App Router:
- the axios instance with the **single-flight silent refresh** queue and error normalisation;
- the server-wake notice for a sleeping free-tier backend;
- the TanStack Query client (one per server render, one per tab) with `clearUserQueries`;
- the Zustand auth and server stores;
- `AuthLoader`, `RequireAuth`, `GuestOnly` (with the open-redirect guard), `RoleGuard`;
- the shadcn primitives;
- the public auth screens (login, register, verify, forgot, reset) and Google sign-in;
- the account page with **device sessions** (list and revoke).

No business screens yet. After login the app lands on an empty `/inbox` shell that Phase 23 fills. The
business switcher and the `X-Org-Id` header arrive with businesses in Phase 10.

## 2. What I will understand after this phase

1. How the refresh queue turns many concurrent 401s into **one** `/auth/refresh` call, then replays them.
2. Why auth is guarded on the client, not in a Next.js `proxy` (formerly `middleware`): the cookies
   belong to the API's domain.
3. Why `NEXT_PUBLIC_*` must be written as literal `process.env.NEXT_PUBLIC_X`.
4. Why there's a query client per server render and one per browser tab.
5. Why `clearUserQueries` runs on every way a session can end.
6. Next.js 15 vs 16 for this codebase, and what would break.

## 3. Prerequisites

- Phases 04–08 done: register, verify, login, refresh, logout, `/auth/me`, Google sign-in, `/session`,
  and the dev mailbox route (`/auth/dev/latest-link`).
- API `CORS_ORIGIN` includes `http://localhost:3000` with credentials (Phase 01).
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: the same Google sign-in client as the API's `GOOGLE_CLIENT_ID`, with
  `http://localhost:3000` as an authorised JavaScript origin.

## 4. Files

```
apps/web/
├── package.json                    ADAPT  @pt-web/package.json   (name "web"; next ^16; drop @sentry/nextjs, @tanstack/react-virtual; keep recharts)
├── next.config.ts                  ADAPT  @pt-web/next.config.ts (transpilePackages only; Sentry wrapper is Phase 32)
├── tsconfig.json                   COPY   @pt-web/tsconfig.json
├── postcss.config.mjs              COPY   @pt-web/postcss.config.mjs
├── components.json                 COPY   @pt-web/components.json
├── eslint.config.mjs               COPY   @pt-web/eslint.config.mjs
├── .env.example                    NEW    NEXT_PUBLIC_API_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID
└── src/
    ├── constants/env.ts            COPY   @pt-web/src/constants/env.ts
    ├── utils/appError.ts           COPY   @pt-web/src/utils/appError.ts
    ├── types/{index,api.types,auth.types,user.types,ui.types}.ts   COPY  @pt-web/src/types/
    ├── lib/
    │   ├── api.ts                  ADAPT  @pt-web/src/lib/api.ts          (no org header yet; no Idempotency-Key)
    │   ├── queryClient.ts          ADAPT  @pt-web/src/lib/queryClient.ts  (USER_SCOPED_KEYS)
    │   ├── serverStatus.ts         COPY   @pt-web/src/lib/serverStatus.ts
    │   ├── errorMessage.ts         COPY   @pt-web/src/lib/errorMessage.ts
    │   ├── utils.ts                COPY   @pt-web/src/lib/utils.ts        (cn)
    │   └── google/{google.d.ts,loadGsi.ts}   COPY  @pt-web/src/lib/google/
    ├── store/{auth.store,server.store}.ts    COPY  @pt-web/src/store/
    ├── api/{auth,session}.ts       COPY   @pt-web/src/api/
    ├── hooks/auth/*.ts             COPY   @pt-web/src/hooks/auth/   (useLogin, useLogout, useRegister, useGetProfile, useGoogleLogin, useForgotPassword, useResetPassword)
    ├── hooks/account/useAccountSessions.ts   COPY  @pt-web/src/hooks/account/useAccountSessions.ts
    ├── components/
    │   ├── ui/*                    COPY   @pt-web/src/components/ui/   (all 22 primitives)
    │   ├── common/{QueryDevtools,RouteFallback,ServerWakeNotice}.tsx  COPY  @pt-web/src/components/common/
    │   ├── auth/{AuthLoader,RequireAuth,GuestOnly,GoogleSignInButton}.tsx  COPY / ADAPT (AuthLoader: branding)
    │   └── layout/RoleGuard.tsx    COPY   @pt-web/src/components/layout/RoleGuard.tsx
    └── app/
        ├── layout.tsx              ADAPT  @pt-web/src/app/layout.tsx      (title, description)
        ├── providers.tsx           COPY   @pt-web/src/app/providers.tsx
        ├── globals.css             COPY   @pt-web/src/app/globals.css
        ├── page.tsx                ADAPT  @pt-web/src/app/page.tsx        (a public landing page, see Step 7)
        ├── (public)/layout.tsx     COPY   @pt-web/src/app/(public)/layout.tsx
        ├── (public)/{login,register,password/forgot}/page.tsx           COPY / ADAPT (branding)
        ├── (public)/auth/verify/[token]/page.tsx                        COPY
        ├── (public)/password/reset/[token]/page.tsx                     COPY
        ├── (app)/layout.tsx        ADAPT  @pt-web/src/app/(app)/layout.tsx  (nav: Inbox, Bookings, Stats, Settings, Account; no OrgSwitcher/UsageMeter yet)
        ├── (app)/inbox/page.tsx    NEW    (an empty state; Phase 23)
        └── (app)/account/page.tsx  COPY   @pt-web/src/app/(app)/account/page.tsx   (profile + device sessions)
```

Not copied: documents, review, DLQ, quality, webhooks, API keys, upload, `org.store.ts` and
`OrgSwitcher` (Phase 10), `UsageMeter` (Phase 22), `useDocumentEvents`/`useOrgEvents` (SSE, Phase 21).

## 5. Concepts

**Next.js 15 or 16.** PaperTrail runs Next 15; npm's current major is 16.4. The Next 16 upgrade guide
(checked on Context7, `/vercel/next.js/v16.2.9`) lists these breaking changes:
- `params` and `searchParams` are async only;
- `middleware` is renamed to `proxy`;
- `next lint` is removed;
- Turbopack is the default for `next build`;
- Node ≥ 20.9 and TypeScript ≥ 5.1 are required.

Checked against the files this phase copies:
- **Params.** The dynamic pages read params through `useParams()` (client) or `use(params)` with
  `params: Promise<…>`. Both are already the async form.
- **Middleware.** There's no `middleware.ts`: auth is guarded on the client.
- **Lint.** The lint script runs `eslint .`, not `next lint`.
- **Build.** There's no custom webpack config. The only config wrapper was Sentry's, which isn't copied
  until Phase 32.

So **use Next 16**: nothing copied depends on what changed. If `next build` fails on something this
check missed, pin `next@^15` (PaperTrail's version) and record why in `tasks/lessons.md`. Don't patch
around it.

**Why the guards are client-side.** The access and refresh cookies are httpOnly cookies on the
**API's** domain (Render), not on the web's (Vercel). A Next.js `proxy` or Server Component on Vercel
never sees them, so it can't know who's signed in. The browser can, by calling `/auth/me` with
`withCredentials`. `AuthLoader` does that once on boot and fills the auth store. `RequireAuth` shows
`RouteFallback` until the store is bootstrapped, then redirects guests to `/login?from=<path>`.
`GuestOnly` sends signed-in users away from the auth pages. Its `sanitizeRedirectUrl` accepts only a
path starting with `/` and not `//`, so `?from=//evil.example` can't turn login into an open redirect.
The API still authorises every request; the guards only decide what to render.

**Single-flight refresh.** The access token lives 15 minutes. When it expires, every in-flight request
gets a 401 at once. The interceptor lets the **first** one call `GET /auth/refresh` on a separate
axios instance (so the refresh can't recurse into the interceptor). Every other 401 waits in
`failedQueue`, and they're all replayed once the refresh succeeds. If refresh fails, the queue is
rejected, the auth store is cleared and the user-scoped queries are removed. Requests **to** auth
routes (`AUTH_ROUTES`) never trigger a refresh, so a wrong password can't loop. `_retry` marks a
replayed request, so it can't refresh twice. Refresh and logout are **GET** here because Phase 04 kept
PaperTrail's verbs, and this client calls `refreshClient.get("/auth/refresh")`.

**Error normalisation.** Every rejection is `{ status, message, code?, errors? }` read from the API
envelope, or `{ status: 0, message: "Network error…" }`. Components read `error.message` and never touch
`AxiosError`.

**The sleeping server.** On Render's free tier the API sleeps after inactivity and takes up to a
minute to wake. The axios timeout is 60 s. A request still pending after 3 s raises the
`ServerWakeNotice`, unless the server answered in the last 2 minutes. The query client retries only
"server unavailable" errors, for about 2 minutes. A 4xx is never retried. A slow first load then reads
as "starting up", not "broken".

**Two query clients.** `getQueryClient()` makes a new client per **server** render, so two visitors'
caches can't mix during SSR, and one client for the life of the browser tab. Nothing fetches on the
server today (the cookies aren't there). The split exists so a future prefetch can't leak data.

**`clearUserQueries`.** Logout, a failed refresh and a profile that no longer resolves all call it.
It removes every query whose key starts with one of `USER_SCOPED_KEYS`. Here those are the keys for
customer data, so one person's inbox never flashes on the next person's screen on a shared front-desk
computer:

```ts
const USER_SCOPED_KEYS = [
    "sessions", "profile",
    "org", "members", "invites",                        // Phase 10–11
    "info-entries", "forms",                            // Phase 12–14
    "messages", "message", "inbox-counts",              // Phase 23
    "bookings", "stats", "usage", "gmail", "activity",  // Phases 22–27
];
```

Listing future keys now is deliberate. Removing a key nobody uses yet is a no-op, and a key added
later but forgotten here would be a data leak between users.

**Literal `NEXT_PUBLIC_*`.** Next inlines `process.env.NEXT_PUBLIC_API_URL` by replacing that exact
text at build time. `process.env[name]` is never replaced, and it's `undefined` in the browser.
`constants/env.ts` passes the literal expression into `required()`, which throws at import, so a build
missing the variable fails loudly instead of calling `undefined/auth/me`.

## 6. Steps

1. **Scaffold** `apps/web` by copying the config files listed above. Then:
   ```bash
   pnpm --filter web add next@^16 react@^19 react-dom@^19 @tanstack/react-query@^5 @tanstack/react-query-devtools@^5 \
     axios zustand@^5 radix-ui class-variance-authority clsx tailwind-merge tw-animate-css lucide-react recharts
   pnpm --filter web add -D tailwindcss@^4 @tailwindcss/postcss@^4 postcss typescript @types/react @types/react-dom @types/node \
     @repo/typescript-config@workspace:* @repo/eslint-config@workspace:*
   pnpm --filter web add @repo/types@workspace:*
   ```
   Scripts as PaperTrail's: `"dev": "next dev -p 3000"`, `"build": "next build"`, `"start": "next start"`,
   `"lint": "eslint . --max-warnings 0"`, `"typecheck": "tsc --noEmit --incremental false"`. `recharts`
   is installed now because Phase 27's stats charts use it, and PaperTrail's `package.json` has it.
2. `next.config.ts`:
   ```ts
   import type { NextConfig } from "next";

   // As PaperTrail: Next bundles @repo/types (its built CommonJS dist/) for the browser. Sentry's wrapper is Phase 32.
   const nextConfig: NextConfig = {
     transpilePackages: ["@repo/types"],
   };

   export default nextConfig;
   ```
3. **Copy** the COPY files. `diff -rq` the folders (`components/ui`, `hooks/auth`, `store`, `types`,
   `lib/google`) against `@pt-web/src/...`.
4. **`lib/api.ts`** (ADAPT). From PaperTrail's file, remove two blocks in the request interceptor:
   ```ts
   // removed until Phase 10 (businesses):
   //   const orgId = useOrgStore.getState().selectedOrgId;
   //   if (orgId) config.headers["X-Org-Id"] = orgId;
   // Phase 10: restore the X-Org-Id header with org.store.ts.

   // removed for good: this API has no idempotency-key middleware (inherited-architecture.md,
   // "Deliberately not copied"). An unknown header would also have to be allowed in CORS.
   //   if (!config.headers["Idempotency-Key"]) config.headers["Idempotency-Key"] = crypto.randomUUID();
   ```
   and the `useOrgStore` import. Everything else is PaperTrail's: the wake timers, `AUTH_ROUTES`, the
   refresh queue, `clearAuth()` + `clearUserQueries()` on refresh failure, error normalisation.
5. **`lib/queryClient.ts`** (ADAPT): only `USER_SCOPED_KEYS`, as in §5.
6. **Branding.** `AuthLoader`'s splash ("Welcome to **Enquiry** Assistant", "Replies you approve"),
   `layout.tsx` metadata (`title: "AI Enquiry Assistant"`, `description: "Draft replies to customer
   messages — a person approves every one"`), the auth pages' headings. Classes stay inline.
7. **`app/page.tsx`**: PaperTrail redirects `/` to `/inbox` or `/login`. Here `/` is a short public
   landing page for owners: one line ("Faster, consistent replies — you approve every one"), three
   bullets (it reads your form and inbox; it drafts from your own info sheet; nothing is sent until a
   person approves), **Sign in** and **Create account** buttons. A signed-in user is redirected to
   `/inbox` in an effect, the way PaperTrail's page does it. A link to the demo business comes in
   Phase 33.
8. **`(app)/layout.tsx`** (ADAPT): `RequireAuth` around a header with the product name, nav links
   **Inbox** (`/inbox`), **Bookings**, **Stats**, **Settings**, **Account**, and the logout button
   (`useLogout`). Leave `{/* Phase 10: <OrgSwitcher /> */}` and `{/* Phase 22: <UsageMeter /> */}`
   where PaperTrail has them. Links to pages that don't exist yet are fine: they 404 until their phase.
9. **`(app)/inbox/page.tsx`**: a heading and an empty state, "No messages yet. Messages from your
   website form and Gmail will appear here." Phase 23 replaces it.
10. **`(app)/account/page.tsx`**: COPY. It lists `GET /session` (device, created, "this device") and
    revokes with `DELETE /session/:id` through `useAccountSessions`. Revoking the current session
    behaves like logout.
11. `.env.example` (and `.env.local`):
    ```
    NEXT_PUBLIC_API_URL=http://localhost:5000
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=
    ```
12. Root `turbo.json` already runs `dev`/`build`/`lint`/`typecheck` per workspace (Phase 00). Confirm
    `pnpm dev` now starts the API and the web together.

## 7. Verify

```bash
docker compose up -d && pnpm dev            # api :5000 (+ workers), web :3000
```

In the browser:
1. `http://localhost:3000/` shows the landing page; **Create account** → register → "check your email".
2. `curl -s "localhost:5000/auth/dev/latest-link?email=<you>" | jq -r .email.link`, then open the link.
   You see "Email verified".
3. Log in. You land on `/inbox` with the empty state. `/account` lists this session as "this device".
4. **Guards**: log out, open `/account` → redirected to `/login?from=%2Faccount`. Log in → back on
   `/account`. Open `/login?from=//evil.example` while signed in → you land on `/inbox`, not the
   other site.
5. **Silent refresh**: in DevTools → Application, delete the `accessToken` cookie for `localhost:5000`
   (keep `refreshToken`) and reload `/account`. The Network tab shows one `/auth/me` 401, **one**
   `/auth/refresh` 200, then the replayed `/auth/me` 200. You stay signed in.
6. **Concurrent 401s**: with the access cookie deleted, open `/account` (it fires `/auth/me` and
   `/session` together). Still exactly one `/auth/refresh`.
7. **Refresh failure**: delete both cookies, click anything → redirected to `/login`; the Query
   Devtools show no `sessions`/`profile` data left.
8. **Revoke**: sign in in a second browser, revoke it from `/account` in the first. The second's next
   click → `/login` (the API rejects the session immediately, Phase 07).
9. **Wake notice**: stop the API, reload → after ~3 s "Server is waking up…" appears; start the API →
   "Server is ready", and the page loads without a manual reload.
10. **Google**: the Google button signs in (with `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set).

```bash
pnpm --filter web build        # Next 16 (Turbopack) build succeeds; route list shows / /login /register … /inbox /account
pnpm --filter web lint && pnpm --filter web typecheck
grep -rn "process.env\[" apps/web/src && echo "dynamic env access found" || echo "ok: literal env only"
diff -rq ~/Code/paper-trail/apps/web/src/components/ui apps/web/src/components/ui     # nothing
```

## 8. Definition of done

- [ ] Register → verify → login → `/inbox` works end to end in the browser.
- [ ] One `/auth/refresh` per expiry, however many requests 401 together; failed refresh → `/login`
      with user-scoped queries cleared.
- [ ] `GuestOnly` rejects `//host` redirects.
- [ ] `/account` lists and revokes device sessions.
- [ ] The wake notice appears and clears on its own.
- [ ] `next build` passes on Next 16 (or Next 15 is pinned with the reason in `tasks/lessons.md`).
- [ ] No `X-Org-Id` or `Idempotency-Key` header is sent yet; `// Phase 10:` marks where the org header goes.
- [ ] COPY files are identical to `@pt-web`.
- [ ] Commit: `feat(web): Next.js foundation with silent refresh, guards and device sessions`.

## 9. Interview angle

*"Your access token expires while the inbox fires five requests. What happens?"* The first 401 starts
one refresh on a separate axios instance. The other four wait in a queue and are replayed when it
succeeds, so the user sees nothing. If the refresh fails, the queue is rejected, the auth store and
every user-scoped query are cleared, and the user lands on login. Auth routes are exempt, so a wrong
password can't trigger a refresh loop.

*"Why aren't your routes protected in Next.js middleware?"* Because the session cookies belong to the
API's domain. A proxy running on the web's domain can't see them. The client asks the API who it is and
renders accordingly, and the API authorises every request anyway. The client guard is UX; the API is
the security boundary.

*"Why clear the query cache on logout?"* A clinic's front desk shares one computer. Without it, the
next person's first render could show the previous person's inbox from cache. Every customer-data key
is listed, including ones for screens that don't exist yet, because forgetting one later would be a
leak.
