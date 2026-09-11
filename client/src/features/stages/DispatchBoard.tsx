/* ============================================================
   Dispatch Control Board — the /packing board view (replaces PalKanban).
   Full-width stage board: 3 columns of PalletizationPlanLines — Ready for
   Palletization → In Palletization → Ready for Loading. Two-step flow
   (2026-09-04, reverses the 2026-08-27 one-hop): Palletise moves a line to
   In Palletization (pallet confirmed in PalletiseModal); "Mark Palletised"
   then moves it to Ready for Loading. Ready-for-Loading cards carry the
   Load button (useLoadFlow + LoadContainerModal) — loading starts HERE;
   /loading holds only boxed lines onward. Kanban/Sheet is chosen by the
   page-header toggle in PalPlans and arrives as the `view` prop.
   Ready-for-Palletization and Ready-for-Loading cards carry a record-level
   checkbox — the selection palletises / loads together.
   Lines allocated to a load box (and legacy Completed plans) leave this
   board entirely — they live on the Loading and Dispatch page (/loading).
   ============================================================ */
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { fmt } from "@/lib/format";
import { type ContainerPlan } from "@/data";
import { isoInfo } from "@/features/masters/customersApi";
import {
  invalidatePalPlans,
  lineFrac,
  oiProgressOf,
  PAL_LINE_STATUS_LABEL,
  setPalLineStatus,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
  type PalLineStatus,
} from "./palPlansApi";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import { PalletiseModal, type PalletiseEntry } from "./PalletiseModal";
import { LoadContainerModal } from "./LoadContainerModal";
import { useLoadFlow } from "./useLoadFlow";

// Board columns — all hold ITEM cards (a PalPlanLine each).
const COLUMNS = [
  { key: "Planning", label: "Ready for Palletization", chip: "p-planning" },
  { key: "Palletizing", label: "In Palletization", chip: "p-palletized" },
  { key: "Ready", label: "Ready for Loading", chip: "p-ready" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

type Entry = { p: PalPlan; l: PalPlanLine };
type Drag = { lineIds: string[]; from: "Planning" | "Palletizing" | "Ready" } | null;

// Swimlane dimensions for the group-by picker (rendered in PalPlans' toolbar,
// same mechanism as Production). Ordered multi-select → nested lanes.
export type DispatchGroupBy = "customer" | "so" | "batch" | "item";
export const DISPATCH_GROUP_DIMS: Array<{ id: DispatchGroupBy; label: string }> = [
  { id: "customer", label: "Customer" },
  { id: "so", label: "Order" },
  { id: "batch", label: "Batch" },
  { id: "item", label: "Item" },
];

export function DispatchBoard({
  plans,
  boxes,
  view,
  canEdit,
  groupBy,
  onChanged,
}: {
  plans: PalPlan[];
  boxes: LoadBox[];
  view: "kanban" | "sheet";
  canEdit: boolean;
  groupBy: DispatchGroupBy[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  // Board filters (session-scoped is overkill — the outer PalPlans search persists already).
  const [q, setQ] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fCountry, setFCountry] = useState("");
  const [fDesign, setFDesign] = useState("");
  const [fSize, setFSize] = useState("");
  // Interaction state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Lines being palletised through the dialog (checkbox selection, column drop,
  // or a drag to the transient Palletization column — `to` is where they land).
  const [palletise, setPalletise] = useState<{ lines: PalPlanLine[]; to: "Palletizing" | "ReadyToLoad" } | null>(null);

  // Container plans keyed by SalesOrder ROWID — feeds the card subtitle and
  // the palletise-time pallet prefill.
  const { planBySo, defaultPalletFor } = useContainerPlanBySo();
  // Shared load flow — Ready-for-Loading cards load into containers from here.
  const flow = useLoadFlow({ plans, boxes, onChanged });
  const planTitle = (docNo: string, plan: ContainerPlan) =>
    plan.containers
      .map((c) => `${docNo} · C${c.no} — ${c.pallets} pallets · ${fmt(c.boxes)} boxes (${c.fillPct}%)\n${c.lines.map((x) => `   ${x.design}: ${x.pallets}P · ${fmt(x.boxes)}B on ${x.palletName}`).join("\n")}`)
      .join("\n");

  // ---- derived ------------------------------------------------
  // Boxed lines + legacy Completed plans live on /loading, not this board.
  const allLines: Entry[] = plans
    .filter((p) => p.status !== "Completed")
    .flatMap((p) => p.lines.filter((l) => !l.loadBoxId).map((l) => ({ p, l })));
  // Partial-palletise progress across ALL lines (boxed + Completed included,
  // or split siblings would deflate the totals).
  const oiProgress = oiProgressOf(plans.flatMap((p) => p.lines));
  // Age = days since the LINE was created (auto-enqueue creates it right after
  // production; plans are reused per SO so the plan date is the wrong anchor).
  // Catalyst stamps "YYYY-MM-DD HH:mm:ss:SSS" — colon before the millis breaks
  // Date.parse, so cut to seconds first.
  const ageDays = (p: PalPlan, l: PalPlanLine) => {
    const t = Date.parse((l.createdTime || p.createdTime || "").slice(0, 19).replace(" ", "T"));
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
  };
  const stageOf = (_p: PalPlan, l: PalPlanLine): ColKey => {
    if (l.status === "ReadyToLoad") return "Ready";
    return l.status === "Palletizing" ? "Palletizing" : "Planning";
  };

  // Prune stale selection after a refresh moves lines on.
  useEffect(() => {
    setSelected((prev) => {
      const selectable = new Set(
        allLines.filter(({ p, l }) => { const s = stageOf(p, l); return s === "Planning" || s === "Ready"; }).map(({ l }) => l.id),
      );
      const next = new Set([...prev].filter((id) => selectable.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans]);

  // ---- mutations (all sequential + one refresh, house pattern) ----
  const after = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    onChanged();
  };

  const moveLines = async (ids: string[], to: PalLineStatus) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    let ok = 0, err = "";
    for (const id of ids) {
      const res = await setPalLineStatus(id, to);
      if (res.ok) ok++; else err = res.error || "Move failed";
    }
    // Palletised without the dialog (already-palleted lines dropped on Ready):
    // print the packing report for what moved.
    if (to === "ReadyToLoad" && ok > 0) {
      const pool = plans.flatMap((p) => p.lines);
      const moved = pool.filter((l) => ids.includes(l.id)).map((l) => ({ ...l, status: "ReadyToLoad" as const }));
      void import("./packingReportPdf").then((m) => m.downloadPackingReportForLines(moved, pool));
    }
    setBusy(false);
    // Batch failure mid-way: report + refresh anyway so the board resyncs.
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} → ${PAL_LINE_STATUS_LABEL[to]}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  // Palletise-dialog confirm: every target moves to `to` with its pallet in
  // one call (`to` = Palletizing from the Palletise button, ReadyToLoad from
  // a pallet-less Mark Palletised / drop on Ready — a line never reaches
  // Ready for Loading without a pallet on record).
  const confirmPalletise = async (entries: PalletiseEntry[]) => {
    if (busy || entries.length === 0 || !palletise) return;
    const to = palletise.to;
    const src = palletise.lines;
    setBusy(true);
    let ok = 0, err = "";
    for (const e of entries) {
      const res = await setPalLineStatus(e.lineId, to, e.palletId, e.boxes);
      if (res.ok) ok++; else err = res.error || "Move failed";
    }
    // Packing report only when items become PALLETISED (reach Ready), not when
    // palletization merely starts — pre-refresh `plans` still holds the
    // pre-split boxes the remaining-box math needs.
    if (to === "ReadyToLoad" && ok > 0) {
      void import("./packingReportPdf").then((m) =>
        m.downloadPackingReportForEntries(entries, src, plans.flatMap((p) => p.lines)));
    }
    setBusy(false);
    setPalletise(null);
    setSelected(new Set());
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} → ${PAL_LINE_STATUS_LABEL[to]}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  // ---- drag & drop --------------------------------------------
  const clearDnd = () => { setDrag(null); setOverCol(null); };

  const onDropColumn = (colKey: ColKey) => {
    const d = drag;
    clearDnd();
    if (!d) return;
    const lines = d.lineIds
      .map((id) => allLines.find(({ l }) => l.id === id)?.l)
      .filter((l): l is PalPlanLine => !!l && !l.loadBoxId);
    if (colKey === "Palletizing") {
      // Single or multi, palleted or not — one dialog, one code path.
      const targets = lines.filter((l) => l.status !== "Palletizing");
      if (targets.length) setPalletise({ lines: targets, to: "Palletizing" });
      return;
    }
    if (colKey === "Ready") {
      // A line never reaches Ready for Loading without a pallet on record —
      // pallet-less ones detour through the palletise dialog.
      const targets = lines.filter((l) => l.status !== "ReadyToLoad");
      const need = targets.filter((l) => !l.palletId);
      const direct = targets.filter((l) => l.palletId).map((l) => l.id);
      if (direct.length) void moveLines(direct, "ReadyToLoad");
      if (need.length) setPalletise({ lines: need, to: "ReadyToLoad" });
      return;
    }
    void moveLines(lines.filter((l) => l.status !== "Planning").map((l) => l.id), "Planning");
  };

  // ---- board filtering ----------------------------------------
  const opts = {
    customers: [...new Set(allLines.map(({ l }) => l.customerName).filter(Boolean))].sort(),
    countries: [...new Set(allLines.map(({ l }) => l.countryCode).filter(Boolean))].sort(),
    designs: [...new Set(allLines.map(({ l }) => l.designLabel).filter(Boolean))].sort(),
    sizes: [...new Set(allLines.map(({ l }) => l.sizeCode).filter(Boolean))].sort(),
  };
  const qLower = q.trim().toLowerCase();
  const matches = ({ p, l }: Entry) => {
    if (fCustomer && l.customerName !== fCustomer) return false;
    if (fCountry && l.countryCode !== fCountry) return false;
    if (fDesign && l.designLabel !== fDesign) return false;
    if (fSize && l.sizeCode !== fSize) return false;
    if (qLower && !`${l.itemCode} ${l.soNumber} ${l.customerName} ${l.designLabel} ${l.sizeCode} ${p.palNumber} ${l.batchNumber}`.toLowerCase().includes(qLower)) return false;
    return true;
  };
  const anyFilter = !!(q || fCustomer || fCountry || fDesign || fSize);
  const visible = allLines.filter(matches);
  // Group-by lane key per dimension.
  const laneKeyOf = (e: Entry, d: DispatchGroupBy): string =>
    d === "customer" ? e.l.customerName || "—"
    : d === "so" ? e.l.soNumber || "No SO"
    : d === "batch" ? (e.l.batchNumber ? `Batch ${e.l.batchNumber}` : "No batch")
    : e.l.designLabel || "—";
  const groupKeyOf = (e: Entry) => groupBy.map((d) => laneKeyOf(e, d)).join("  ›  ");
  // Sheet rows: stage sections first, group bands nested inside, then pallet code.
  const stageIdx = new Map(COLUMNS.map((c, i) => [c.key, i]));
  const sheetRows = [...visible].sort((a, b) => {
    const d = (stageIdx.get(stageOf(a.p, a.l)) ?? 0) - (stageIdx.get(stageOf(b.p, b.l)) ?? 0);
    if (d !== 0) return d;
    if (groupBy.length) {
      const g = groupKeyOf(a).localeCompare(groupKeyOf(b));
      if (g !== 0) return g;
    }
    return a.l.itemCode.localeCompare(b.l.itemCode, undefined, { numeric: true });
  });

  // ---- selection ----------------------------------------------
  // Selection spans two stages: Planning items palletise together, Ready
  // items load together — each button acts on its own stage's subset.
  const selEntries = allLines.filter(({ l }) => selected.has(l.id));
  const selBoxes = selEntries.reduce((s, { l }) => s + l.boxes, 0);
  const selPlanning = selEntries.filter(({ p, l }) => stageOf(p, l) === "Planning");
  const selReady = selEntries.filter(({ p, l }) => stageOf(p, l) === "Ready");
  const toggleSelect = (l: PalPlanLine) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
      return next;
    });
  const openPalletise = (lines: PalPlanLine[], to: "Palletizing" | "ReadyToLoad" = "Palletizing") => {
    if (lines.length) setPalletise({ lines, to });
  };
  // A card's Palletise/Load button acts on the checked same-stage items plus
  // the clicked one — a selection is never silently ignored.
  const palletiseTargets = (l: PalPlanLine) =>
    selected.size ? [...selPlanning.map(({ l: sl }) => sl).filter((sl) => sl.id !== l.id), l] : [l];
  const loadTargets = (l: PalPlanLine) =>
    selected.size ? [...new Set([...selReady.map(({ l: sl }) => sl.id), l.id])] : [l.id];

  // ---- item card ----------------------------------------------
  const itemCard = (p: PalPlan, l: PalPlanLine, stage: ColKey) => {
    const isSel = selected.has(l.id);
    const canDrag = canEdit;
    const age = ageDays(p, l);
    return (
      <div
        key={l.id}
        draggable={canDrag}
        onDragStart={() => {
          if (!canDrag) return;
          setDrag({ lineIds: isSel ? [...selected] : [l.id], from: stage as "Planning" | "Palletizing" | "Ready" });
        }}
        onDragEnd={clearDnd}
        onClick={() => navigate(`/packing/${p.id}`)}
        title={`Open ${p.palNumber}`}
        style={{
          position: "relative",
          border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8, padding: 10,
          background: isSel ? "var(--accent-soft)" : "var(--bg)",
          cursor: canDrag ? "grab" : "pointer",
          opacity: drag?.lineIds.includes(l.id) ? 0.5 : 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {canEdit && (stage === "Planning" || stage === "Ready") && (
            <input
              type="checkbox"
              checked={isSel}
              onClick={(ev) => ev.stopPropagation()}
              onChange={() => toggleSelect(l)}
              title={stage === "Planning" ? "Select to palletise together" : "Select to load together"}
              style={{ margin: 0, flex: "0 0 auto" }}
            />
          )}
          <button
            type="button"
            className="linkish mono"
            style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer" }}
            onClick={(ev) => { ev.stopPropagation(); navigate(`/packing/${p.id}`); }}
            title={`Open ${p.palNumber}`}
          >
            {l.itemCode}
          </button>
          <span
            className="chip"
            style={{ marginLeft: "auto", fontSize: 13 }}
            title={l.palletCapacity > 0 ? `${fmt(l.boxes)} of ${fmt(l.palletCapacity)} boxes — a full ${l.palletName} container` : undefined}
          >
            {fmt(l.boxes)} box{l.palletCapacity > 0 ? ` · ${Math.round(lineFrac(l) * 100)}%` : ""}
          </span>
          <span
            className="chip"
            title={`${age} days since this item entered the queue`}
            style={{ fontSize: 13, color: age >= 8 ? "var(--c-red)" : undefined, borderColor: age >= 8 ? "var(--c-red)" : undefined }}
          >
            {age}d
          </span>
        </div>
        <div className="design-name" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {l.designLabel}
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[l.customerName, l.sizeCode].filter(Boolean).join("  ·  ") || "—"}
        </div>
        {(l.batchNumber || l.palletGroup) && (
          <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
            {l.batchNumber && (
              <span className="chip mono" style={{ fontSize: 13 }} title="Production batch — load one batch per customer for uniform texture">
                Batch {l.batchNumber}
              </span>
            )}
            {l.palletGroup && (
              <span
                className="chip"
                style={{ fontSize: 13, color: "var(--c-amber)", borderColor: "var(--c-amber)" }}
                title="This item shares a physical pallet with another batch/item"
              >
                Mix Batch
              </span>
            )}
          </div>
        )}
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[l.soNumber, l.palletName].filter((s) => s && s !== "—").join("  ·  ") || "—"}
        </div>
        {(() => {
          const cp = planBySo.get(l.salesOrderId);
          return cp ? (
            <div
              className="dim mono"
              style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={planTitle(cp.docNo, cp.plan)}
            >
              Plan: {cp.plan.containers.length} container{cp.plan.containers.length === 1 ? "" : "s"} · {cp.docNo}
            </div>
          ) : null;
        })()}
        {canEdit && stage === "Planning" && (
          <button
            type="button"
            className="hbtn primary"
            style={{ width: "100%", marginTop: 8, height: 26, borderRadius: 5, justifyContent: "center", fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); openPalletise(palletiseTargets(l), "Palletizing"); }}
            title={palletiseTargets(l).length > 1 ? `Palletise the ${palletiseTargets(l).length} selected items` : "Palletise this item — moves to In Palletization"}
          >
            Palletise{palletiseTargets(l).length > 1 ? ` (${palletiseTargets(l).length})` : ""}
          </button>
        )}
        {canEdit && stage === "Palletizing" && (
          <button
            type="button"
            className="hbtn primary"
            style={{ width: "100%", marginTop: 8, height: 26, borderRadius: 5, justifyContent: "center", fontSize: "var(--t-sm)" }}
            disabled={busy}
            onClick={(ev) => {
              ev.stopPropagation(); ev.preventDefault();
              // Pallet already picked at Palletise — move direct; legacy
              // pallet-less lines detour through the dialog (same as drop-on-Ready).
              if (l.palletId) void moveLines([l.id], "ReadyToLoad");
              else openPalletise([l], "ReadyToLoad");
            }}
            title="Palletisation done — moves to Ready for Loading"
          >
            Mark Palletised
          </button>
        )}
        {canEdit && stage === "Ready" && (
          <button
            type="button"
            className="btn"
            disabled={flow.busy}
            style={{ width: "100%", marginTop: 8, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); flow.setPicker({ lineIds: loadTargets(l) }); }}
            title={loadTargets(l).length > 1 ? `Load the ${loadTargets(l).length} selected items into a container` : "Load into a container"}
          >
            <Icon name="truck" size={11} /> Load{loadTargets(l).length > 1 ? ` (${loadTargets(l).length})` : ""}
          </button>
        )}
      </div>
    );
  };

  // ---- kanban: stage columns (flat fills the section height; grouped lanes
  // stack naturally and the section scrolls) ---------------------
  const stageGrid = (list: Entry[], keyPrefix: string, fillHeight: boolean) => (
    <div
      style={
        fillHeight
          ? { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(210px, 1fr))`, gap: 10, padding: 10, overflowX: "auto" }
          : { display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(210px, 1fr))`, gap: 10, alignItems: "start", overflowX: "auto" }
      }
    >
      {COLUMNS.map((col) => {
        const entries = list.filter((e) => stageOf(e.p, e.l) === col.key);
        const totalBoxes = entries.reduce((s, { l }) => s + l.boxes, 0);
        const accepts = canEdit && !!drag;
        const overId = `${keyPrefix}|${col.key}`;
        const isOver = overCol === overId;
        return (
          <div
            key={col.key}
            onDragOver={(e) => { if (!accepts) return; e.preventDefault(); setOverCol(overId); }}
            onDragLeave={() => setOverCol((s) => (s === overId ? null : s))}
            onDrop={(e) => { e.preventDefault(); onDropColumn(col.key); }}
            style={{
              display: "flex", flexDirection: "column", minWidth: 210,
              ...(fillHeight ? { minHeight: 0 } : {}),
              border: "1px solid var(--border)", borderRadius: 8,
              background: isOver ? "var(--accent-soft)" : "var(--panel-2)",
              transition: "background .12s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
              <span className={`chip palstatus ${col.chip}`}>{col.label}</span>
              <span className="muted mono" style={{ fontSize: 14, marginLeft: "auto" }} title={`${fmt(totalBoxes)} boxes`}>
                {entries.length} · {fmt(totalBoxes)} bx
              </span>
            </div>
            <div style={{ ...(fillHeight ? { flex: 1, minHeight: 0, overflowY: "auto" } : { minHeight: 60 }), display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
              {col.key === "Ready"
                ? (() => {
                    // Palletised items group by their SO so a load is easy to find.
                    const bySo = [...entries].sort((a, b) => (a.l.soNumber || "").localeCompare(b.l.soNumber || ""));
                    const countOf = new Map<string, number>();
                    bySo.forEach(({ l }) => countOf.set(l.soNumber || "", (countOf.get(l.soNumber || "") || 0) + 1));
                    let prevSo: string | null = null;
                    return bySo.map(({ p, l }) => {
                      const so = l.soNumber || "";
                      const divider = so !== prevSo;
                      prevSo = so;
                      return (
                        <div key={l.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {divider && (
                            <div className="mono dim" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t-xs)", padding: "2px 2px 0" }}>
                              <span style={{ fontWeight: 600 }}>{so || "No SO"}</span>
                              <span>· {countOf.get(so)}</span>
                              <span style={{ flex: 1, borderTop: "1px solid var(--border)" }} />
                            </div>
                          )}
                          {itemCard(p, l, col.key)}
                        </div>
                      );
                    });
                  })()
                : entries.map(({ p, l }) => itemCard(p, l, col.key))}
              {entries.length === 0 && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
                  Nothing here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Nested swimlanes: partition by dims[0], recurse on the rest; at the leaf
  // render the stage columns. keyPrefix keeps drop highlights unique per lane.
  // ponytail: duplicated from ProductionKanban.renderLevel — a generic
  // extraction (card type + dims + laneKey params) would outweigh these lines.
  const renderLevel = (list: Entry[], dims: DispatchGroupBy[], depth: number, keyPrefix: string): JSX.Element => {
    if (dims.length === 0) return stageGrid(list, keyPrefix, false);
    const by = new Map<string, Entry[]>();
    for (const e of list) {
      const k = laneKeyOf(e, dims[0]);
      (by.get(k) ?? by.set(k, []).get(k)!).push(e);
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: depth === 0 ? 0 : 16 }}>
        {[...by.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([k, sub]) => (
            <div key={k} className={depth === 0 ? "form-section" : undefined} style={depth === 0 ? undefined : { marginLeft: depth * 16 }}>
              {depth === 0 ? (
                <div className="form-section-title">
                  <span style={{ flex: 1 }}>{k}</span>
                  <span className="muted" style={{ fontSize: 14, fontWeight: 400, letterSpacing: 0 }}>{sub.length}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: "var(--muted)" }}>{k}</span>
                  <span className="muted" style={{ fontSize: 14 }}>{sub.length}</span>
                </div>
              )}
              {renderLevel(sub, dims.slice(1), depth + 1, `${keyPrefix}/${dims[0]}=${k}`)}
            </div>
          ))}
      </div>
    );
  };

  // ---- render -------------------------------------------------
  const selectStyle: React.CSSProperties = { flex: "0 1 auto", minWidth: 0, maxWidth: 150 };

  return (
    <div>
      <div className="dispatch-fill" style={{ display: "flex", alignItems: "stretch", height: "calc(100vh - 172px)", minHeight: 480 }}>
        <section className="card" style={{ flex: 1, minWidth: 380, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          <div className="fbar" style={{ margin: 0, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexWrap: "nowrap" }}>
            <span className="gsearch" style={{ minWidth: 0 }}>
              <Icon name="search" size={13} />
              <input type="text" placeholder="Search item, SO, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
            </span>
            <select value={fCustomer} onChange={(e) => setFCustomer(e.target.value)} title="Customer" style={selectStyle}>
              <option value="">All customers</option>
              {opts.customers.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={fCountry} onChange={(e) => setFCountry(e.target.value)} title="Country" style={selectStyle}>
              <option value="">All countries</option>
              {opts.countries.map((o) => <option key={o} value={o}>{isoInfo(o).country}</option>)}
            </select>
            <select value={fDesign} onChange={(e) => setFDesign(e.target.value)} title="Item" style={selectStyle}>
              <option value="">All items</option>
              {opts.designs.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={fSize} onChange={(e) => setFSize(e.target.value)} title="Size" style={selectStyle}>
              <option value="">All sizes</option>
              {opts.sizes.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {anyFilter && (
              <button
                type="button"
                className="btn"
                style={{ marginLeft: "auto", flex: "0 0 auto" }}
                onClick={() => { setQ(""); setFCustomer(""); setFCountry(""); setFDesign(""); setFSize(""); }}
              >
                Clear filters
              </button>
            )}
          </div>

          {view === "kanban" ? (
            groupBy.length === 0 ? (
              stageGrid(visible, "", true)
            ) : (
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
                {renderLevel(visible, groupBy, 0, "")}
              </div>
            )
          ) : (
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <table className="tbl" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Pallet</th>
                    <th>Item</th>
                    <th>Customer · SO</th>
                    <th>Batch</th>
                    <th>Stage</th>
                    <th>Age</th>
                    <th aria-label="Action" />
                  </tr>
                </thead>
                <tbody>
                  {/* ponytail: band rows duplicated across the boards (see ProductionTable) —
                      grouping keys differ per board, a shared helper would outweigh them. */}
                  {sheetRows.map(({ p, l }, i) => {
                    const stage = stageOf(p, l);
                    const col = COLUMNS.find((c) => c.key === stage)!;
                    const isSel = selected.has(l.id);
                    const key = groupBy.length ? groupKeyOf({ p, l }) : "";
                    const stageChanged = i === 0 || stageOf(sheetRows[i - 1].p, sheetRows[i - 1].l) !== stage;
                    const stageBand = stageChanged ? (
                      <tr key={`s-${stage}`} style={{ background: "var(--panel-2)", borderTop: "2px solid var(--border)" }}>
                        <td colSpan={7} style={{ padding: "8px 10px" }}>
                          <span className={`chip palstatus ${col.chip}`} style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{col.label}</span>
                          <span className="mono dim" style={{ marginLeft: 10 }}>
                            {(() => {
                              const sub = sheetRows.filter((e) => stageOf(e.p, e.l) === stage);
                              return `${sub.length} item${sub.length === 1 ? "" : "s"} · ${fmt(sub.reduce((s, e) => s + e.l.boxes, 0))} bx`;
                            })()}
                          </span>
                        </td>
                      </tr>
                    ) : null;
                    const band =
                      groupBy.length && (stageChanged || groupKeyOf(sheetRows[i - 1]) !== key) ? (
                        <tr key={`h-${stage}-${key}`} style={{ background: "var(--accent-soft)", fontWeight: 700, color: "var(--accent-ink)" }}>
                          <td colSpan={7} style={{ paddingLeft: 20 }}>
                            {key}
                            <span className="mono" style={{ fontWeight: 400, marginLeft: 10 }}>
                              {(() => {
                                const sub = sheetRows.filter((e) => groupKeyOf(e) === key && stageOf(e.p, e.l) === stage);
                                return `${sub.length} item${sub.length === 1 ? "" : "s"} · ${fmt(sub.reduce((s, e) => s + e.l.boxes, 0))} bx`;
                              })()}
                            </span>
                          </td>
                        </tr>
                      ) : null;
                    return (
                      <Fragment key={l.id}>
                      {stageBand}
                      {band}
                      <tr
                        key={l.id}
                        onClick={() => navigate(`/packing/${p.id}`)}
                        title={`Open ${p.palNumber}`}
                        style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : undefined }}
                      >
                        <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {canEdit && (stage === "Planning" || stage === "Ready") && (
                              <input
                                type="checkbox"
                                checked={isSel}
                                onClick={(ev) => ev.stopPropagation()}
                                onChange={() => toggleSelect(l)}
                                title={stage === "Planning" ? "Select to palletise together" : "Select to load together"}
                                style={{ margin: 0 }}
                              />
                            )}
                            {l.itemCode}
                          </span>
                        </td>
                        <td className="nw">
                          <span className="clip" style={{ maxWidth: 260 }} title={l.designLabel}>{l.designLabel}</span>
                        </td>
                        <td className="nw">
                          <span className="clip" style={{ maxWidth: 180 }} title={l.customerName}>{l.customerName || "—"}</span>
                          <div className="dim mono" style={{ fontSize: "var(--t-xs)" }}>{l.soNumber || "—"}</div>
                        </td>
                        <td className="mono" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap" }}>
                          {l.batchNumber || "—"}
                          {l.palletGroup && (
                            <span className="chip" style={{ fontSize: 13, marginLeft: 6, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="Shares a physical pallet with another batch/item">
                              Mix Batch
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`chip palstatus ${col.chip}`} style={{ whiteSpace: "nowrap" }}>{col.label}</span>
                          {(() => {
                            const prog = oiProgress.get(l.orderItemId);
                            return prog && prog.done > 0 && prog.done < prog.total ? (
                              <div className="chip palstatus p-palletized" style={{ marginTop: 2, whiteSpace: "nowrap" }}
                                   title="Part of this order item is still not palletised">
                                Partially palletised
                              </div>
                            ) : null;
                          })()}
                        </td>
                        <td className="dim">{ageDays(p, l)}d</td>
                        <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                          {canEdit && stage === "Planning" && (
                            <button
                              type="button"
                              className="btn"
                              style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }}
                              disabled={busy}
                              onClick={() => openPalletise(palletiseTargets(l), "Palletizing")}
                            >
                              Palletise{palletiseTargets(l).length > 1 ? ` (${palletiseTargets(l).length})` : ""}
                            </button>
                          )}
                          {canEdit && stage === "Palletizing" && (
                            <button
                              type="button"
                              className="btn"
                              style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }}
                              disabled={busy}
                              onClick={() => { if (l.palletId) void moveLines([l.id], "ReadyToLoad"); else openPalletise([l], "ReadyToLoad"); }}
                            >
                              Mark Palletised
                            </button>
                          )}
                          {canEdit && stage === "Ready" && (
                            <button
                              type="button"
                              className="btn"
                              style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }}
                              disabled={flow.busy}
                              onClick={() => flow.setPicker({ lineIds: loadTargets(l) })}
                            >
                              Load{loadTargets(l).length > 1 ? ` (${loadTargets(l).length})` : ""}
                            </button>
                          )}
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                  {sheetRows.length === 0 && (
                    <tr><td colSpan={7} className="dim" style={{ textAlign: "center", padding: 24 }}>Nothing here</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Selection bar. */}
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border)", background: selected.size ? "var(--accent-soft)" : "var(--panel-2)" }}>
              <span style={{ fontSize: "var(--t-md)", fontWeight: selected.size ? 600 : 400, color: selected.size ? "var(--fg)" : "var(--muted)" }}>
                {selected.size
                  ? `${selected.size} selected · ${fmt(selBoxes)} boxes`
                  : "Tick items to palletise or load several together"}
              </span>
              <span style={{ flex: 1 }} />
              {selected.size > 0 && (
                <>
                  {selPlanning.length > 0 && (
                    <button
                      type="button"
                      className="hbtn primary"
                      style={{ height: 26, padding: "0 12px", borderRadius: 5, flex: "0 0 auto" }}
                      disabled={busy}
                      onClick={() => openPalletise(selPlanning.map(({ l }) => l), "Palletizing")}
                    >
                      <Icon name="package" size={12} /> Palletise ({selPlanning.length})
                    </button>
                  )}
                  {selReady.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="hbtn"
                        style={{ height: 26, padding: "0 12px", borderRadius: 5, flex: "0 0 auto" }}
                        title="Print the pallet packing report for the selected palletised items"
                        onClick={() => void import("./packingReportPdf").then((m) =>
                          m.downloadPackingReportForLines(selReady.map(({ l }) => l), plans.flatMap((p) => p.lines)))}
                      >
                        <Icon name="printer" size={12} /> Packing Report ({selReady.length})
                      </button>
                      <button
                        type="button"
                        className="hbtn primary"
                        style={{ height: 26, padding: "0 12px", borderRadius: 5, flex: "0 0 auto" }}
                        disabled={flow.busy}
                        onClick={() => flow.setPicker({ lineIds: selReady.map(({ l }) => l.id) })}
                      >
                        <Icon name="truck" size={12} /> Load ({selReady.length})
                      </button>
                    </>
                  )}
                  <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setSelected(new Set())}>
                    Clear
                  </button>
                </>
              )}
            </div>
          )}

          {/* Stage summary — kanban only; the sheet already shows a Stage column. */}
          {view === "kanban" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
            {COLUMNS.map((col, i) => {
              const n = allLines.filter((e) => stageOf(e.p, e.l) === col.key).length;
              return (
                <span key={col.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className={`chip palstatus ${col.chip}`} title={`${n} item${n === 1 ? "" : "s"}`}>
                    {col.label} <span className="mono">{n}</span>
                  </span>
                  {i < COLUMNS.length - 1 && <span className="dim" aria-hidden="true">→</span>}
                </span>
              );
            })}
          </div>
          )}
        </section>
      </div>

      {palletise && (
        <PalletiseModal
          lines={palletise.lines}
          busy={busy}
          defaultPalletFor={(l) => defaultPalletFor(l.salesOrderId, l.designId)}
          toLabel={PAL_LINE_STATUS_LABEL[palletise.to]}
          onConfirm={(entries) => void confirmPalletise(entries)}
          onClose={() => setPalletise(null)}
        />
      )}

      {flow.picker && (() => {
        // Use the hook's UNfiltered lines for box previews — this board's own
        // list excludes boxed lines, the modal's fill preview must not.
        const lines = flow.picker.lineIds
          .map((id) => flow.allLines.find(({ l }) => l.id === id)?.l)
          .filter((l): l is PalPlanLine => !!l);
        if (!lines.length) return null;
        return (
          <LoadContainerModal
            lines={lines}
            availableLines={flow.allLines.filter(({ l }) => l.status === "ReadyToLoad" && !l.loadBoxId).map(({ l }) => l)}
            boxes={flow.openBoxes}
            linesOfBox={flow.linesOfBox}
            busy={flow.busy}
            planHint={lines.length === 1 ? flow.planHintFor(lines[0].salesOrderId, lines[0].designId) : undefined}
            onConfirm={(target, entries, prodEntries) => void flow.confirmLoad(target, entries, prodEntries, () => setSelected(new Set()))}
            onClose={() => flow.setPicker(null)}
          />
        );
      })()}
    </div>
  );
}
