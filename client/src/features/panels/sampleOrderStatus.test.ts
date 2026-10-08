/* Self-check: npx tsx client/src/features/panels/sampleOrderStatus.test.ts */
import assert from "node:assert/strict";
import { deriveSampleStatus, remaining } from "./sampleOrderStatus";

assert.equal(deriveSampleStatus([]), "New", "no lines = New (nothing to supply yet)");
assert.equal(deriveSampleStatus([{ qty: 3, suppliedQty: 0 }, { qty: 1, suppliedQty: 0 }]), "New");
assert.equal(deriveSampleStatus([{ qty: 3, suppliedQty: 2 }, { qty: 1, suppliedQty: 0 }]), "PartiallySupplied");
assert.equal(deriveSampleStatus([{ qty: 3, suppliedQty: 3 }, { qty: 1, suppliedQty: 0 }]), "PartiallySupplied", "one full line, one untouched");
assert.equal(deriveSampleStatus([{ qty: 3, suppliedQty: 3 }, { qty: 1, suppliedQty: 1 }]), "Supplied");
assert.equal(remaining({ qty: 3, suppliedQty: 2 }), 1);
assert.equal(remaining({ qty: 3, suppliedQty: 5 }), 0, "over-supply never goes negative");
console.log("sampleOrderStatus: ok");
