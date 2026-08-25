/* Self-check for planProgress — run with:  npx tsx client/src/features/quotes/planProgress.test.ts
   Same style as functions/data-ops/lib/fit.test.js: plain asserts, no framework. */
import assert from "node:assert";
import { planProgress, progressSummary } from "./planProgress";
import type { ContainerPlan } from "@/data";

const line = (design: string, boxes: number) => ({ design, palletId: "", palletName: "", pallets: 1, boxes });
// 4 × 500 of one design — the "2000 boxes, four containers" case.
const plan: ContainerPlan = {
  v: 1,
  mode: "boxes",
  containers: [1, 2, 3, 4].map((no) => ({ no, fillPct: 100, pallets: 10, boxes: 500, lines: [line("SLAB-A", 500)] })),
};

// Nothing dispatched → everything Planned.
{
  const r = planProgress(plan, new Map());
  assert.deepStrictEqual(r.map((x) => x.status), ["Planned", "Planned", "Planned", "Planned"]);
  assert.strictEqual(progressSummary(r).sent, 0);
}

// Exactly one container's worth → C1 Sent, the rest Planned.
{
  const r = planProgress(plan, new Map([["SLAB-A", 500]]));
  assert.deepStrictEqual(r.map((x) => x.status), ["Sent", "Planned", "Planned", "Planned"]);
  assert.strictEqual(r[0].pct, 100);
  assert.strictEqual(progressSummary(r).sent, 1);
}

// A partial second container → C1 Sent, C2 Partial at the right pct.
{
  const r = planProgress(plan, new Map([["SLAB-A", 685]]));
  assert.deepStrictEqual(r.map((x) => x.status), ["Sent", "Partial", "Planned", "Planned"]);
  assert.strictEqual(r[1].sent, 185);
  assert.strictEqual(r[1].pct, 37);
}

// Over-supply drains later containers and never goes negative or past 100%.
{
  const r = planProgress(plan, new Map([["SLAB-A", 99999]]));
  assert.ok(r.every((x) => x.status === "Sent" && x.pct === 100 && x.sent === x.boxes));
}

// Mixed designs: one design's surplus must not cover another's container.
{
  const mixed: ContainerPlan = {
    v: 1,
    containers: [
      { no: 1, fillPct: 100, pallets: 2, boxes: 300, lines: [line("A", 200), line("B", 100)] },
      { no: 2, fillPct: 100, pallets: 2, boxes: 300, lines: [line("A", 300)] },
    ],
  };
  const r = planProgress(mixed, new Map([["A", 500], ["B", 0]]));
  assert.strictEqual(r[0].status, "Partial"); // A's 200 covered, B's 100 not
  assert.strictEqual(r[0].sent, 200);
  assert.strictEqual(r[1].status, "Sent"); // A's remaining 300
}

// keyOf maps plan design names onto whatever key the pool uses (Design ROWIDs).
{
  const r = planProgress(plan, new Map([["id-7", 500]]), (d) => (d === "SLAB-A" ? "id-7" : d));
  assert.strictEqual(r[0].status, "Sent");
}

console.log("planProgress: all checks passed");
