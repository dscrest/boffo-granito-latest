/* Short codes (seq_code — the SKU segments) are no longer typed by operators;
   they are assigned in the background on create: max existing numeric code + 1,
   zero-padded to two digits. Legacy non-numeric codes are ignored for the max. */
export function nextSeqCode(existing: Array<string | null | undefined>): string {
  const max = existing.reduce<number>((m, s) => Math.max(m, Number(s) || 0), 0);
  return String(max + 1).padStart(2, "0");
}
