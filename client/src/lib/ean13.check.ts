/* Runnable check — node src/lib/ean13.check.ts (same idiom as needProduction.check.ts).
   Decodes the bars with the standard digit WIDTH table (space·bar·space·bar run lengths),
   an independent representation from the bit table the encoder uses. */
import assert from "node:assert";
import { ean13Check, ean13Modules, isEan13 } from "./ean13.ts";

// The customer's real codes (photos 3 + 9, 2026-10-30) and the textbook example.
for (const c of ["4778005614206", "4778005609172", "4006381333931", "5901234123457"]) {
  assert.ok(isEan13(c), c);
  assert.strictEqual(ean13Check(c.slice(0, 12)), Number(c[12]), c);
}
assert.ok(!isEan13("4778005614207"));
assert.ok(!isEan13("477800561420"));
assert.throws(() => ean13Modules("4778005614207"));

const WIDTHS = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"];
const FIRST = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
const runs = (bits: string) => (bits.match(/0+|1+/g) || []).map((r) => r.length).join("");
function decode(m: string): string {
  assert.strictEqual(m.length, 95);
  assert.strictEqual(m.slice(0, 3), "101");
  assert.strictEqual(m.slice(45, 50), "01010");
  assert.strictEqual(m.slice(92), "101");
  let parity = "";
  let digits = "";
  for (let i = 0; i < 12; i++) {
    const at = i < 6 ? 3 + i * 7 : 50 + (i - 6) * 7;
    const sym = m.slice(at, at + 7);
    const w = runs(sym);
    let d = WIDTHS.indexOf(w); // L (left) or R (right): widths read as-is
    if (i < 6) {
      if (d >= 0) parity += "L";
      else {
        d = WIDTHS.indexOf([...w].reverse().join("")); // G = mirrored widths
        parity += "G";
      }
      assert.strictEqual(sym[0], "0", "left symbols start with a space");
    } else assert.strictEqual(sym[0], "1", "right symbols start with a bar");
    assert.ok(d >= 0, `symbol ${i} undecodable: ${sym}`);
    digits += d;
  }
  return FIRST.indexOf(parity) + digits;
}
for (const c of ["4778005614206", "4778005609172", "4006381333931", "5901234123457", "0000000000000"]) assert.strictEqual(decode(ean13Modules(c)), c);
console.log("ean13 check: OK");
