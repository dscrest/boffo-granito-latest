/* ============================================================
   Plan Containerisation — /quotes/:id/containerise (More menu).

   Live planning sandbox for a quote: shows how many shipping
   containers the quoted quantities fill, as container cards with
   per-pallet slot cells colored per line item. The salesperson
   drags line quantities (sliders) or applies the trim/add
   suggestions to land on whole containers, then Saves — one atomic
   update-quote-with-items call. Nothing about the plan itself is
   persisted; it is always recomputed from the quote + masters.

   Packaging resolves Design → size → Pallet(size) arrangement A;
   pallet positions per container type come from the Container
   master (most common capacity_pallets per type), with constants
   as the empty-master fallback. Lines with missing packing data
   render as an "unpackable" row and are excluded from the math.
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import type { Quote } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { listPallets, cachedPallets, type PalletRow } from "@/features/masters/palletsApi";
import {
  listContainers,
  cachedContainers,
  CONTAINER_TYPES,
  type ContainerRow,
} from "@/features/masters/containersApi";
import { STATUS_CHIP, STATUS_LABEL, quoteToInput } from "./QuotesTable";
import {
  cachedQuotes,
  invalidateQuotes,
  listQuotes,
  updateQuoteWithItems,
} from "./quotesApi";

/* Slot colors per line index — existing stage accent palette. */
const LINE_COLORS = ["var(--c-blue)", "var(--c-green)", "var(--c-amber)", "var(--c-violet)", "var(--c-cyan)"];

/* Pallet positions per container type when the Container master has no
   record of that type yet (real capacities always win — see capacityFor). */
const FALLBACK_POSITIONS: Record<string, number> = { "20ft": 10, "40ft": 20, "40HQ": 22 };

/** Pallet positions for a type = most common capacity_pallets among that
    type's Container rows; fallback constant when the master is empty. */
function capacityFor(type: string, containers: ContainerRow[]): number {
  const counts = new Map<number, number>();
  containers
    .filter((c) => c.containerType === type && c.capacityPallets > 0)
    .forEach((c) => counts.set(c.capacityPallets, (counts.get(c.capacityPallets) || 0) + 1));
  let best = 0;
  let bestN = 0;
  counts.forEach((n, cap) => {
    if (n > bestN) {
      bestN = n;
      best = cap;
    }
  });
  return best || FALLBACK_POSITIONS[type] || 20;
}

interface PackedLine {
  idx: number; // quote.lines index (stable key + color)
  item: string;
  sku: string;
  designId: string;
  pcsPerBox: number;
  boxesPerPallet: number;
  boxes: number; // current (possibly edited) qty in boxes
  pcs: number;
  pallets: number;
  color: string;
}
interface UnpackableLine {
  idx: number;
  item: string;
  designId: string;
  boxes: number;
  reason: string;
}
/** One pallet position: which line it belongs to + the boxes actually on it
    (the line's last pallet carries the remainder), so per-container sums are exact. */
interface Slot {
  idx: number;
  boxes: number;
}

export function PlanContainerisation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { designRows } = useMasters();

  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [pallets, setPallets] = useState<PalletRow[]>(() => cachedPallets() ?? []);
  const [containers, setContainers] = useState<ContainerRow[]>(() => cachedContainers() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<string>("40ft");
  const [selected, setSelected] = useState<number | null>(null); // container index; null = tail
  const [flexIdx, setFlexIdx] = useState<number | null>(null); // "Adjust" line; null = tail owner
  // Edited quantities in BOXES, keyed by line index; seeded from the quote.
  const [qtyByIdx, setQtyByIdx] = useState<Record<number, number>>({});

  const quote = useMemo(() => quotes.find((q) => q.id === id) ?? null, [quotes, id]);

  const load = async () => {
    const [q, p, c] = await Promise.all([listQuotes(), listPallets(), listContainers()]);
    setLoading(false);
    if (q.ok) setQuotes(q.quotes);
    if (p.ok) setPallets(p.pallets);
    if (c.ok) setContainers(c.containers);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed edited quantities whenever the underlying quote changes (load/save).
  useEffect(() => {
    if (!quote) return;
    const seed: Record<number, number> = {};
    quote.lines.forEach((l, i) => (seed[i] = l.qty));
    setQtyByIdx(seed);
  }, [quote?.id, quote?.modifiedTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const cap = useMemo(() => capacityFor(type, containers), [type, containers]);

  /* ---- packaging resolution: Design → size → Pallet(size), arrangement A ---- */
  const { lines, unpackable } = useMemo(() => {
    const lines: PackedLine[] = [];
    const unpackable: UnpackableLine[] = [];
    (quote?.lines ?? []).forEach((l, idx) => {
      const boxes = qtyByIdx[idx] ?? l.qty;
      const d = designRows.find((x) => x.designName === l.item);
      if (!d) {
        unpackable.push({ idx, item: l.item, designId: "", boxes, reason: "item not found in Item master" });
        return;
      }
      if (!(d.pcsPerBox > 0)) {
        unpackable.push({ idx, item: l.item, designId: d.id, boxes, reason: "Pcs/Box not set on the item" });
        return;
      }
      // ponytail: first pallet format for the size (arrangement A); a per-line
      // pallet picker can follow if sizes grow multiple formats.
      const pallet = pallets.find((p) => p.sizeId && p.sizeId === d.sizeId && p.boxesPerPallet > 0);
      if (!pallet) {
        unpackable.push({ idx, item: l.item, designId: d.id, boxes, reason: "no Pallet format for this size" });
        return;
      }
      lines.push({
        idx,
        item: l.item,
        sku: d.sku,
        designId: d.id,
        pcsPerBox: d.pcsPerBox,
        boxesPerPallet: pallet.boxesPerPallet,
        boxes,
        pcs: boxes * d.pcsPerBox,
        pallets: Math.ceil(boxes / pallet.boxesPerPallet),
        color: LINE_COLORS[idx % LINE_COLORS.length],
      });
    });
    return { lines, unpackable };
  }, [quote, qtyByIdx, designRows, pallets]);

  /* ---- pack: flatten pallets in line order, chunk by container capacity ---- */
  const slots = useMemo<Slot[]>(() => {
    const out: Slot[] = [];
    for (const l of lines) {
      let left = l.boxes;
      for (let k = 0; k < l.pallets; k++) {
        const b = Math.min(left, l.boxesPerPallet);
        out.push({ idx: l.idx, boxes: b });
        left -= b;
      }
    }
    return out;
  }, [lines]);

  const totalPallets = slots.length;
  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);
  const nContainers = totalPallets > 0 ? Math.ceil(totalPallets / cap) : 0;
  const rem = totalPallets % cap;
  const sel = Math.min(selected ?? Math.max(0, nContainers - 1), Math.max(0, nContainers - 1));
  const selSlots = slots.slice(sel * cap, sel * cap + cap);

  const byLine = (list: Slot[]) => {
    const m = new Map<number, { pallets: number; boxes: number }>();
    list.forEach((s) => {
      const cur = m.get(s.idx) || { pallets: 0, boxes: 0 };
      cur.pallets += 1;
      cur.boxes += s.boxes;
      m.set(s.idx, cur);
    });
    return m;
  };
  const selByLine = byLine(selSlots);

  /* ---- suggestions: trim/add the flex line to land on whole containers ---- */
  // Default "Adjust" line = the one occupying the tail container.
  const tailOwnerIdx = slots.length ? slots[slots.length - 1].idx : null;
  const effFlexIdx = flexIdx ?? tailOwnerIdx;
  const flex = lines.find((l) => l.idx === effFlexIdx) || lines[0];

  const setQty = (idx: number, boxes: number) =>
    setQtyByIdx((p) => ({ ...p, [idx]: Math.max(0, Math.round(boxes)) }));

  const suggestions: {
    sign: string;
    color: string;
    headline: string;
    detail: string;
    apply: () => void;
  }[] = [];
  if (rem !== 0 && flex) {
    const downBoxes = Math.min(flex.boxes, rem * flex.boxesPerPallet);
    const upBoxes = (cap - rem) * flex.boxesPerPallet;
    const nDown = Math.floor(totalPallets / cap);
    const nUp = nContainers;
    if (downBoxes > 0 && nDown > 0) {
      suggestions.push({
        sign: "−",
        color: "var(--c-red)",
        headline: `Trim ${fmt(downBoxes * flex.pcsPerBox)} pcs → ship ${nDown} full container${nDown === 1 ? "" : "s"}`,
        detail: `Drop ${flex.item} by ${fmt(downBoxes)} boxes (${rem} pallet${rem === 1 ? "" : "s"}) to ${fmt(flex.boxes - downBoxes)} boxes and nothing travels half empty.`,
        apply: () => setQty(flex.idx, flex.boxes - downBoxes),
      });
    }
    suggestions.push({
      sign: "+",
      color: "var(--c-blue)",
      headline: `Add ${fmt(upBoxes * flex.pcsPerBox)} pcs → fill container ${nUp}`,
      detail: `Raise ${flex.item} by ${fmt(upBoxes)} boxes (${cap - rem} pallet${cap - rem === 1 ? "" : "s"}) to ${fmt(flex.boxes + upBoxes)} boxes and the last ${cap - rem} pallet positions pay for themselves.`,
      apply: () => setQty(flex.idx, flex.boxes + upBoxes),
    });
  }

  const dirty = !!quote && quote.lines.some((l, i) => (qtyByIdx[i] ?? l.qty) !== l.qty);
  const canSave = can("quotes", "edit");

  const onSave = async () => {
    if (!quote || !dirty || saving) return;
    setSaving(true);
    const input = quoteToInput(quote);
    input.lines = input.lines.map((l, i) => ({ ...l, qty: qtyByIdx[i] ?? l.qty }));
    const res = await updateQuoteWithItems(quote.id, input);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(`Quote ${quote.quoteNo} updated`);
    invalidateQuotes();
    await load();
  };

  if (loading && !quote) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading quote…</div>;
  }
  if (!quote) {
    return (
      <div>
        <div className="page-head">
          <div>
            <div className="title">Quote not found</div>
            <div className="sub">No quote matches this link.</div>
          </div>
          <div className="right">
            <button className="hbtn" onClick={() => navigate("/quotes")}>
              <Icon name="chev-l" size={13} /> Back to Quotes
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header — same card pattern as the detail pages; actions right-aligned. */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Plan Containerisation
            </span>
            <span className="mono dim" style={{ fontSize: "var(--t-lg)", fontWeight: 500 }}>{quote.quoteNo}</span>
            <span className={`chip qstatus ${STATUS_CHIP[quote.status]}`}>{STATUS_LABEL[quote.status]}</span>
          </div>
          {canSave && (
            <button className="hbtn primary" disabled={!dirty || saving} onClick={() => void onSave()} title="Save the adjusted quantities to the quote">
              <Icon name="check" size={13} /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          )}
          <button className="btn x" onClick={() => navigate(`/quotes/${quote.id}`)} title="Close">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
          <Link className="linkish" to={`/parties/${encodeURIComponent(quote.partyCode)}`} title="Open customer">
            {quote.customer}
          </Link>
          {quote.quoteDate && <> · {quote.quoteDate}</>}
          {quote.portOfDischarge && <> · {quote.portOfDischarge}</>}
        </div>
      </div>

      {/* Items — qty sliders edit the local plan only until Save. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num" style={{ textAlign: "right" }}>Pcs / Box</th>
                <th className="num" style={{ textAlign: "right" }}>Box / Pallet</th>
                <th style={{ minWidth: 260, textAlign: "center" }}>Order Quantity</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                <th className="num" style={{ textAlign: "right" }}>Pallets</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.idx}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                      <span>
                        {l.item}
                        {l.sku && <div className="mono dim" style={{ fontSize: "var(--t-xs)" }}>{l.sku}</div>}
                      </span>
                    </span>
                  </td>
                  <td className="num mono">{fmt(l.pcsPerBox)}</td>
                  <td className="num mono">{fmt(l.boxesPerPallet)}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 8px" }}>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(l.boxes * 2, l.boxesPerPallet * cap)}
                        step={1}
                        value={l.boxes}
                        disabled={!canSave}
                        onChange={(e) => setQty(l.idx, parseInt(e.target.value, 10) || 0)}
                        style={{ flex: 1, accentColor: "var(--accent)" }}
                        aria-label={`${l.item} order quantity`}
                      />
                      <span className="mono" style={{ fontWeight: 600, width: 76, textAlign: "right" }}>{fmt(l.pcs)} pcs</span>
                    </div>
                  </td>
                  <td className="num mono">{fmt(l.boxes)}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{fmt(l.pallets)}</td>
                </tr>
              ))}
              {unpackable.map((u) => (
                <tr key={`u${u.idx}`} style={{ opacity: 0.7 }}>
                  <td colSpan={5}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, border: "1px dashed var(--dim)", flexShrink: 0 }} />
                      <span>
                        {u.item}{" "}
                        <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
                          ⚠ excluded — {u.reason}
                          {u.designId && (
                            <>
                              {" · "}
                              <Link className="linkish" to={`/design/${u.designId}`}>open item</Link>
                            </>
                          )}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="num mono dim">{fmt(u.boxes)}</td>
                  <td className="num mono dim">—</td>
                </tr>
              ))}
              {quote.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>No line items.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="dim" style={{ textTransform: "uppercase", fontSize: "var(--t-xs)", letterSpacing: "0.05em" }}>Total</td>
                <td /><td /><td />
                <td className="num mono">{fmt(totalBoxes)}</td>
                <td className="num mono" style={{ fontWeight: 600 }}>{fmt(totalPallets)} pallets</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Plan — container cards + inside/suggestions panels. */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>Plan containerisation</span>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {totalPallets > 0
                ? `${(totalPallets / cap).toFixed(1)} containers · ${fmt(totalPallets)} of ${fmt(nContainers * cap)} pallet positions used`
                : "No packable quantities yet"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Container</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              {CONTAINER_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  style={segStyle(t === type)}
                  onClick={() => {
                    setType(t);
                    setSelected(null);
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Container cards */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, padding: "18px 16px", flexWrap: "wrap" }}>
          {Array.from({ length: nContainers }, (_, c) => {
            const mine = slots.slice(c * cap, c * cap + cap);
            const pct = Math.round((mine.length / cap) * 100);
            const full = mine.length === cap;
            const active = c === sel;
            return (
              <div key={c} onClick={() => setSelected(c)} style={{ display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0 2px" }}>
                  <span className="mono dim" style={{ fontSize: "var(--t-xs)" }}>{type} · {c + 1}</span>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: full ? "var(--c-green)" : "var(--c-amber)" }}>{pct}%</span>
                </div>
                <div
                  style={{
                    border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6,
                    background: "var(--panel-2, var(--bg))",
                    boxShadow: active ? "0 4px 14px oklch(0.71 0.17 55 / 0.22)" : "0 1px 2px rgba(0,0,0,0.06)",
                    overflow: "hidden",
                    width: Math.min(cap, Math.ceil(cap / 2)) * 20 + 18,
                  }}
                >
                  {/* corrugated roof */}
                  <div style={{ height: 8, background: "repeating-linear-gradient(90deg, var(--faint) 0 3px, transparent 3px 7px)", borderBottom: "1px solid var(--border)" }} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: 8 }}>
                    {Array.from({ length: cap }, (_, k) => {
                      const s = mine[k];
                      const l = s ? lines.find((x) => x.idx === s.idx) : null;
                      return s ? (
                        <div key={k} title={l?.item} style={{ width: 17, height: 26, borderRadius: 2, background: l?.color || "var(--dim)" }} />
                      ) : (
                        <div
                          key={k}
                          style={{
                            width: 17,
                            height: 26,
                            borderRadius: 2,
                            border: "1px dashed var(--faint)",
                            background: "repeating-linear-gradient(135deg, var(--faint) 0 2px, transparent 2px 6px)",
                            boxSizing: "border-box",
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ height: 6, background: full ? "var(--c-green)" : "var(--faint)", opacity: full ? 0.45 : 0.6 }} />
                </div>
                <div style={{ height: 2, borderRadius: 2, background: active ? "var(--accent)" : "transparent" }} />
              </div>
            );
          })}
          {nContainers === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              Add quantities (or fix the excluded items above) to see containers.
            </div>
          )}
        </div>

        {nContainers > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.1fr) minmax(320px, 1fr)", borderTop: "1px solid var(--border)" }}>
            {/* Inside the selected container */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderRight: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Inside {type} · {sel + 1}
                </span>
                <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{selSlots.length} / {cap} pallet positions</span>
              </div>
              {[...selByLine.entries()].map(([idx, agg]) => {
                const l = lines.find((x) => x.idx === idx);
                if (!l) return null;
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "var(--t-md)" }}>{l.item}</span>
                    <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                      {agg.pallets} pallet{agg.pallets === 1 ? "" : "s"} · {fmt(agg.boxes)} boxes
                    </span>
                    <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, width: 84, textAlign: "right" }}>
                      {fmt(agg.boxes * l.pcsPerBox)} pcs
                    </span>
                  </div>
                );
              })}
              {selSlots.length < cap && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, border: "1px dashed var(--dim)", flexShrink: 0 }} />
                  <span className="dim" style={{ flex: 1, fontSize: "var(--t-md)" }}>Empty pallet positions</span>
                  <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{cap - selSlots.length} free</span>
                </div>
              )}
            </div>

            {/* Talk to the customer */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Talk to the customer
                </span>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="dim" style={{ fontSize: "var(--t-sm)" }}>Adjust</span>
                  <select
                    value={effFlexIdx ?? ""}
                    onChange={(e) => setFlexIdx(Number(e.target.value))}
                    style={{ height: 26, fontFamily: "inherit", fontSize: "var(--t-sm)", border: "1px solid var(--border)", borderRadius: 4, background: "var(--panel, #fff)", padding: "0 6px" }}
                  >
                    {lines.map((l) => (
                      <option key={l.idx} value={l.idx}>{l.item}</option>
                    ))}
                  </select>
                </label>
              </div>
              {suggestions.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: `1px solid color-mix(in oklab, ${s.color} 35%, transparent)`, background: `color-mix(in oklab, ${s.color} 5%, transparent)`, borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: s.color }}>{s.sign}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{s.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{s.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={s.apply}>Apply</button>
                  )}
                </div>
              ))}
              {rem === 0 && totalPallets > 0 && (
                <div style={{ padding: "10px 12px", border: "1px solid var(--c-green)", borderRadius: 6, color: "var(--c-green)", fontWeight: 600, fontSize: "var(--t-md)" }}>
                  Load is balanced — every container ships full.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function segStyle(active: boolean): CSSProperties {
  return {
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    border: 0,
    padding: "4px 12px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "var(--t-sm)",
  };
}
