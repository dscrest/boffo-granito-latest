/* ============================================================
   Plan Containerisation — /quotes/:id/containerise (More menu).

   Weight-based, item-wise container planning for a quote. Each
   container has a Ton capacity (default 28 t, editable) and a
   line's boxes-per-container = floor(tonCapacity·1000 / boxWeightKg)
   from its chosen Pallet format (per-box weight snapshotted from the
   Size master). Packing is strictly item-wise, in line order (line 1
   first): every container holds a single item, so raising an item's
   quantity refills its own partial container before opening a new one
   — it never spills into another item's container.

   Items are fully editable here: change the item, edit the quantity
   (no cap) and rate, add brand-new items, or remove lines. Save
   persists the full line set (add/remove/change) to the quote in one
   update-quote-with-items call (which replaces all lines wholesale),
   together with a container-plan snapshot + the ton capacity.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { parseContainerPlan, type ContainerPlan, type Quote } from "@/data";
import { useMasters } from "@/features/masters/useMasters";
import { listPallets, cachedPallets, type PalletRow } from "@/features/masters/palletsApi";
import type { DesignRow } from "@/features/masters/designsApi";
import { STATUS_CHIP, STATUS_LABEL, quoteToInput } from "./QuotesTable";
import {
  cachedQuotes,
  invalidateQuotes,
  listQuotes,
  updateQuoteWithItems,
} from "./quotesApi";

/* Slot colors per line index — existing stage accent palette. */
const LINE_COLORS = ["var(--c-blue)", "var(--c-green)", "var(--c-amber)", "var(--c-violet)", "var(--c-cyan)"];

const EPS = 1e-6;
const DEFAULT_TON_CAPACITY = 28;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Leading dimension of a size string ("300x600 - GVT…" → "300") — same
// matcher as PalPlanForm's per-line pallet-size filtering.
const widthOf = (s: string) => String(s || "").match(/^\s*(\d+)/)?.[1] ?? "";

/** An editable plan line (the local source of truth; seeded from the quote). */
interface DraftLine {
  key: string; // stable local id (React key)
  item: string; // design name (matches DesignRow.designName)
  qty: number; // boxes (freely editable, ≥ 0)
  rate: number; // per box
  discount: number; // percent (preserved)
  description: string; // preserved
  palletId: string; // chosen pallet ROWID ("" = auto best-size match)
  ordered?: number; // original quote qty for this row (reference only; undefined for new lines)
}

interface ResolvedLine {
  key: string;
  idx: number; // draftLines index (stable within a render: color + seg join)
  item: string;
  sku: string;
  designId: string;
  qty: number;
  rate: number;
  ordered?: number;
  boxWeightKg: number; // per box
  tonnes: number; // qty * boxWeightKg / 1000 (0 when weight unknown)
  palletId: string;
  palletName: string;
  palletOptions: { value: string; label: string }[];
  boxesPerPallet: number;
  capacityBoxes: number; // floor(tonCapacity·1000 / boxWeightKg)
  pallets: number; // ceil(qty / boxesPerPallet)
  color: string;
  packable: boolean;
  reason?: string; // when !packable
}
/** A line's boxes inside one container. */
interface Seg {
  idx: number;
  boxes: number;
}
interface PackedContainer {
  segs: Seg[]; // single-item now, but kept as a list for the snapshot shape
  fill: number; // boxes / capBoxes — ≤ 1 by construction
  capTons: number; // this container's weight cap (per-container override or global default)
  capBoxes: number; // floor(capTons·1000 / owner box weight)
}

export function PlanContainerisation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { designRows, designs } = useMasters();

  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [pallets, setPallets] = useState<PalletRow[]>(() => cachedPallets() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [saving, setSaving] = useState(false);

  const [selected, setSelected] = useState<number | null>(null); // container index; null = tail
  const [tonCapacity, setTonCapacity] = useState<number>(DEFAULT_TON_CAPACITY); // global default
  const [capByIdx, setCapByIdx] = useState<Record<number, number>>({}); // per-container ton overrides, by position
  // Editable plan lines — the local source of truth; seeded from the quote.
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  const keySeq = useRef(0);
  const nextKey = () => `L${keySeq.current++}`;

  const quote = useMemo(() => quotes.find((q) => q.id === id) ?? null, [quotes, id]);

  const load = async () => {
    const [q, p] = await Promise.all([listQuotes(), listPallets()]);
    setLoading(false);
    if (q.ok) setQuotes(q.quotes);
    if (p.ok) setPallets(p.pallets);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-seed editable lines + ton capacity whenever the underlying quote changes.
  useEffect(() => {
    if (!quote) return;
    setDraftLines(
      quote.lines.map((l) => ({
        key: nextKey(),
        item: l.item,
        qty: l.qty,
        rate: l.rate,
        discount: l.discount,
        description: l.description || "",
        palletId: "",
        ordered: l.qty,
      })),
    );
    const saved = parseContainerPlan(quote.containerPlan);
    const g = saved?.tonCapacity && saved.tonCapacity > 0 ? saved.tonCapacity : DEFAULT_TON_CAPACITY;
    setTonCapacity(g);
    const caps: Record<number, number> = {};
    saved?.containers?.forEach((c, i) => {
      if (c.tonCapacity && c.tonCapacity > 0 && c.tonCapacity !== g) caps[i] = c.tonCapacity;
    });
    setCapByIdx(caps);
  }, [quote?.id, quote?.modifiedTime]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- resolve each draft line: design → size-matched pallet → weight capacity ---- */
  const rows = useMemo<ResolvedLine[]>(() => {
    const tonKg = Math.max(1, tonCapacity) * 1000;
    return draftLines.map((dl, idx) => {
      const color = LINE_COLORS[idx % LINE_COLORS.length];
      const base = { key: dl.key, idx, item: dl.item, qty: Math.max(0, dl.qty), rate: dl.rate, ordered: dl.ordered, color };
      const fail = (reason: string, extra: Partial<ResolvedLine> = {}): ResolvedLine => ({
        ...base,
        sku: "",
        designId: extra.designId ?? "",
        boxWeightKg: extra.boxWeightKg ?? 0,
        tonnes: extra.tonnes ?? 0,
        palletId: extra.palletId ?? "",
        palletName: "",
        palletOptions: extra.palletOptions ?? [],
        boxesPerPallet: 0,
        capacityBoxes: 0,
        pallets: 0,
        packable: false,
        reason,
      });

      if (!dl.item) return fail("choose an item");
      const d: DesignRow | undefined = designRows.find((x) => x.designName === dl.item);
      if (!d) return fail("item not found in Item master");

      // Pallet specs offered = exact size match, else same size WIDTH (PalPlanForm rule).
      const w = widthOf(d.sizeLabel);
      const exact = pallets.filter((p) => p.sizeId && p.sizeId === d.sizeId);
      const wide = pallets.filter((p) => !exact.includes(p) && (!p.sizeId || !w || widthOf(p.sizeLabel) === w));
      const opts = [...exact, ...wide].filter((p) => p.boxesPerPallet > 0);
      const palletOptions = opts.map((p) => ({ value: p.id, label: p.name }));
      if (opts.length === 0) return fail("no Pallet format for this size", { designId: d.id, boxWeightKg: d.boxWeightKg, tonnes: base.qty * (d.boxWeightKg || 0) / 1000 });

      const chosen = opts.find((p) => p.id === dl.palletId) || opts[0];
      const boxWeightKg = chosen.boxWeightKg || d.boxWeightKg;
      const tonnes = base.qty * boxWeightKg / 1000;
      const capacityBoxes = boxWeightKg > 0 ? Math.floor(tonKg / boxWeightKg) : 0;
      if (capacityBoxes < 1) {
        return fail(boxWeightKg > 0 ? "box heavier than container capacity" : "no box weight — set it on the Size/Item master", {
          designId: d.id,
          boxWeightKg,
          tonnes,
          palletId: chosen.id,
          palletOptions,
        });
      }
      return {
        ...base,
        sku: d.sku,
        designId: d.id,
        boxWeightKg,
        tonnes,
        palletId: chosen.id,
        palletName: chosen.name,
        palletOptions,
        boxesPerPallet: chosen.boxesPerPallet,
        capacityBoxes,
        pallets: Math.ceil(base.qty / chosen.boxesPerPallet),
        packable: base.qty > 0,
        reason: base.qty > 0 ? undefined : "quantity is 0",
      };
    });
  }, [draftLines, tonCapacity, designRows, pallets]);

  const lines = useMemo(() => rows.filter((r) => r.packable), [rows]);

  /* ---- pack item-wise: each container holds a single item, in line order.
     Each container (by position) fills to its own ton capacity — the global
     default, or a per-container override (capByIdx). Box capacity converts
     that container's tonnage by the item's box weight. ---- */
  const containers = useMemo<PackedContainer[]>(() => {
    const out: PackedContainer[] = [];
    for (const l of lines) {
      let left = l.qty;
      while (left > 0) {
        const capTons = Math.max(1, capByIdx[out.length] ?? tonCapacity);
        const capBoxes = l.boxWeightKg > 0 ? Math.floor((capTons * 1000) / l.boxWeightKg) : l.capacityBoxes;
        if (capBoxes < 1) break;
        const take = Math.min(left, capBoxes);
        out.push({ segs: [{ idx: l.idx, boxes: take }], fill: take / capBoxes, capTons, capBoxes });
        left -= take;
      }
    }
    return out;
  }, [lines, tonCapacity, capByIdx]);

  // Boxes not fully packed per line — the leftover in each item's partial
  // (not-full) trailing container. Packing is item-wise + sequential, so a
  // line has at most one partial container.
  const partialBoxesByIdx = useMemo(() => {
    const m: Record<number, number> = {};
    for (const c of containers)
      if (c.fill < 1 - EPS) {
        const s = c.segs[0];
        if (s) m[s.idx] = (m[s.idx] ?? 0) + s.boxes;
      }
    return m;
  }, [containers]);
  const totalRemaining = Object.values(partialBoxesByIdx).reduce((s, n) => s + n, 0);

  const totalBoxes = lines.reduce((s, l) => s + l.qty, 0);
  const totalPalletsCount = lines.reduce((s, l) => s + l.pallets, 0);
  const totalTonnes = rows.reduce((s, l) => s + l.tonnes, 0);
  const totalFrac = containers.reduce((s, c) => s + c.fill, 0);
  const nContainers = containers.length;
  const anyPartial = containers.some((c) => c.fill < 1 - EPS);
  const balanced = nContainers > 0 && !anyPartial;

  const sel = Math.min(selected ?? Math.max(0, nContainers - 1), Math.max(0, nContainers - 1));
  const selContainer = containers[sel];

  const lineOf = (idx: number | null | undefined) => lines.find((x) => x.idx === idx);
  const tonnesIn = (c: PackedContainer) => {
    const l = lineOf(c.segs[0]?.idx);
    const boxes = c.segs.reduce((s, x) => s + x.boxes, 0);
    return l ? boxes * l.boxWeightKg / 1000 : 0;
  };

  /* ---- snapshot: what Save publishes for downstream (SO detail, dispatch board) ---- */
  const planJson = useMemo(() => {
    if (!containers.length) return "";
    const plan: ContainerPlan = {
      v: 1,
      tonCapacity: Math.max(1, tonCapacity),
      containers: containers.map((c, i) => {
        const segLines = c.segs.flatMap((s) => {
          const l = lineOf(s.idx);
          return l
            ? [{ design: l.item, palletId: l.palletId, palletName: l.palletName, pallets: Math.ceil(s.boxes / l.boxesPerPallet), boxes: s.boxes }]
            : [];
        });
        return {
          no: i + 1,
          fillPct: Math.min(100, Math.round(c.fill * 100)),
          pallets: segLines.reduce((s, x) => s + x.pallets, 0),
          boxes: segLines.reduce((s, x) => s + x.boxes, 0),
          tonnes: round1(tonnesIn(c)),
          tonCapacity: c.capTons,
          lines: segLines,
        };
      }),
    };
    return JSON.stringify(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, lines, tonCapacity]);

  /** Colored pallet cells of a container (single item): ceil(boxes / box-per-pallet). */
  const cellsOf = (c: PackedContainer) => {
    const cells: { color: string; item: string }[] = [];
    for (const s of c.segs) {
      const l = lineOf(s.idx);
      if (!l) continue;
      const n = Math.max(1, Math.ceil(s.boxes / l.boxesPerPallet));
      for (let k = 0; k < n; k++) cells.push({ color: l.color, item: l.item });
    }
    return cells;
  };
  /** Empty (hatched) cells = the container's box-capacity, in pallet units, minus used. */
  const emptyCellsOf = (c: PackedContainer, used: number) => {
    if (c.fill >= 1 - EPS) return 0;
    const l = lineOf(c.segs[0]?.idx);
    if (!l) return 0;
    const capCells = Math.max(used, Math.ceil(c.capBoxes / l.boxesPerPallet));
    return Math.max(0, capCells - used);
  };

  /* ---- line editing ---- */
  const setLine = (key: string, patch: Partial<DraftLine>) =>
    setDraftLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setDraftLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = () =>
    setDraftLines((ls) => [...ls, { key: nextKey(), item: "", qty: 1, rate: 0, discount: 0, description: "", palletId: "" }]);
  const setQtyByIdx = (idx: number, raw: string) => {
    const r = rows[idx];
    if (r) setLine(r.key, { qty: Math.max(0, Number(raw) || 0) });
  };
  // Per-container ton override; setting it back to the global default clears it (inherits).
  const setCap = (i: number, raw: string) =>
    setCapByIdx((p) => {
      const v = Math.max(1, Number(raw) || 0);
      const next = { ...p };
      if (v === Math.max(1, tonCapacity)) delete next[i];
      else next[i] = v;
      return next;
    });

  /* ---- suggestions: trim / add-to-fill on the selected container ---- */
  let trim: { headline: string; detail: string; apply: () => void } | null = null;
  let add: { headline: string; detail: string; apply: () => void } | null = null;
  if (selContainer && selContainer.fill < 1 - EPS) {
    const l = lineOf(selContainer.segs[0]?.idx);
    const boxesIn = selContainer.segs.reduce((s, x) => s + x.boxes, 0);
    if (l) {
      const upBoxes = selContainer.capBoxes - boxesIn;
      if (upBoxes > 0)
        add = {
          headline: `Add ${fmt(upBoxes)} boxes → fill C${sel + 1}`,
          detail: `${fmt(upBoxes)} more boxes (~${Math.ceil(upBoxes / l.boxesPerPallet)} pallets) of ${l.item} tops C${sel + 1} up to ${fmt(selContainer.capTons)} t.`,
          apply: () => setLine(l.key, { qty: l.qty + upBoxes }),
        };
      if (boxesIn > 0 && l.qty - boxesIn > 0)
        trim = {
          headline: `Trim ${fmt(boxesIn)} boxes → drop part-full C${sel + 1}`,
          detail: `Drop ${l.item} by ${fmt(boxesIn)} boxes (~${Math.ceil(boxesIn / l.boxesPerPallet)} pallets) to ${fmt(l.qty - boxesIn)} so its earlier containers all ship full.`,
          apply: () => setLine(l.key, { qty: l.qty - boxesIn }),
        };
    }
  }

  // Dirty when the ton capacity/plan or any line differs from the saved quote.
  const dirty =
    !!quote &&
    (planJson !== (quote.containerPlan || "") ||
      draftLines.length !== quote.lines.length ||
      draftLines.some((l, i) => {
        const o = quote.lines[i];
        return !o || o.item !== l.item || o.qty !== l.qty || o.rate !== l.rate || (o.discount || 0) !== (l.discount || 0);
      }));
  const canSave = can("quotes", "edit");

  const onSave = async () => {
    if (!quote || !dirty || saving) return;
    const valid = draftLines.filter((l) => l.item && l.qty > 0);
    if (!valid.length) {
      toast.error("Add at least one item");
      return;
    }
    setSaving(true);
    const input = quoteToInput(quote);
    input.lines = valid.map((l) => ({ item: l.item, qty: l.qty, rate: l.rate, discount: l.discount || 0, description: l.description || "" }));
    input.container_plan = planJson; // publish the plan for SO detail + dispatch board
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

  const itemOptions = useMemo(
    () => designs.map((x) => ({ value: x.name, label: x.uniqueName || x.name, hint: [x.size, x.finish].filter(Boolean).join(" · ") })),
    [designs],
  );

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
    <div className="qcplan">
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
            <button className="hbtn primary" disabled={!dirty || saving} onClick={() => void onSave()} title="Save the items and plan to the quote">
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

      {/* Items — edit item / quantity / rate / pallet; add or remove lines. */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 240 }}>Item</th>
                <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                <th className="num" style={{ textAlign: "right", width: 120 }}>Boxes</th>
                <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                <th className="num" style={{ textAlign: "right" }}>Tonnes</th>
                <th className="num" style={{ textAlign: "right", width: 110 }}>Rate</th>
                <th style={{ minWidth: 220 }}>Pallet</th>
                <th className="num" style={{ textAlign: "right" }}>Pallets</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.key}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: l.packable ? l.color : "transparent", border: l.packable ? "none" : "1px dashed var(--dim)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <Combobox
                          value={l.item}
                          options={itemOptions}
                          onChange={(v) => setLine(l.key, { item: v, palletId: "" })}
                          placeholder="Search item…"
                          ariaLabel="Item"
                        />
                        {l.sku && <div className="mono dim" style={{ fontSize: "var(--t-xs)", marginTop: 2 }}>{l.sku}</div>}
                        {!l.packable && l.reason && (
                          <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2, color: "var(--c-amber)" }}>
                            ⚠ {l.reason}
                            {l.designId && (
                              <>
                                {" · "}
                                <Link className="linkish" to={`/design/${l.designId}`}>open item</Link>
                              </>
                            )}
                          </div>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="num mono dim">{l.ordered == null ? "—" : fmt(l.ordered)}</td>
                  <td className="num">
                    <NumberInput
                      value={l.qty}
                      onChange={(e) => setQtyByIdx(l.idx, e.target.value)}
                      disabled={!canSave}
                      placeholder="0"
                      style={{ width: 100, textAlign: "right" }}
                      aria-label={`${l.item || "item"} boxes`}
                    />
                  </td>
                  <td className="num mono dim">{l.packable ? fmt(partialBoxesByIdx[l.idx] ?? 0) : "—"}</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{l.boxWeightKg > 0 ? `${round1(l.tonnes).toFixed(1)} t` : "—"}</td>
                  <td className="num">
                    <NumberInput
                      value={l.rate}
                      onChange={(e) => setLine(l.key, { rate: Math.max(0, Number(e.target.value) || 0) })}
                      disabled={!canSave}
                      placeholder="0"
                      style={{ width: 100, textAlign: "right" }}
                      aria-label={`${l.item || "item"} rate`}
                    />
                  </td>
                  <td>
                    <Combobox
                      value={l.palletId}
                      options={l.palletOptions}
                      onChange={(v) => setLine(l.key, { palletId: v })}
                      placeholder={l.palletOptions.length ? "Choose pallet…" : "—"}
                      ariaLabel={`${l.item || "item"} pallet`}
                    />
                  </td>
                  <td
                    className="num mono"
                    style={{ fontWeight: 600 }}
                    title={l.capacityBoxes ? `ceil(${fmt(l.qty)} boxes ÷ ${fmt(l.boxesPerPallet)} box/pallet) = ${fmt(l.pallets)} · a ${fmt(tonCapacity)} t container holds ${fmt(l.capacityBoxes)} boxes` : ""}
                  >
                    {l.capacityBoxes ? fmt(l.pallets) : "—"}
                  </td>
                  <td>
                    <button className="btn ord-rm" onClick={() => removeLine(l.key)} title="Remove line" disabled={!canSave} tabIndex={-1}>✕</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>No items yet — add one below.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="dim" style={{ textTransform: "uppercase", fontSize: "var(--t-xs)", letterSpacing: "0.05em" }}>Total</td>
                <td />
                <td className="num mono">{fmt(totalBoxes)}</td>
                <td className="num mono dim">{fmt(totalRemaining)}</td>
                <td className="num mono" style={{ fontWeight: 600 }}>{round1(totalTonnes).toFixed(1)} t</td>
                <td /><td />
                <td className="num mono" style={{ fontWeight: 600 }}>{fmt(totalPalletsCount)} pallets</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {canSave && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
            <button className="hbtn" onClick={addLine}>
              <Icon name="plus" size={13} /> Add item
            </button>
          </div>
        )}
      </div>

      {/* Plan — ton capacity + container cards + inside/suggestions panels. */}
      <div className="card" style={{ padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>Plan containerisation</span>
          <span className="dim" style={{ fontSize: "var(--t-sm)", flex: 1 }}>
            {nContainers > 0
              ? `${totalFrac.toFixed(1)} containers filled · ${nContainers} needed · ${round1(totalTonnes).toFixed(1)} t`
              : "No packable quantities yet"}
          </span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)" }} title="Default container weight capacity — override any container below">
            <span className="dim">Default</span>
            <NumberInput
              value={tonCapacity}
              onChange={(e) => setTonCapacity(Math.max(1, Number(e.target.value) || DEFAULT_TON_CAPACITY))}
              disabled={!canSave}
              style={{ width: 70, textAlign: "right" }}
              aria-label="Default container ton capacity"
            />
            <span className="dim">t / container</span>
          </label>
        </div>

        {/* Container cards — fixed 4-per-row grid so rows stay aligned. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14, padding: "18px 16px" }}>
          {containers.map((c, i) => {
            const cells = cellsOf(c);
            const empties = emptyCellsOf(c, cells.length);
            const pct = Math.min(100, Math.round(c.fill * 100));
            const full = c.fill >= 1 - EPS;
            const active = i === sel;
            const boxesIn = c.segs.reduce((s, x) => s + x.boxes, 0);
            return (
              <div key={i} onClick={() => setSelected(i)} style={{ display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, padding: "0 2px" }}>
                  <span className="mono dim" style={{ fontSize: "var(--t-xs)" }}>{quote.quoteNo} · C{i + 1}</span>
                  <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: full ? "var(--c-green)" : "var(--c-amber)" }}>{pct}%</span>
                </div>
                <div
                  style={{
                    border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 6,
                    background: "var(--panel-2, var(--bg))",
                    boxShadow: active ? "0 4px 14px oklch(0.71 0.17 55 / 0.22)" : "0 1px 2px rgba(0,0,0,0.06)",
                    overflow: "hidden",
                  }}
                >
                  {/* corrugated roof */}
                  <div style={{ height: 8, background: "repeating-linear-gradient(90deg, var(--faint) 0 3px, transparent 3px 7px)", borderBottom: "1px solid var(--border)" }} />
                  {/* Cells stretch to span the card in 2 rows, so a full container
                      always looks full regardless of its pallet count. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateRows: "repeat(2, 18px)",
                      gridAutoFlow: "column",
                      gridTemplateColumns: `repeat(${Math.max(1, Math.ceil((cells.length + empties) / 2))}, minmax(0, 1fr))`,
                      gap: 2,
                      padding: 6,
                    }}
                  >
                    {cells.map((cell, k) => (
                      <div key={k} title={cell.item} style={{ height: 18, borderRadius: 2, background: cell.color }} />
                    ))}
                    {Array.from({ length: empties }, (_, k) => (
                      <div
                        key={`e${k}`}
                        style={{
                          height: 18,
                          borderRadius: 2,
                          border: "1px dashed var(--faint)",
                          background: "repeating-linear-gradient(135deg, var(--faint) 0 2px, transparent 2px 6px)",
                          boxSizing: "border-box",
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ height: 6, background: full ? "var(--c-green)" : "var(--faint)", opacity: full ? 0.45 : 0.6 }} />
                </div>
                <div className="mono dim" style={{ fontSize: "var(--t-xs)", padding: "0 2px", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span>{round1(tonnesIn(c)).toFixed(1)} /</span>
                  <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                    <NumberInput
                      value={c.capTons}
                      onChange={(e) => setCap(i, e.target.value)}
                      disabled={!canSave}
                      style={{ width: 46, textAlign: "right", padding: "1px 4px", height: 20 }}
                      aria-label={`Container ${i + 1} ton capacity`}
                    />
                  </span>
                  <span>
                    t · {fmt(boxesIn)} boxes
                    {capByIdx[i] != null && <span style={{ color: "var(--accent)" }}> · custom</span>}
                    {!full && <span style={{ color: "var(--c-amber)" }}> · {fmt(Math.max(0, c.capBoxes - boxesIn))} free</span>}
                  </span>
                </div>
                <div style={{ height: 2, borderRadius: 2, background: active ? "var(--accent)" : "transparent" }} />
              </div>
            );
          })}
          {nContainers === 0 && (
            <div className="muted" style={{ padding: 8 }}>
              Add quantities (or fix the flagged items above) to see containers.
            </div>
          )}
        </div>

        {nContainers > 0 && selContainer && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.1fr) minmax(320px, 1fr)", borderTop: "1px solid var(--border)" }}>
            {/* Inside the selected container */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, borderRight: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Inside C{sel + 1}
                </span>
                <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{round1(tonnesIn(selContainer)).toFixed(1)} / {fmt(selContainer.capTons)} t</span>
              </div>
              {selContainer.segs.map((s, i) => {
                const l = lineOf(s.idx);
                if (!l) return null;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "var(--t-md)" }}>{l.item}</span>
                    <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                      {Math.ceil(s.boxes / l.boxesPerPallet)} pallet{Math.ceil(s.boxes / l.boxesPerPallet) === 1 ? "" : "s"}
                    </span>
                    <span className="mono" style={{ fontSize: "var(--t-sm)", fontWeight: 600, width: 96, textAlign: "right" }}>
                      {fmt(s.boxes)} boxes
                    </span>
                  </div>
                );
              })}
              {selContainer.fill < 1 - EPS && (() => {
                const freeBoxes = Math.floor((1 - selContainer.fill) * selContainer.capBoxes + EPS);
                const freeTonnes = selContainer.capTons - tonnesIn(selContainer);
                return (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, border: "1px dashed var(--dim)", flexShrink: 0 }} />
                    <span className="dim" style={{ flex: 1, fontSize: "var(--t-md)" }}>Free space</span>
                    <span className="mono dim" style={{ fontSize: "var(--t-sm)" }}>
                      {round1(Math.max(0, freeTonnes)).toFixed(1)} t · {fmt(freeBoxes)} boxes free
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Adjust the load */}
            <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span className="dim" style={{ fontSize: "var(--t-xs)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Adjust C{sel + 1}
                </span>
              </div>
              {trim && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid color-mix(in oklab, var(--c-red) 35%, transparent)", background: "color-mix(in oklab, var(--c-red) 5%, transparent)", borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--c-red)" }}>−</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{trim.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{trim.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={trim.apply}>Apply</button>
                  )}
                </div>
              )}
              {add && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid color-mix(in oklab, var(--c-blue) 35%, transparent)", background: "color-mix(in oklab, var(--c-blue) 5%, transparent)", borderRadius: 6 }}>
                  <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--c-blue)" }}>+</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
                    <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{add.headline}</span>
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{add.detail}</span>
                  </div>
                  {canSave && (
                    <button className="hbtn" style={{ whiteSpace: "nowrap" }} onClick={add.apply}>Apply</button>
                  )}
                </div>
              )}
              {balanced && (
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
