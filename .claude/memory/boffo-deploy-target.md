---
name: boffo-deploy-target
description: "Deploy with plain `catalyst deploy` from the repo root — the live app is boffo-granito-export-tracker (925638796), the .catalystrc active project"
metadata:
  node_type: memory
  type: project
  originSessionId: 9e7f82ea-8a56-4661-b348-2053151d6821
---

The live BOFFO app is **boffo-granito-export-tracker** (project 69851000000043001, env 925638796), URL
https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/app/index.html — the
`.catalystrc` active/default project (idx 2). A plain `npx catalyst deploy` from the repo root (after
`npm run build`) ships client + `api-health` + `data-ops` there; CR-411…414 (2026-10-24) went out that way and
`scripts/drive-cr*.mjs` default to that host.

**History (superseded):** 2026-06/07 this note said the live app had moved to `boffo-latest-project`
(76673000000030007, org 926227227) and that a bare deploy hit "the old project". By 2026-10 the user works on
the export-tracker URL and every deploy note in CHANGE-REQUESTS.md cites plain `catalyst deploy`. Do not pass
`--project boffo-latest-project` unless the user says so.

**How to apply:** `npm run build && npx catalyst deploy` from the repo root; smoke = app 200, `/server/api-health`
ok, any data-ops route answers JSON.
