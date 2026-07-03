---
name: boffo-deploy-target
description: "Deploy with `catalyst deploy --project boffo-latest-project --org 926227227` — plain `catalyst deploy` hits the OLD project"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9e7f82ea-8a56-4661-b348-2053151d6821
---

The repo's `.catalystrc` still has the OLD project (`boffo-granito-export-tracker`, org OCTFIS 925638796) as active/default, so a bare `catalyst deploy` (or `npm run deploy`) ships to the old, pre-migration app. The live app is **boffo-latest-project** (id 76673000000030007) in org **926227227** — same target the MCP data ops use, see [[catalyst-mcp-server-choice]].

**Why:** The project was migrated (commit a5d5a5a "retarget to migrated project", 2026-06) but the CLI active project was never switched; discovered 2026-07-03 when a deploy landed on the old URL.

**How to apply:** Always deploy with `npx catalyst deploy --project boffo-latest-project --org 926227227` from the repo root. Correct app URL: https://boffo-latest-project-926227227.development.catalystserverless.com/app/index.html

**Update 2026-07-03:** the old project's web client now serves only a redirect page to the new URL (deployed via `--only client --project boffo-granito-export-tracker --org 925638796` with a temporary dist). If the old app must ever be restored, rebuild and redeploy any bundle the same way.
