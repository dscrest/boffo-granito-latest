#!/usr/bin/env bash
# Deploy the Catalyst FUNCTIONS (api-health + data-ops) to the DEMO project
# export-tracker-demo (69851000000395215, org OCTFIS 925638796).
#
# The demo backend serves https://export-tracker-demo.onslate.com with dummy
# data only — never the live project. The CLI reads functions/data-ops/
# catalyst-config.json for env vars, so this script swaps in a demo variant
# (Zoho client creds copied from the live file, demo redirect URI + CORS)
# and restores the live file on exit. Nothing here touches .catalystrc.
#
# Run from the repo root:  bash scripts/deploy-demo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO_PROJECT=69851000000395215
ORG=925638796
DEMO_ORIGIN="https://export-tracker-demo.onslate.com"
CFG=functions/data-ops/catalyst-config.json
LIVE_BACKUP="$CFG.live-backup"

[ -f "$CFG" ] || { echo "missing $CFG (copy catalyst-config.example.json first)"; exit 1; }
cp "$CFG" "$LIVE_BACKUP"
trap 'mv -f "$LIVE_BACKUP" "$CFG"; echo "restored live $CFG"' EXIT

# ponytail: demo config = live config with three env vars overridden; a second
# checked-in config file would duplicate the Zoho secrets.
node - "$CFG" "$DEMO_ORIGIN" <<'EOF'
const fs = require("fs");
const [file, origin] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
const env = (cfg.deployment.env_variables ||= {});
// Zoho sign-in lands on the SLATE page (user 2026-10-25: Slate is where live moves next). This exact
// URI must also be registered on the Zoho API console client (ZOHO_CLIENT_ID) or Zoho rejects it.
env.ZOHO_REDIRECT_URI = "https://export-tracker-demo-kfpljfsy.onslate.com/";
// Both Slate hostnames: the console-created app (clean subdomain) and the CLI-deployed app (suffixed).
env.APP_CORS_ORIGINS = `${origin},https://export-tracker-demo-kfpljfsy.onslate.com,http://localhost:5173`;
env.FX_CRON_KEY = "demo-fx-cron-key"; // demo only — no real cron points here
env.BOFFO_ENV = "demo";
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
EOF

catalyst deploy --only functions -p "$DEMO_PROJECT" --org "$ORG" -ni
echo
echo "demo functions live at https://export-tracker-demo-${ORG}.development.catalystserverless.com/server/api-health"
