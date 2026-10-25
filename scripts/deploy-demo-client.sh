#!/usr/bin/env bash
# Deploy the CLIENT to the demo Slate app (project export-tracker-demo, org OCTFIS)
# straight from this working tree — no Git-integration settings needed.
#
# Slate builds remotely (npm install + npm run build → /dist), so the demo API
# base is baked in with a Vite .env.production inside the uploaded copy. Works
# from a scratch copy so the repo's catalyst.json / .catalystrc stay untouched.
#
# Run from the repo root:  bash scripts/deploy-demo-client.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO_PROJECT=69851000000395215
ORG=925638796
APP=export-tracker-demo
API_BASE="https://export-tracker-demo-${ORG}.development.catalystserverless.com/server"

S="$(mktemp -d "${TMPDIR:-/tmp}/boffo-slate.XXXXXX")"
trap 'rm -rf "$S"' EXIT
rsync -a --exclude node_modules --exclude dist --exclude .git client/ "$S/client/"
printf 'VITE_API_BASE=%s\nVITE_DEMO=1\n' "$API_BASE" > "$S/client/.env.production"
echo '{}' > "$S/catalyst.json"

cd "$S"
catalyst slate:link --name "$APP" --source ./client -p "$DEMO_PROJECT" --org "$ORG" -ni >/dev/null
catalyst deploy slate "$APP" -p "$DEMO_PROJECT" --org "$ORG" -ni -m "${1:-BOFFO demo client}" | tail -8
