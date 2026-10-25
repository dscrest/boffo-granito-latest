/* Runnable check — node src/features/masters/hubPick.check.ts */
import assert from "node:assert";
import { hubPick } from "./hubPick.ts";

const G = [
  { key: "export", masters: [{ key: "pallets" }, { key: "vehicle" }] },
  { key: "item", masters: [{ key: "items" }, { key: "finish" }] },
];
const pick = (g: string | null, m: string | null) => {
  const r = hubPick(G, g, m);
  return r ? `${r.group.key}/${r.master.key}` : "none";
};
assert.strictEqual(pick(null, null), "export/pallets", "no params → first group, first master");
assert.strictEqual(pick("item", null), "item/items", "?g= alone → that group's first master");
assert.strictEqual(pick(null, "finish"), "item/finish", "legacy ?m= alone → the owning group");
assert.strictEqual(pick("export", "finish"), "export/pallets", "?g= wins over a foreign ?m=");
assert.strictEqual(pick("nope", "vehicle"), "export/vehicle", "unknown ?g= falls back to the owning group");
assert.strictEqual(pick("nope", "nope"), "export/pallets", "unknown both → first visible");
assert.strictEqual(hubPick([], "x", "y"), null, "no visible groups → null");
console.log("hub-pick check: OK");
