/* ============================================================
   CR-507 — one line per item on a Quote / Sales Order.
   Lines whose mergeKey matches (item + rate + discount: a different
   rate OR discount is a different price, so those stay separate — user
   rule 2026-10-31) fold into the first of them, quantities summed.
   `keep` lines (SO lines with work recorded) are never folded away:
   the others fold INTO the first keep line; a second keep line stays.
   ponytail: client-only rule — the server still inserts one row per line,
   so an API caller / seed can still create duplicates.
   ============================================================ */

export function mergeDuplicateLines<T>(
  lines: T[],
  o: { mergeKey: (l: T) => string; qty: (l: T) => number; withQty: (l: T, q: number) => T; keep?: (l: T) => boolean },
): T[] {
  const keep = o.keep ?? (() => false);
  const out: T[] = [];
  const anchorAt = new Map<string, number>(); // mergeKey → index in `out`
  for (const l of lines) {
    const k = o.mergeKey(l);
    const at = anchorAt.get(k);
    if (at == null) {
      anchorAt.set(k, out.length);
      out.push(l);
      continue;
    }
    const anchor = out[at];
    if (keep(l) && !keep(anchor)) {
      // The worked line wins the anchor seat; the plain one folds into it.
      out[at] = o.withQty(l, o.qty(l) + o.qty(anchor));
    } else if (keep(l)) {
      out.push(l); // two worked lines can't merge (server refuses to delete either)
    } else {
      out[at] = o.withQty(anchor, o.qty(anchor) + o.qty(l));
    }
  }
  return out;
}

/** For the live warning: items present on more than one line, and whether
    every one of those lines shares one mergeKey (→ they will merge on save). */
export function duplicateItems<T>(
  lines: T[],
  item: (l: T) => string,
  mergeKey: (l: T) => string,
): Map<string, { lines: number; mergeable: boolean }> {
  const byItem = new Map<string, Set<string>>();
  const count = new Map<string, number>();
  for (const l of lines) {
    const it = item(l).trim().toLowerCase();
    if (!it) continue;
    count.set(it, (count.get(it) || 0) + 1);
    (byItem.get(it) ?? byItem.set(it, new Set()).get(it)!).add(mergeKey(l));
  }
  const out = new Map<string, { lines: number; mergeable: boolean }>();
  for (const [it, n] of count) if (n > 1) out.set(it, { lines: n, mergeable: byItem.get(it)!.size === 1 });
  return out;
}
