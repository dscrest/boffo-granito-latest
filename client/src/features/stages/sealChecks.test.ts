/* Self-check for sealChecks — run with:  npx tsx client/src/features/stages/sealChecks.test.ts */
import assert from "node:assert";
import { duplicateSeals, type SealBox } from "./sealChecks";

const box = (id: string, c = "", e = "", l = ""): SealBox => ({ id, label: `LOAD/${id}`, containerNumber: c, electronicSeal: e, lineSeal: l });
const all = [box("1", "MSCU 471 2280", "EX0448122", "ML1"), box("2", "TGHU2081147", "EX0448126", ""), box("3")];

// clean: blanks never collide
assert.deepEqual(duplicateSeals(all, {}, ["1", "2", "3"]), []);

// a typed e-seal matching another loading (case/space-insensitive) is flagged on the typed row only
const d = duplicateSeals(all, { "3": { electronic_seal: "ex 0448122" } }, ["3"]);
assert.deepEqual(d, [{ boxId: "3", field: "E-seal", value: "ex 0448122", otherLabel: "LOAD/1" }]);

// drafts on the OTHER box count too: clearing box 1's seal removes the clash
assert.deepEqual(duplicateSeals(all, { "3": { electronic_seal: "EX0448122" }, "1": { electronic_seal: "" } }, ["3"]), []);

// container no. compared without spaces; both rows in scope → both flagged
assert.equal(duplicateSeals(all, { "2": { container_number: "MSCU4712280" } }, ["1", "2"]).length, 2);

console.log("sealChecks self-check passed");
