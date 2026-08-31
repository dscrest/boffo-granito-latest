/* Runnable check for the matrix date bucketing (week-start math is the part
   that bites). Run directly with modern Node:
     node src/features/reports/bucket.check.ts
   ponytail: one self-check, no vitest dep. */
import assert from "node:assert";
import { bucketOf, bucketLabel } from "./bucket.ts";

// Day is a pass-through; month truncates.
assert.strictEqual(bucketOf("2026-08-29", "day"), "2026-08-29");
assert.strictEqual(bucketOf("2026-08-29", "month"), "2026-08");

// Week keys on the Monday. 2026-08-29 is a Saturday → w/c Mon 2026-08-24.
assert.strictEqual(bucketOf("2026-08-29", "week"), "2026-08-24", "Saturday → that week's Monday");
assert.strictEqual(bucketOf("2026-08-24", "week"), "2026-08-24", "Monday → itself");
// Sunday is the END of its week, not the start — the classic off-by-one.
assert.strictEqual(bucketOf("2026-08-30", "week"), "2026-08-24", "Sunday → the PRECEDING Monday");
assert.strictEqual(bucketOf("2026-08-31", "week"), "2026-08-31", "next Monday starts a new bucket");
// Week spanning a month/year boundary still walks back correctly.
assert.strictEqual(bucketOf("2026-01-01", "week"), "2025-12-29", "New Year's Day → previous year's Monday");

// Bad/missing input never throws and never fakes a bucket.
for (const bad of ["", "not-a-date", "2026-08"]) {
  assert.strictEqual(bucketOf(bad, "week"), "", `"${bad}" → ""`);
  assert.strictEqual(bucketOf(bad, "month"), "", `"${bad}" → ""`);
}

// Buckets sort lexicographically in chronological order (the matrix relies on it).
const keys = ["2026-01-05", "2025-12-29", "2026-08-24"].map((d) => bucketOf(d, "week"));
assert.deepStrictEqual([...keys].sort(), ["2025-12-29", "2026-01-05", "2026-08-24"], "keys sort chronologically");

// Labels.
assert.strictEqual(bucketLabel("2026-08", "month"), "Aug 2026");
assert.strictEqual(bucketLabel("2026-08-24", "week"), "w/c 24 Aug");
assert.strictEqual(bucketLabel("2026-08-29", "day"), "29 Aug");
assert.strictEqual(bucketLabel("", "day"), "—", "blank bucket renders as a dash, not empty");

console.log("bucket check: OK");
