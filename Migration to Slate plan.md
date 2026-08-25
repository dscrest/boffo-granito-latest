# Migration to Slate — Plan

**Goal:** Move the frontend off Catalyst **Web Client Hosting** (being retired) to **Catalyst Slate**. Slate only replaces frontend hosting — functions, Data Store, and auth stay on Catalyst as-is.

## Current architecture (why it matters)
- `client/` = Vite + React SPA, currently served by Web Client Hosting at the project domain root.
- Client calls `/server/...` **same-origin** in prod (`VITE_API_BASE` unset in `client/.env.example`) → no CORS, and the Catalyst auth session cookie flows automatically.
- Auth = Catalyst embedded auth (`login_redirect: index.html` in `client/public/client-package.json` + `functions/data-ops/lib/appauth.js`).
- Functions live at `https://boffo-granito-export-tracker-925638796.catalystserverless.com/server/...` and **do not move**.
- `catalyst.json` `client.source` = `client/dist`.

## What will NOT break
`functions/data-ops`, `api-health`, Data Store, and all business logic are untouched.

## The real risk: same-origin `/server` + auth cookie
Slate serves the SPA from its **own Slate Access URL** (separate hostname). If the SPA ends up on a different origin than `.../server`:
1. Relative `/server/...` fetches hit the Slate host → **404**. Fix: set `VITE_API_BASE` to the absolute functions URL (escape hatch already wired in `.env.example`).
2. Cross-origin → **CORS** (functions must allow the Slate origin) **+ auth session cookie may stop flowing** (SameSite/cross-site) → login/session breaks. Most likely to bite silently: app loads, then every authenticated call 401s.

**Open question to confirm in console before cutover:** can Slate serve under the same project domain root (keep `/server` same-origin, e.g. via custom domain / API Gateway route), or does it always mint a distinct hostname?

## De-risk FIRST (no prod change) — cross-origin test build
```bash
VITE_API_BASE=https://boffo-granito-export-tracker-925638796.catalystserverless.com/server \
  npm --prefix client run build && npm --prefix client run preview
```
Log in, exercise a few authenticated actions.
- Auth + data both work cross-origin → Slate is safe.
- Auth breaks → sort CORS + cookie/SameSite (or same-origin custom domain) **before** migrating.

## Migration steps (CLI) — run in `client/`
```bash
catalyst login
catalyst init slate          # pick "React + Vite", name app, confirm build cmd + build path (dist)
# set dev_command in cli-config.json to: npm run dev -- --port $ZC_SLATE_PORT
catalyst serve --only slate   # local run through Slate
catalyst deploy slate         # deploys to Development env only
catalyst deploy slate --production
```
- Already-in-console project → `catalyst slate:link` instead of re-init.
- Slate deploys to **Development** env; promote to Production separately.
- Alternative: Slate **Git auto-deploy** (root = `client/`, build = `npm run build`, output = `dist`).

## Cutover checklist
- [ ] Cross-origin test build passes (auth + data)
- [ ] Decide same-origin (custom domain) vs separate Slate host
- [ ] If cross-origin: functions CORS allows Slate origin; auth cookie SameSite verified
- [ ] Verify Vite `base: "./"` assets resolve on Slate host
- [ ] Verify SPA deep-link routing (catch-all → index.html) works on Slate
- [ ] Deploy to Dev env, full e2e (login + orders + palletization flows)
- [ ] Promote to Production; keep Web Client Hosting live until verified
- [ ] Update `.env.example` / docs if `VITE_API_BASE` becomes required

## Sources
- Slate CLI deploy: https://docs.catalyst.zoho.com/en/slate/help/deploy-from-cli
- Slate custom domains: https://docs.catalyst.zoho.com/en/slate/help/custom-domains
- API Gateway key concepts: https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/key-concepts/
- Advanced I/O function URLs: https://docs.catalyst.zoho.com/en/serverless/help/functions/advanced-io/
