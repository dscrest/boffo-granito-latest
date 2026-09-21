/* Runnable check — node src/features/masters/palletSize.check.ts */
import assert from "node:assert";
import { palletsForSize } from "./palletSize.ts";

const P = (id: string, sizeLabel: string, sizeId = "s") => ({ id, sizeId, sizeLabel });
const pallets = [P("a", "600x600 - Junglee"), P("b", "600x1200 - GVT"), P("c", "", ""), P("d", "600")];
const ids = (size: string) => palletsForSize(pallets, size).map((p) => p.id).join("");
assert.strictEqual(ids("600x1200"), "bcd", "exact size; size-less + width-only pallets still match");
assert.strictEqual(ids("600x600 - Carving"), "acd");
assert.strictEqual(ids("600"), "abcd", "item without a height falls back to width");
assert.strictEqual(ids(""), "abcd", "unknown size offers everything");
console.log("pallet-size check: OK");
