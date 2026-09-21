/* ============================================================
   allocateFifo — map a wanted box count onto actual PalPlanLine rows.
   Drains `want` boxes FIFO across `lines` (pass them in creation order);
   `boxes` is omitted when a whole line is consumed so the server skips
   the split. Once used by the New Loading modal's plan view (a plan quantity is per
   design, the stock is per line).
   ============================================================ */

export function allocateFifo(
  lines: Array<{ id: string; boxes: number }>,
  want: number,
): Array<{ lineId: string; boxes?: number }> {
  const out: Array<{ lineId: string; boxes?: number }> = [];
  let left = Math.max(0, Math.floor(want));
  for (const l of lines) {
    if (left <= 0) break;
    if (l.boxes <= 0) continue;
    const take = Math.min(left, l.boxes);
    out.push({ lineId: l.id, ...(take < l.boxes ? { boxes: take } : {}) });
    left -= take;
  }
  return out;
}
