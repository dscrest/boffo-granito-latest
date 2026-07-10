/* Short codes (seq_code — the SKU segments) are no longer typed by operators;
   they are assigned in the background on create: max existing numeric code + 1,
   zero-padded to two digits. Legacy non-numeric codes are ignored for the max. */
export function nextSeqCode(existing: Array<string | null | undefined>): string {
  const max = existing.reduce<number>((m, s) => Math.max(m, Number(s) || 0), 0);
  return String(max + 1).padStart(2, "0");
}

/* Customer numbers (CUS-00001…) — the first of the system-defined
   document sequences (QOT- quotes / INV- invoices to follow the same
   pattern). Legacy hand-typed codes (MRK, DUMMY…) are ignored for the max.
   ponytail: computed client-side from the cached list — two simultaneous
   creators can collide on the code slug key; move into the data-ops
   insert if that ever happens. */
export function nextCustomerCode(codes: Array<string | null | undefined>): string {
  const max = codes.reduce<number>((m, c) => {
    const n = /^CUS-(\d+)$/.exec(c || "");
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `CUS-${String(max + 1).padStart(5, "0")}`;
}
