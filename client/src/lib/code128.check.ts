/* Runnable check — node src/lib/code128.check.ts (same idiom as ean13.check.ts). */
import assert from "node:assert";
import { barcodeProblem, code128Modules, code128TableOk, code128Values } from "./code128.ts";

assert.ok(code128TableOk(), "width table");
assert.strictEqual(barcodeProblem(""), "");
assert.strictEqual(barcodeProblem("LG-60120/A"), "");
assert.ok(barcodeProblem("ąčę"));
assert.ok(barcodeProblem("x".repeat(101)));

// "PJJ123C" → Start B, 48 42 42 17 18 19 35; check = (104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7) mod 103 = 879 mod 103 = 55.
assert.deepStrictEqual(code128Values("PJJ123C"), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
// Subset C for even digit runs: "3212345432345" is odd → B; "32123454323456" → C pairs.
assert.strictEqual(code128Values("3212345432345")[0], 104);
assert.deepStrictEqual(code128Values("32123454323456").slice(0, 8), [105, 32, 12, 34, 54, 32, 34, 56]);

// Structure: Start B = 11010010000, Stop = 1100011101011, 11 modules per symbol + 13 for Stop.
const m = code128Modules("PJJ123C");
assert.ok(m.startsWith("11010010000"));
assert.ok(m.endsWith("1100011101011"));
assert.strictEqual(m.length, 11 * 9 + 13);
assert.throws(() => code128Modules("ąčę"));
console.log("code128 check: OK");
