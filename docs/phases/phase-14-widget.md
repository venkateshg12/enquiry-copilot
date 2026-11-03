# Phase 14 — The embeddable contact-form widget

## 1. Goal

One script tag a business pastes into its website:

```html
<script src="https://api.<host>/widget/enquiry.js"
        data-api-url="https://api.<host>" data-form-key="Xq3…22chars" defer></script>
```

It renders an accessible contact form (name, email or phone, message) inside a **Shadow DOM**, so the
host page's CSS can't break it and its CSS can't leak into the page. It carries the honeypot,
`renderedAt` and a `clientSubmissionId` that survives retries, validates with the same limits as the
API, and shows a calm confirmation or a useful error. It's adapted from CounselDesk's chat widget (same
Vite library build, script-tag configuration, storage guards, `el()` helper). No framework, one file.

The API serves the built file at `GET /widget/enquiry.js`. The web app's **Settings → Website form**
page shows the snippet, the allowed origins and key rotation.

## 2. What I will understand after this phase

1. Why an IIFE single file, and why `document.currentScript` must be read while the script runs.
2. Why Shadow DOM for third-party embeds, and what `:host { all: initial }` does.
3. How the honeypot stays invisible to people and assistive technology but visible to bots.
4. How a retry reuses the same `clientSubmissionId`, and why that makes double submits harmless.
5. Why the widget must never throw into the host page.

## 3. Prerequisites

Phase 13 done (intake endpoint, forms API, per-form CORS).

## 4. Files

```
apps/widget/
├── package.json                    ADAPT  @cd-widget/package.json       (name "widget"; exports "./enquiry.js"; no @repo/types runtime dep)
├── tsconfig.json                   COPY   @cd-widget/tsconfig.json
├── eslint.config.js                COPY   @cd-widget/eslint.config.js
├── vite.config.ts                  ADAPT  @cd-widget/vite.config.ts     (name "EnquiryForm", fileName "enquiry.js")
├── index.html                      ADAPT  @cd-widget/index.html         (hostile host page; data-form-key)
└── src/
    ├── main.ts                     ADAPT  @cd-widget/src/main.ts        (data-form-key, data-accent, data-fallback-phone; mount target)
    ├── form.ts                     NEW    (render, validate, submit, states)
    ├── validate.ts                 NEW    (hand-written mirror of formSubmissionSchema)
    ├── validate.test.ts            NEW    (agrees with the Zod schema on 30 cases)
    ├── api.ts                      ADAPT  @cd-widget/src/api.ts         (postSubmission; credentials "omit"; retry once)
    ├── styles.ts                   ADAPT  @cd-widget/src/styles.ts      (form styles; CSS custom properties)
    └── ui.ts                       ADAPT  @cd-widget/src/ui.ts          (keep el(); drop the chat renderers)
apps/api/
├── package.json                    ADAPT  (+ "widget": "workspace:*" devDependency, so turbo builds it first)
├── src/routes/widget.route.ts      NEW    (GET /widget/enquiry.js)
└── src/app.ts                      ADAPT  (mount /widget before cors())
apps/web/src/
├── api/intakeForm.ts               NEW
├── hooks/intakeForm/{useForms,useSaveForm,useRotateFormKey}.ts   NEW
└── app/(app)/settings/website-form/page.tsx   NEW
```

Deleted after copying: CounselDesk's `widget.ts`, `sse.ts`, `sse.test.ts` (chat only).

## 5. Concepts

**IIFE + `currentScript`.** Vite library mode with `formats: ["iife"]` emits one file with no module
loader, runnable from a plain `<script>`. Configuration rides on the tag's `data-*` attributes, read
**while the script executes**: `document.currentScript` is `null` once it has run, and always `null`
for module scripts (the Vite dev page). CounselDesk's `main.ts` already handles both, with a
`querySelector("script[data-api-url]")` fallback. Keep that.

```ts
// src/main.ts (ADAPT)
import { mountForm } from "./form";

const script =
  (document.currentScript as HTMLScriptElement | null) ??
  document.querySelector<HTMLScriptElement>("script[data-form-key]");

const apiUrl = script?.dataset["apiUrl"]?.replace(/\/$/, "");
const formKey = script?.dataset["formKey"];

if (!apiUrl || !formKey) {
  console.warn("[enquiry] the script tag needs data-api-url and data-form-key");
} else {
  const start = () => {
    try {
      const target = document.querySelector<HTMLElement>("[data-enquiry-form]");
      mountForm({
        apiUrl, formKey, target, after: target ? null : script,
        accent: script?.dataset["accent"], fallbackPhone: script?.dataset["fallbackPhone"],
      });
    } catch (error) {
      console.warn("[enquiry] could not start", error);   // never throw into the host page
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
```

**Shadow DOM.** `host.attachShadow({ mode: "open" })` gives the form its own style scope.
`styles.ts` starts with CounselDesk's `:host { all: initial; }` so inherited page styles (`color`,
`font-family`, `line-height`) don't leak in. The dev page's hostile CSS (`* { font-family: "Comic
Sans MS" !important }`) is the test. Theming goes through a few custom properties, set from
`data-accent` or by the host page on the host element: `--enquiry-accent`, `--enquiry-radius`,
`--enquiry-font`.

**The honeypot, done right.**
```ts
const trap = el("div", { class: "trap", "aria-hidden": "true" });
trap.append(el("label", { for: "ef-company" }, "Company website"),
  el("input", { id: "ef-company", name: "company_website", tabindex: "-1", autocomplete: "off" }));
// .trap { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
```
Off-screen, not `display:none` (some bots skip hidden fields). `tabindex=-1` keeps keyboard users out.
`aria-hidden` on the wrapper keeps screen readers out. `renderedAt = Date.now()` is set when the form
mounts.

**Validation without bundling Zod.** Importing `formSubmissionSchema` would bundle Zod 4 (tens of KB
for a contact form). `validate.ts` is a 30-line hand-written check with the **same limits** (name
1–120, contact 5–200 and email-or-phone shaped, message 2–5,000). `validate.test.ts` runs both the
hand validator and `formSubmissionSchema` (a dev dependency, test-only) on 30 cases (empty, too long,
unicode names, Hinglish, phone with spaces, emoji) and asserts they agree. The API remains the
authority. The client check only spares the customer a round trip.

**Retry without duplicates.** `clientSubmissionId = crypto.randomUUID()` is created when the customer
presses Send and kept until a 202 arrives. `api.ts` retries **once** after 1.5 s on a network error or
5xx, with the same body. A double click, a flaky mobile connection, or a retry after a timeout whose
first request actually landed all hit Phase 13's unique index, and the business sees one message.

**States** (one `aria-live="polite"` status region):

| State | What the customer sees |
| --- | --- |
| idle | the form |
| sending | button disabled, "Sending…" |
| sent (202) | "Thanks, {name}! We'll reply soon." The form is replaced; no resubmit button |
| 400 | the field errors next to the fields (from the envelope's `errors[].path`) |
| 429 | "You've sent a few messages already — we'll get back to you soon." |
| network / 5xx after the retry | "Couldn't send. Please try again{, or call <fallbackPhone>}." The form keeps its text |
| 404 (bad key) | nothing rendered; a console warning for the site owner |

**No storage, no cookies.** It's a one-shot form, so the widget stores nothing. If you add "remember my
name", use `sessionStorage` inside try/catch (CounselDesk's guard: privacy modes and sandboxed iframes
throw). Requests use `credentials: "omit"`. The intake endpoint has no session, and sending the host
site's cookies would be wrong.

**Serving the file.** `GET /widget/enquiry.js` streams `require.resolve("widget/enquiry.js")` (the
workspace package's `exports`) with:
- `Content-Type: text/javascript; charset=utf-8`;
- `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` and an `ETag` (Express's
  `res.sendFile` sets it). An hour-long cache means a fix reaches every site within an hour without
  owners changing their snippet;
- `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`. Helmet's default
  CORP (`same-origin`) would block the script on the business's site. Set it on this route only.

The route is mounted before the global `cors()` and needs no auth.

## 6. Steps

1. Copy CounselDesk's `package.json`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts`,
   `index.html`, `src/{main,api,styles,ui}.ts` into `apps/widget`. Apply the ADAPT notes. Delete the
   chat files. `vite.config.ts`:
   ```ts
   export default defineConfig({
     build: {
       lib: { entry: "src/main.ts", name: "EnquiryForm", formats: ["iife"], fileName: () => "enquiry.js" },
       target: "es2020",
     },
   });
   ```
   `package.json` `exports`: `{ "./enquiry.js": "./dist/enquiry.js" }`. `@repo/types` is a
   devDependency (used by the test only).
2. `ui.ts`: keep `el()`, delete `renderAnswer`, citations and links.
3. `form.ts`: `mountForm(options)` creates the host element (inside `target`, or after the script tag),
   attaches the shadow root, injects `styles`, and renders a `<form novalidate>` with:
   - `<label for>` + input for name (`autocomplete="name"`), contact (`autocomplete="email"`,
     `inputmode="email"`, hint "Email or phone"), and message (`<textarea rows=5>`);
   - the honeypot wrapper;
   - a submit `<button type="submit">`;
   - `<p role="status" aria-live="polite">`.

   On submit: `validate()` → show errors with `aria-invalid` + `aria-describedby` → otherwise
   `postSubmission()` → render the state table above. Focus moves to the status message on success
   and to the first invalid field on error.
4. `api.ts`:
   ```ts
   // Phase 06's visitor key: a random id kept in localStorage (no cookies: a cookie set from a
   // business's site would be a blocked third-party cookie). Fairness only; the IP limit is the real one.
   const visitorId = () => {
     try {
       const existing = localStorage.getItem("enquiry-visitor");
       if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
       const id = crypto.randomUUID().replace(/-/g, "");
       localStorage.setItem("enquiry-visitor", id);
       return id;
     } catch { return null; }                                  // storage blocked: send no header
   };
   export const postSubmission = async (apiUrl: string, formKey: string, body: Submission) => {
     const vid = visitorId();
     const send = () => fetch(`${apiUrl}/intake/form/${encodeURIComponent(formKey)}`, {
       method: "POST", credentials: "omit",
       headers: { "content-type": "application/json", ...(vid ? { "x-enquiry-visitor": vid } : {}) },
       body: JSON.stringify(body),
     });
     let response = await send().catch(() => null);
     if (!response || response.status >= 500) {
       await new Promise((r) => setTimeout(r, 1500));
       response = await send().catch(() => null);
     }
     if (!response) return { kind: "network" } as const;
     if (response.status === 202) return { kind: "sent" } as const;
     const envelope = await response.json().catch(() => null);
     return { kind: "error", status: response.status, errors: envelope?.errors ?? [] } as const;
   };
   ```
5. `index.html`: keep CounselDesk's hostile styles, set `data-api-url="http://localhost:5000"` and a
   real dev form key, and add a `<div data-enquiry-form>` mount point.
6. API `routes/widget.route.ts`:
   ```ts
   const WIDGET_FILE = require.resolve("widget/enquiry.js");
   export const widgetRouter = Router();
   widgetRouter.get("/enquiry.js", (_req, res) => {
     res.set({
       "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
       "Access-Control-Allow-Origin": "*",
       "Cross-Origin-Resource-Policy": "cross-origin",
     });
     res.type("text/javascript").sendFile(WIDGET_FILE);
   });
   ```
   Mount `app.use("/widget", widgetRouter)` next to `/intake`, before `cors()`. If the file is
   missing (widget not built), `require.resolve` throws at boot, which is the fail-at-boot rule.
   `turbo.json`'s `build` already runs `^build` first; add the workspace dependency so `dev` builds it
   too (`"dev": { "dependsOn": ["widget#build"] }` for `api`).
7. Web `settings/website-form`:
   - list the business's forms (`GET /orgs/:orgId/forms`); create one;
   - for each: name, enabled toggle, allowed origins (add/remove, validated client-side with the same
     rule), **Rotate key** (a confirm dialog: "Sites using the old snippet will stop sending messages");
   - the snippet in a `<pre>` with a Copy button, built from `NEXT_PUBLIC_API_URL` and the form key;
   - a "Test this form" link that opens a page on your API's dev host with the snippet (development
     only).

## 7. Verify

```bash
pnpm --filter widget build && ls -l apps/widget/dist/enquiry.js && gzip -c apps/widget/dist/enquiry.js | wc -c
# one file; write the gzipped size in the README (target: under 8 KB)
pnpm --filter widget test           # validate.test.ts: 30 cases agree
pnpm --filter widget dev            # http://localhost:5173 — the hostile page
curl -sI localhost:5000/widget/enquiry.js | grep -Ei 'content-type|cache-control|cross-origin-resource-policy|etag'
```

1. The hostile page (Comic Sans everywhere, yellow buttons) still shows a clean form in the widget's
   own font and colours.
2. Submit → 202 → "Thanks, Ravi!" → a message row with `channel = form`.
3. Fill the honeypot in devtools (inside the shadow root) → still "Thanks", and no new row.
4. DevTools → Network → set "Offline", submit, set "Online" within 1.5 s → one message row (the
   retry reused `clientSubmissionId`). Double-click Send → one row.
5. Keyboard only: Tab goes name → contact → message → Send, never into the honeypot; the accessibility
   tree shows labelled fields and the status region.
6. Stop the API → "Couldn't send… or call 555-…" (with `data-fallback-phone`); the host console shows
   no uncaught error.
7. A bad `data-form-key` → no form; one `[enquiry]` warning.
8. Embed on a page served from an origin **not** in `allowedOrigins` → the browser console shows a
   CORS error and the widget shows the network error state (the request may still have reached the
   API; that's expected, CORS isn't auth).
9. Web: create a form, add `http://localhost:5173`, copy the snippet into `index.html` → it works;
   rotate the key → the old snippet gets 404 (no form rendered).

## 8. Definition of done

- [ ] One-file IIFE build `enquiry.js`, gzipped size recorded.
- [ ] Shadow DOM isolation proven on the hostile page; theming via data attribute / custom properties.
- [ ] Accessible: labels, focus management, `aria-live` status, honeypot unreachable by keyboard and screen readers.
- [ ] Hand validator agrees with `formSubmissionSchema` (tested); one retry with the same `clientSubmissionId`.
- [ ] Never throws into the host page; no storage, no cookies.
- [ ] Served by the API with cache, ETag and cross-origin headers; the web settings page shows the snippet.
- [ ] Commit: `feat(widget): embeddable contact form`.

## 9. Interview angle

*"How does a business add it to their site?"* One script tag. The form lives in a Shadow DOM, so their
CSS can't break it and ours can't break their page. It's about the size of a small image, has no
framework, and never throws into the host page. Bot defences cost nothing: an off-screen honeypot and a
fill-time check, answered with a fake success. Every submit carries an id that's reused on retry, and
the server has a unique index on it, so a flaky phone connection or a double click still gives the
business exactly one message.
