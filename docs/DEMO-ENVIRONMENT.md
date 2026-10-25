# Demo / test environment (export-tracker-demo)

A second, fully separate BOFFO stack for demos and future testing. **It never touches
the live project** (`boffo-granito-export-tracker`, 69851000000043001) or its Data Store.

| Piece | Where |
|---|---|
| Git mirror | `github.com/octfis-dev/export-tracker-demo` — `origin` pushes to it AND to the personal repo in one `git push` (see `git remote -v`) |
| Front end | Catalyst **Slate** app `export-tracker-demo` → **https://export-tracker-demo-kfpljfsy.onslate.com** (deployed from this tree by `scripts/deploy-demo-client.sh`; Slate builds `client/` remotely). The console-created app at https://export-tracker-demo.onslate.com still serves Slate's starter template — delete it or re-point it to the Git repo with the settings below. |
| Back end | Catalyst project **export-tracker-demo** (id `69851000000395215`, org OCTFIS `925638796`) — functions `api-health` + `data-ops`, own Data Store |
| Functions URL | `https://export-tracker-demo-925638796.development.catalystserverless.com/server` |
| Same-origin client (no CORS needed) | **https://export-tracker-demo-925638796.development.catalystserverless.com/app/index.html** — the demo project's own Web Client Hosting, deployed with `catalyst deploy --only client -p 69851000000395215 --org 925638796` after a plain `npm --prefix client run build` (no `VITE_API_BASE`). Same layout as live; works without any Authorized-Domain step. |
| Demo logins | `demo.admin@octfis.com` and `dhiraj.s@octfis.com`, both Admin, password `Demo@1234` (change in Users). |
| Zoho sign-in on the demo | Redirect URI = **`https://export-tracker-demo-kfpljfsy.onslate.com/`** (set by `scripts/deploy-demo.sh`). It must be added as an Authorized Redirect URI on the Zoho API console client `ZOHO_CLIENT_ID` (the same client live uses; a client may list several URIs) — "Invalid Redirect Uri" until then. Cross-origin sign-in works since CR-443 (signed state, no cookie needed). Starting Zoho sign-in from the same-origin `/app/` page also lands on the Slate page afterwards. |
| Data | dummy only — masters from `scripts/seed-demo-masters.mjs`, flows from `scripts/seed-multi.mjs` + `scripts/seed-panel-stages.mjs` (`SEED_HOST` = the functions host above) |

## Deploying the client to Slate

The working path is the CLI, straight from this tree:

```bash
bash scripts/deploy-demo-client.sh "what changed"
```

It copies `client/` to a temp dir (no node_modules / dist), writes
`.env.production` with `VITE_API_BASE` = the demo functions URL and `VITE_DEMO=1`
(hides the BOFFO logo on the login page — `client/src/AuthGate.tsx`), runs `catalyst slate:link`
+ `catalyst deploy slate export-tracker-demo -p 69851000000395215 --org 925638796`, and Slate
installs + builds remotely (`npm install`, `npm run build`, `/dist`). The repo's
`catalyst.json` and `.catalystrc` are never touched.

### Alternative: Git integration (console)

If you prefer auto-deploy on push, create the deployment from the Git repo (not a template) with:

| Setting | Value |
|---|---|
| Branch | `feature/master-order-forms` (or `main` once merged) |
| Framework | Vite / React |
| Root path | `client` |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output path | `dist` |
| Env vars | `VITE_API_BASE=https://export-tracker-demo-925638796.development.catalystserverless.com/server`, `VITE_DEMO=1` |
| Auto Deploy | on |

`VITE_API_BASE` is what points the demo client at the demo backend instead of the
same-origin `/server` the live app uses (`client/src/lib/api.ts`).

## Cross-origin: CORS must be enabled in the Catalyst console

The Slate page and the functions live on different hosts, so every API call is
cross-origin. `data-ops` already reflects the Slate origin (`APP_CORS_ORIGINS`, set by
`scripts/deploy-demo.sh`), **but the Catalyst gateway answers the browser's OPTIONS
preflight itself and sends no CORS headers until the calling domain is authorised**:

Catalyst console → project **export-tracker-demo** → **Cloud Scale ▸ Authentication ▸
Whitelisting ▸ Authorized Domains** → *Add Domain* `https://export-tracker-demo-kfpljfsy.onslate.com`
(and `https://export-tracker-demo.onslate.com` if that app is kept) → toggle **CORS** on → *Configure*.
`scripts/deploy-demo.sh` already puts both hostnames in the function's `APP_CORS_ORIGINS`. The Whitelisting section only appears after one
authentication type (Hosted / Embedded / Third-party) is configured on the project.
Without this the demo page loads but every request fails in the browser.

## Deploying the functions to the demo

```bash
bash scripts/deploy-demo.sh
```

Swaps a demo variant of `functions/data-ops/catalyst-config.json` in (Zoho client creds
copied from the live file; `ZOHO_REDIRECT_URI` → the Slate origin, `APP_CORS_ORIGINS`,
`BOFFO_ENV=demo`), runs `catalyst deploy --only functions -p 69851000000395215 --org
925638796`, and restores the live file on exit. `.catalystrc` is never changed.

## Seeding dummy data

1. **Admin login** — `Role` "Admin" + `AppUser` rows are inserted directly in the demo
   Data Store (see the table ids in `docs/schema/demo-table-ids.json`). Demo credentials
   are in the Users page once signed in.
2. **Masters** — `BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-demo-masters.mjs`
   (idempotent; refuses the live host).
3. **Flows** — `SEED_HOST=https://export-tracker-demo-925638796.development.catalystserverless.com BOFFO_EMAIL=… BOFFO_PASSWORD=… node scripts/seed-multi.mjs`
   and the same for `scripts/seed-panel-stages.mjs`. Both have `--teardown`.
   The scripts resume from `scripts/.seed-flow-state-*.json`; those files now belong to
   the DEMO run. The earlier live-run state files were renamed
   `scripts/.seed-flow-state-live-*.json` (gitignored, kept only for a live `--teardown`).

## Schema

`docs/schema/live-datastore-schema.json` is the column-level snapshot of the live Data
Store taken on 2026-10-25; the demo tables were created from it (FK columns as `bigint`,
as in the 2026-06 account migration). `docs/schema/demo-table-ids.json` maps table name →
demo table id. When a CR adds a column on live, add it on the demo too (Catalyst console
or MCP `Create_Column` on project 69851000000395215) and refresh the snapshot.

## Resetting the demo

Run the seed scripts' `--teardown`, or truncate tables in the demo project
(69851000000395215 only — double-check the project id before any wipe).
