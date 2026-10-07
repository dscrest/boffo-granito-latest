/* Suitable containers for a quote (CR-262) — pure, so containerOptions.test.ts runs under node.
   Lines are grouped by the item's SIZE; each size lists EVERY Container Master format it has
   (CR-273) and how many such containers the quoted boxes need. */

/** Size ROWID → the container that size packs into: the pick for that size when it still
    exists and is of that size, else the size's LARGEST (most boxes; ties → first met). CR-274. */
export function resolveFormatBySize<T extends { id: string; sizeId: string; totalBoxes: number }>(
  rows: T[],
  picks: Record<string, string> = {},
): Map<string, T> {
  const m = new Map<string, T>();
  rows.forEach((r) => {
    if (!r.sizeId) return;
    const cur = m.get(r.sizeId);
    if (!cur || r.totalBoxes > cur.totalBoxes) m.set(r.sizeId, r);
  });
  for (const [sizeId, id] of Object.entries(picks)) {
    const f = rows.find((r) => r.id === id && r.sizeId === sizeId);
    if (f) m.set(sizeId, f);
  }
  return m;
}

export interface ContainerOption {
  sizeId: string;
  sizeLabel: string;
  boxes: number; // quoted boxes of this size
  format: { id: string; name: string; totalPallets: number; totalBoxes: number } | null;
  containers: number; // ceil(boxes / totalBoxes); 0 when no format
  lastFillPct: number; // fill of the last container, 0..100; 0 when no format
}

export function containerOptions(
  lines: { item: string; qty: number }[],
  designs: { uniqueName: string; designName: string; sizeId: string; sizeLabel: string }[],
  formats: { id: string; name: string; sizeId: string; totalPallets: number; totalBoxes: number }[],
): ContainerOption[] {
  const bySize = new Map<string, ContainerOption>();
  for (const l of lines) {
    if (!l.item || l.qty <= 0) continue;
    const d = designs.find((x) => x.uniqueName === l.item || x.designName === l.item);
    if (!d) continue;
    const key = d.sizeId || d.sizeLabel;
    const cur = bySize.get(key) ?? { sizeId: d.sizeId, sizeLabel: d.sizeLabel, boxes: 0, format: null, containers: 0, lastFillPct: 0 };
    cur.boxes += l.qty;
    bySize.set(key, cur);
  }
  const out: ContainerOption[] = [];
  for (const o of bySize.values()) {
    const fs = formats.filter((x) => x.sizeId && x.sizeId === o.sizeId && x.totalBoxes > 0);
    if (fs.length === 0) {
      out.push(o);
      continue;
    }
    for (const f of fs) {
      const rem = o.boxes % f.totalBoxes;
      out.push({
        ...o,
        format: { id: f.id, name: f.name, totalPallets: f.totalPallets, totalBoxes: f.totalBoxes },
        containers: Math.ceil(o.boxes / f.totalBoxes),
        lastFillPct: Math.round(((rem === 0 ? f.totalBoxes : rem) / f.totalBoxes) * 100),
      });
    }
  }
  return out;
}
