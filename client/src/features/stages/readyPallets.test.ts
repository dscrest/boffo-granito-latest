/* Self-check for readyPalletsLabel (CR-279) — run with:  npx tsx client/src/features/stages/readyPallets.test.ts
   Plain asserts, no framework (same style as palSheetEdit.test.ts). */
import assert from "node:assert";
import { readyPalletsLabel } from "./palLoadGate";

// Whole pallets, partial pallet rounds UP, unknown capacity shows boxes only, nothing done = dash.
assert.strictEqual(readyPalletsLabel(480, 60), "8 (480)");
assert.strictEqual(readyPalletsLabel(481, 60), "9 (481)");
assert.strictEqual(readyPalletsLabel(60, 0), "(60)");
assert.strictEqual(readyPalletsLabel(0, 60), "—");
// Formatter is applied to both numbers.
assert.strictEqual(readyPalletsLabel(1040, 65, (n) => n.toLocaleString("en-IN")), "16 (1,040)");

console.log("readyPallets.test.ts: ok");
