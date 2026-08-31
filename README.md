# BOFFO Order OS

Order tracking for a tile exporter — quote → sales order → production → palletization →
loading → dispatch → invoice, so anyone can answer *"where is this order?"* in seconds.

**Vite + React 18 + TypeScript** client on **Zoho Catalyst** (Advanced I/O Functions + Data
Store). There is no Next.js in this project.

## Layout

```
client/              Vite + React 18 + TS  →  Catalyst static hosting
functions/
  data-ops/          the single Express router function (all business routes)
    lib/appauth.js     app-level auth + role permission matrix
    lib/fit.js         pure container-fit optimizer
  api-health/        liveness probe
prototype/           original visual reference — copied verbatim, never edited
scripts/             seed + smoke scripts, run by hand
docs/                see below
```

## Running it

```bash
npm run install:all    # client + functions deps
npm run dev            # Vite dev server
npm run build          # tsc --noEmit && vite build   (typecheck is part of the build)
npm run serve          # catalyst serve
npm run deploy         # catalyst deploy — ships client/dist AND both functions
```

There is no test framework and no CI. Non-trivial pure logic ships a runnable `assert`-based
check beside it — run the relevant one by hand after changing that logic:

```bash
node client/src/lib/stock.invariant.check.ts
node client/src/features/stages/batchStockDerive.check.ts
node client/src/features/stages/batchLedger.check.ts
node client/src/features/reports/bucket.check.ts
node functions/data-ops/lib/fit.test.js
```

## Deploy target

Live Catalyst project **`boffo-granito-export-tracker`** — id `69851000000043001`, org OCTFIS
`925638796`. The old `boffo-latest-project` was deleted 2026-07-04; every `76673…` id you find
in the schema doc belongs to it and is dead.

## Documentation

Read in this order.

| Document | What it answers |
|---|---|
| [`docs/SYSTEM.md`](docs/SYSTEM.md) | **Start here.** How the whole system works today — architecture, the order-to-dispatch flow, every state machine, the stock/batch model, house standards. |
| [`DATASTORE-SCHEMA.md`](DATASTORE-SCHEMA.md) | Every table, column and FK. The source of truth for schema. |
| [`docs/CHANGE-REQUESTS.md`](docs/CHANGE-REQUESTS.md) | What was requested, whether it shipped, and the proof. How to file a new request. |
| [`docs/CHANGES.md`](docs/CHANGES.md) | Dated narrative of what shipped, newest first. |
| [`PRODUCT.md`](PRODUCT.md) | Users, purpose, design principles. |
| [`ARCHITECT-BLUEPRINT.md`](ARCHITECT-BLUEPRINT.md) | House conventions — design tokens, page archetypes, DO/DON'T. |
| [`BOFFO_Architecture.md`](BOFFO_Architecture.md) | The locked architecture decisions and why. |
| [`docs/USER-MANUAL.md`](docs/USER-MANUAL.md) | End-user guide. **Stale from 2026-07-23** for Palletization/Loading/Panel Craft. |

`BOFFO_Build_Plan.md`, `BOFFO_Technical_Plan.md`, `PLAN.md` and `catalyst-migration/` are
pre-build history. They are **not** current spec — where they disagree with `docs/SYSTEM.md`
or the code, they are wrong.
