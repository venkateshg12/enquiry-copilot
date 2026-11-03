# Phase 13 — The embeddable contact form widget

## 1. Goal

A single script a business pastes into its website:

```html
<script src="https://<api-host>/widget/enquiry.js" data-api-url="https://<api-host>" data-form-key="fk_…" defer></script>
```

It renders an accessible contact form (name, email or phone, message) inside a **shadow DOM**, so the
host page's CSS can't break it and its CSS can't break the host page. It includes the honeypot and
`renderedAt`, validates with the **same Zod schema** as the API, and shows a friendly confirmation.
It's adapted from CounselDesk's chat widget (same build setup, script-tag config, storage guards).
Optional **Cloudflare Turnstile** when spam gets heavy.

## 2. What I will understand after this phase

1. Why an IIFE single file, and how `document.currentScript` carries configuration.
2. Why shadow DOM for third-party embeds.
3. How the honeypot stays invisible to humans and screen readers but visible to bots.
4. Why the widget must keep working when storage, fonts or the API are unavailable.

## 3. Prerequisites

Phase 12 done.

## 4. Files

```
apps/widget/
├── package.json · tsconfig.json · eslint.config.js   ADAPT  @cd-widget/   (name widget; output enquiry.js)
├── vite.config.ts                                     ADAPT  @cd-widget/vite.config.ts   (lib name "EnquiryForm", fileName "enquiry.js")
├── index.html                                         ADAPT  @cd-widget/index.html       (a fake host page for dev)
└── src/
    ├── main.ts                                        ADAPT  @cd-widget/src/main.ts      (data-form-key; mount on [data-enquiry-form] or append)
    ├── form.ts                                        NEW    (render, validate, submit, states)
    ├── api.ts                                         ADAPT  @cd-widget/src/api.ts       (POST /intake/form/:formKey)
    ├── styles.ts                                      ADAPT  @cd-widget/src/styles.ts    (form styles; CSS variables for theming)
    └── ui.ts                                          ADAPT  @cd-widget/src/ui.ts        (the el() helper; drop chat-specific renderers)
apps/api/src/app.ts                                    ADAPT  (serve apps/widget/dist at /widget with long cache + CORS *)
```

## 5. Concepts

**IIFE + `currentScript`.** Vite's library mode with `formats: ["iife"]` produces one file with no
module loader, runnable from a plain `<script>`. Configuration rides on the tag's `data-*`
attributes, read **while the script executes** (`document.currentScript` is `null` afterwards).
CounselDesk's `main.ts` already does exactly this, including the fallback for Vite's dev page.

**Shadow DOM.** `host.attachShadow({ mode: "open" })` gives the form its own style scope. Owners'
sites have aggressive global CSS (`input { width: 100% !important }`), and without isolation the
form would look broken on half of them. Expose a few CSS custom properties
(`--enquiry-accent`, `--enquiry-radius`, `--enquiry-font`) plus `data-accent`, so it still fits the
brand.

**The honeypot, done right.** Field `company_website` is positioned off-screen (not `display:none`;
some bots skip hidden fields), `tabindex="-1"`, `autocomplete="off"`, and `aria-hidden="true"` on its
wrapper, so keyboard and screen-reader users never meet it. `renderedAt` is set when the form mounts.

**Shared validation.** The widget imports `formSubmissionSchema` from `@repo/types`. Bundling Zod adds
~13 KB gzipped. Acceptable, or write a 20-line hand validator with the same limits and a unit test
asserting it agrees with the schema on 30 cases (cheaper bytes, same rules). Choose one and write it
down.

**Resilience.**
- No storage needed (it's a one-shot form). Any optional "remember my name" uses `sessionStorage` in
  try/catch (CounselDesk's guard).
- Network failure → "Couldn't send. Please try again, or call <business phone from data-fallback-phone>".
- The API's 429 → "You've sent several messages already — we'll get back to you soon."
- It never throws into the host page: wrap mounting in try/catch and `console.warn` with a prefix.

**Turnstile (optional).** With `data-turnstile-sitekey`, the widget loads Cloudflare's script and sends
the token. The API verifies it (`TURNSTILE_SECRET`) before the honeypot checks. It's off by default:
it adds friction for real customers.

## 6. Steps

1. Copy CounselDesk's `package.json`, `tsconfig.json`, `eslint.config.js`, `vite.config.ts`,
   `index.html` and `src/{main,api,styles,ui}.ts`, then adapt as listed. Delete the chat-only files
   (`sse.ts`, `widget.ts`, and their tests). Add `@repo/types` as a dependency if you bundle Zod.
2. `form.ts`: `mountForm({ apiUrl, formKey, accent, fallbackPhone })` → host element → shadow root →
   a `<form>` with labelled inputs (`<label for>`), the honeypot, a submit button with a busy state,
   and an `aria-live="polite"` status region. Submit → validate → `fetch(POST)` with
   `{ ...fields, renderedAt, pageUrl: location.href }`, with no cookies (`credentials: "omit"`; the
   intake endpoint has no session).
3. Mount target: an element `[data-enquiry-form]` if present, else append after the script tag.
4. API: serve the built file at `/widget/enquiry.js` with
   `Cache-Control: public, max-age=3600` and `Access-Control-Allow-Origin: *` (the script itself is
   public).
5. Settings → **Channels → Website form** in the web app: shows the snippet with the business's form
   key, allowed origins (Phase 12's CORS list) and "Rotate key".

## 7. Verify

1. `pnpm --filter widget dev` → the fake host page (with hostile global CSS) still shows a clean form.
2. Submit → 202 → "Thanks! We'll reply soon." → the message appears in `db.messages`.
3. Fill the honeypot with devtools → still "Thanks", and nothing stored.
4. Keyboard only: Tab skips the honeypot; labels are read by a screen reader (check with the
   accessibility tree).
5. API down → the friendly error with the fallback phone; the host page's console shows no uncaught
   errors.
6. `pnpm --filter widget build` → one `dist/enquiry.js`; note its gzipped size in the README.

## 8. Definition of done

- [ ] A single-file, shadow-DOM, accessible form that validates like the API and survives hostile pages.
- [ ] Served from the API; the snippet is shown in settings.
- [ ] Commit: `feat(widget): embeddable contact form`.

## 9. Interview angle

*"How does a business add it to their site?"* One script tag. The form lives in a shadow DOM so their
CSS can't break it. It validates with the same schema as the API, and bot defences (honeypot, fill
time, optional Turnstile) make spam cost almost nothing before any AI runs.
