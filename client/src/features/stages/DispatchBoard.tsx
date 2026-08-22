/* ============================================================
   Dispatch Control Board — the /packing board view (replaces PalKanban).
   Layout from the claude.ai/design "Dispatch Board" (2026-08-17), house theme.
   LEFT is the order board with a stage-pill summary header and a Kanban/Sheet
   toggle: Kanban = 5 columns of PalletizationPlanLines (Ready for
   Palletization → Palletization → Ready for Loading → In Dispatch →
   Dispatched); Sheet = the
   same lines as a flat stage-sorted table. RIGHT is "Containers at dock" —
   one card per LoadBox (vehicle slot) with a design-coloured fill bar,
   "Load selected here" and "Dispatch & print" (vehicle asked at dispatch;
   a printable Dispatch Entry overlay opens after).
   Hand-rolled HTML5 drag-and-drop like Production; loading still routes
   through BoxPickerModal for single lines so partial (split) loads keep
   working. Swap + KPI extras removed 2026-08-17 — git history holds them.
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { fmt } from "@/lib/format";
import { usePersistedState } from "@/lib/usePersistedState";
import { parseContainerPlan, type ContainerPlan, type Order, type Quote } from "@/data";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { isoInfo } from "@/features/masters/customersApi";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { BoxPickerModal } from "./BoxPickerModal";
import { BoxDetailsModal } from "./BoxDetailsModal";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import {
  boxFill,
  createLoadBox,
  dispatchLoadBox,
  invalidatePalPlans,
  lineFrac,
  mixedBatchOrderItems,
  PAL_LINE_STATUS_LABEL,
  setLineBox,
  setPalLineStatus,
  sharedCapacity,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
  type PalLineStatus,
} from "./palPlansApi";
import { PalletPickerModal } from "./PalletPickerModal";

// Board columns — all hold ITEM cards (a PalPlanLine each); the last two
// are derived from the line's box (Open = In Dispatch, Dispatched = done).
const COLUMNS = [
  { key: "Planning", label: "Ready for Palletization", chip: "p-planning" },
  { key: "Palletizing", label: "Palletization", chip: "p-palletized" },
  { key: "Ready", label: "Ready for Loading", chip: "p-ready" },
  { key: "Loading", label: "In Dispatch", chip: "p-loading" },
  { key: "Done", label: "Dispatched", chip: "p-completed" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

type Entry = { p: PalPlan; l: PalPlanLine };
type Drag = { lineIds: string[]; from: "Planning" | "Palletizing" | "Ready" } | null;

export function DispatchBoard({
  plans,
  boxes,
  canEdit,
  onChanged,
}: {
  plans: PalPlan[];
  boxes: LoadBox[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  // Board filters (session-scoped is overkill — the outer PalPlans search persists already).
  const [q, setQ] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fCountry, setFCountry] = useState("");
  const [fDesign, setFDesign] = useState("");
  const [fSize, setFSize] = useState("");
  // Kanban/Sheet — survives the route round-trip to a plan detail.
  const [boardView, setBoardView] = usePersistedState<"kanban" | "sheet">("dispatch.boardView", "kanban");
  // Bay filters.
  const [bayCountry, setBayCountry] = useState("");
  const [bayStatus, setBayStatus] = useState<"open" | "all" | "dispatched" | "short">("open");
  // Interaction state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [overBox, setOverBox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState<{ box: LoadBox; dispatch?: boolean } | null>(null);
  const [detailBoxId, setDetailBoxId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ lineId: string; presetBoxId?: string } | null>(null);
  // Pallet choice for a pallet-less line dropped on the Palletization column.
  const [palletPick, setPalletPick] = useState<PalPlanLine | null>(null);
  // Post-dispatch printable Dispatch Entry — entries snapshotted pre-refresh.
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);

  // Container plans keyed by SalesOrder ROWID — the loading team packs
  // load-boxes to plan. The SO's OWN plan (editable copy, snapshotted at
  // conversion) wins; the source quote's snapshot is the fallback for SOs
  // converted before SOs owned plans.
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  useEffect(() => {
    let alive = true;
    void listQuotes().then((r) => {
      if (alive && r.ok) setQuotes(r.quotes);
    });
    void listOrders().then((r) => {
      if (alive && r.ok) setOrders(r.orders);
    });
    return () => {
      alive = false;
    };
  }, []);
  const planBySo = new Map<string, { docNo: string; plan: ContainerPlan }>();
  quotes.forEach((qt) => {
    const plan = parseContainerPlan(qt.containerPlan);
    if (plan) qt.sos?.forEach((so) => planBySo.set(so.id, { docNo: qt.quoteNo, plan }));
  });
  orders.forEach((o) => {
    if (!o.salesOrderId) return;
    const plan = parseContainerPlan(o.containerPlan);
    if (plan) planBySo.set(o.salesOrderId, { docNo: o.orderNumber || o.poNumber, plan });
  });
  const planTitle = (docNo: string, plan: ContainerPlan) =>
    plan.containers
      .map((c) => `${docNo} · C${c.no} — ${c.pallets} pallets · ${fmt(c.boxes)} boxes (${c.fillPct}%)\n${c.lines.map((x) => `   ${x.design}: ${x.pallets}P · ${fmt(x.boxes)}B on ${x.palletName}`).join("\n")}`)
      .join("\n");

  // ---- derived ------------------------------------------------
  const allLines: Entry[] = plans.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const linesOfBox = (boxId: string) => allLines.filter(({ l }) => l.loadBoxId === boxId);
  const loadedOf = (b: LoadBox) => linesOfBox(b.id).reduce((s, { l }) => s + l.boxes, 0);
  // Fill is fractional vs each line's PALLET capacity (bug #2) — a box holding
  // 50 boxes of a 100-box pallet reads 50%, whatever the LoadBox.capacity says.
  const fillOf = (b: LoadBox) => boxFill(linesOfBox(b.id).map(({ l }) => l));
  // Hard 100% cap: how many of THIS line's boxes still fit (its pallet's boxes).
  // Capacity-unknown lines can't be capped — they load whole.
  const fitOf = (l: PalPlanLine, b: LoadBox) =>
    l.palletCapacity > 0 ? Math.floor(Math.max(0, 1 - fillOf(b)) * l.palletCapacity) : l.boxes;
  const isEmptyBox = (b: LoadBox) => linesOfBox(b.id).length === 0;
  const boxLabel = (b: LoadBox) => b.vehicleNumber || `Box ${b.boxNumber}`;
  // Lines carry no date — age comes from the owning plan (Catalyst "YYYY-MM-DD HH:mm:ss").
  const ageDays = (p: PalPlan) => {
    const t = Date.parse((p.createdTime || "").replace(" ", "T"));
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
  };
  const stageOf = (p: PalPlan, l: PalPlanLine): ColKey => {
    if (l.loadBoxId) return boxById.get(l.loadBoxId)?.status === "Dispatched" ? "Done" : "Loading";
    if (p.status === "Completed") return "Done"; // legacy pre-box dispatched plans
    if (l.status === "ReadyToLoad") return "Ready";
    return l.status === "Palletizing" ? "Palletizing" : "Planning";
  };

  const openBoxes = boxes.filter((b) => b.status === "Open");

  // Prune stale selection after a refresh moves lines on.
  useEffect(() => {
    setSelected((prev) => {
      const ready = new Set(allLines.filter(({ p, l }) => stageOf(p, l) === "Ready").map(({ l }) => l.id));
      const next = new Set([...prev].filter((id) => ready.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, boxes]);

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
    setBusy(false);
    // Batch failure mid-way: report + refresh anyway so the board resyncs.
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} → ${PAL_LINE_STATUS_LABEL[to]}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  // Hard 100% cap: each line loads only what fits (server-side split keeps the
  // remainder in Ready); once the box is full the rest stay behind for the next box.
  // ponytail: cap is client-side only — every load path routes through here or
  // confirmLoad; the pal-line-box route stays permissive for legacy data.
  const assignLines = async (ids: string[], box: LoadBox) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    let fill = fillOf(box);
    let ok = 0, leftBehind = 0, err = "";
    for (const id of ids) {
      const l = allLines.find((e) => e.l.id === id)?.l;
      if (!l) continue;
      const fit = l.palletCapacity > 0 ? Math.floor(Math.max(0, 1 - fill) * l.palletCapacity) : l.boxes;
      if (fit <= 0) { leftBehind++; continue; }
      const n = Math.min(l.boxes, fit);
      const res = await setLineBox(id, box.id, n < l.boxes ? n : undefined);
      if (res.ok) { ok++; if (n < l.boxes) leftBehind++; } else err = res.error || "Could not load the item";
      if (res.ok && l.palletCapacity > 0) fill += n / l.palletCapacity;
    }
    setBusy(false);
    setSelected(new Set());
    after(
      !err,
      err,
      leftBehind > 0
        ? `${boxLabel(box)} full at 100% — ${ok} loaded, the rest stay in Ready for Loading`
        : `${ok} item${ok === 1 ? "" : "s"} → ${boxLabel(box)}`,
    );
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  const unload = async (line: PalPlanLine, box: LoadBox) => {
    if (busy) return;
    setBusy(true);
    const res = await setLineBox(line.id, "");
    setBusy(false);
    after(res.ok, res.error || "Could not unload the item", `${line.itemCode} back to Ready for Loading (${boxLabel(box)})`);
  };

  // Confirm from the box picker: boxId null = create a new box now; a count
  // below the line's total splits it server-side.
  const confirmLoad = async (boxId: string | null, count: number) => {
    const target = picker;
    if (!target || busy) return; // in-flight guard: a double-confirm must not double-load
    const line = allLines.find(({ l }) => l.id === target.lineId)?.l;
    if (!line) return;
    setBusy(true);
    let toBox = boxId;
    let label = boxId ? boxLabel(boxes.find((b) => b.id === boxId)!) : "";
    if (!toBox) {
      // "New box": reuse a mistake-created empty box (hidden from the lane)
      // before minting another, so box numbers don't pile up.
      const empty = openBoxes.find(isEmptyBox);
      if (empty) {
        toBox = empty.id;
        label = boxLabel(empty);
      } else {
        const created = await createLoadBox();
        if (!created.ok || !created.data?.ROWID) {
          setBusy(false);
          after(false, created.error || "Could not add a box", "");
          return;
        }
        toBox = String(created.data.ROWID);
        label = `Box ${created.data.box_number ?? ""}`.trim();
      }
    }
    // Hard 100% cap — the picker clamps too; this is the last gate before the write.
    const targetBox = boxes.find((b) => b.id === toBox);
    const fit = targetBox ? fitOf(line, targetBox) : line.boxes;
    if (fit <= 0) {
      setBusy(false);
      setPicker(null);
      after(false, `${label} is already at 100%`, "");
      return;
    }
    const n = Math.min(count, fit, line.boxes);
    const res = await setLineBox(line.id, toBox, n < line.boxes ? n : undefined);
    setBusy(false);
    setPicker(null);
    after(res.ok, res.error || "Could not load the item", `${line.itemCode} → ${label}`);
  };

  const dispatchBox = async (box: LoadBox, capture?: LoadingCapture) => {
    // Snapshot the loaded lines BEFORE the refetch moves them to Dispatched.
    const entries = linesOfBox(box.id);
    setBusy(true);
    const res = await dispatchLoadBox(box.id, capture);
    setBusy(false);
    after(res.ok, res.error || "Could not dispatch", `${boxLabel(box)} dispatched`);
    if (res.ok) setEntryOverlay({ box, entries });
  };

  const assignVehicle = async (vehicleId: string, capture: LoadingCapture) => {
    const t = vehModal;
    setVehModal(null);
    if (!t) return;
    setBusy(true);
    // Only send `vehicle` when chosen (server rejects an empty vehicle); a box
    // already carrying a vehicle just gets its loading-capture fields updated.
    const res = await updateLoadBox(t.box.id, { ...(vehicleId ? { vehicle: vehicleId } : {}), ...capture });
    setBusy(false);
    if (t.dispatch) {
      if (!res.ok) { after(false, res.error || "Could not assign vehicle", ""); return; }
      await dispatchBox(t.box, capture);
      return;
    }
    after(res.ok, res.error || "Could not assign vehicle", "Vehicle assigned");
  };

  const emptyBox = async (box: LoadBox) => {
    if (busy) return;
    const inBox = linesOfBox(box.id);
    if (inBox.length === 0) return;
    const ok = await confirmDialog({
      title: "Empty box",
      message: `Are you sure you want to empty ${boxLabel(box)}? ${inBox.length} item${inBox.length === 1 ? "" : "s"} return to Ready for Loading.`,
    });
    if (!ok) return;
    setBusy(true);
    let err = "";
    for (const { l } of inBox) {
      const res = await setLineBox(l.id, "");
      if (!res.ok) err = res.error || "Could not unload";
    }
    setBusy(false);
    after(!err, err, `${boxLabel(box)} emptied`);
    if (err) { invalidatePalPlans(); onChanged(); }
  };

  // ---- drag & drop --------------------------------------------
  const clearDnd = () => { setDrag(null); setOverCol(null); setOverBox(null); };
  const draggedReady = (d: Exclude<Drag, null>) =>
    d.lineIds
      .map((id) => allLines.find(({ l }) => l.id === id))
      .filter((e): e is Entry => !!e && e.l.status === "ReadyToLoad" && !e.l.loadBoxId);

  const onDropColumn = (colKey: ColKey) => {
    const d = drag;
    clearDnd();
    if (!d) return;
    if (colKey === "Planning" || colKey === "Palletizing" || colKey === "Ready") {
      const to: PalLineStatus = colKey === "Ready" ? "ReadyToLoad" : colKey;
      const lines = d.lineIds
        .map((id) => allLines.find(({ l }) => l.id === id)?.l)
        .filter((l): l is PalPlanLine => !!l && !l.loadBoxId && l.status !== to);
      // Entering Palletization needs a pallet on the line — pick one for a lone
      // pallet-less card; in a multi-drag the palleted ones move, the rest wait.
      if (to === "Palletizing") {
        const missing = lines.filter((l) => !l.palletId);
        if (missing.length === 1 && lines.length === 1) { setPalletPick(missing[0]); return; }
        if (missing.length > 0) toast.error(`${missing.length} item${missing.length === 1 ? " has" : "s have"} no pallet — drag them one at a time to choose`);
        void moveLines(lines.filter((l) => l.palletId).map((l) => l.id), to);
        return;
      }
      void moveLines(lines.map((l) => l.id), to);
      return;
    }
    if (colKey === "Loading") {
      const ready = draggedReady(d);
      if (ready.length === 0) return;
      if (ready.length === 1) { setPicker({ lineId: ready[0].l.id }); return; }
      toast.error("Drop the selection onto a container card in the dock");
    }
  };

  const onDropBox = (box: LoadBox) => {
    const d = drag;
    clearDnd();
    if (!d || box.status !== "Open") return;
    const ready = draggedReady(d);
    if (ready.length === 0) return;
    if (ready.length === 1) setPicker({ lineId: ready[0].l.id, presetBoxId: box.id });
    else void assignLines(ready.map(({ l }) => l.id), box);
  };

  // Drop on the bay background = same as the In Loading column.
  const onDropBay = () => onDropColumn("Loading");

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
  const colEntries = (key: ColKey) => visible.filter((e) => stageOf(e.p, e.l) === key);
  // Sheet rows: stage order, then pallet code.
  const stageIdx = new Map(COLUMNS.map((c, i) => [c.key, i]));
  const sheetRows = [...visible].sort((a, b) => {
    const d = (stageIdx.get(stageOf(a.p, a.l)) ?? 0) - (stageIdx.get(stageOf(b.p, b.l)) ?? 0);
    return d !== 0 ? d : a.l.itemCode.localeCompare(b.l.itemCode, undefined, { numeric: true });
  });

  // ---- bay filtering ------------------------------------------
  const bayBoxes = boxes
    .filter((b) => {
      // Mistake-created empty boxes never show — loading into one reveals it.
      if (b.status === "Open" && isEmptyBox(b)) return false;
      if (bayStatus === "open" && b.status !== "Open") return false;
      if (bayStatus === "dispatched" && b.status !== "Dispatched") return false;
      if (bayStatus === "short" && (b.status !== "Open" || fillOf(b) >= 1)) return false;
      if (bayCountry && !linesOfBox(b.id).some(({ l }) => l.countryCode === bayCountry)) return false;
      return true;
    })
    .sort((a, b) =>
      a.status !== b.status
        ? (a.status === "Open" ? -1 : 1) // Open boxes first
        : a.status === "Open"
          ? a.boxNumber - b.boxNumber
          : (b.dispatchDate || b.createdTime).localeCompare(a.dispatchDate || a.createdTime));

  // ---- selection ----------------------------------------------
  const selEntries = allLines.filter(({ l }) => selected.has(l.id));
  const selBoxes = selEntries.reduce((s, { l }) => s + l.boxes, 0);
  const toggleSelect = (l: PalPlanLine) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
      return next;
    });

  // ---- left panel: item card ----------------------------------
  const itemCard = (p: PalPlan, l: PalPlanLine, stage: ColKey) => {
    const isSel = selected.has(l.id);
    const canDrag = canEdit && (stage === "Planning" || stage === "Palletizing" || stage === "Ready");
    const age = ageDays(p);
    const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
    return (
      <div
        key={l.id}
        draggable={canDrag}
        onDragStart={() => {
          if (!canDrag) return;
          setDrag({ lineIds: isSel ? [...selected] : [l.id], from: stage as "Planning" | "Palletizing" | "Ready" });
        }}
        onDragEnd={clearDnd}
        onClick={() => (canEdit && stage === "Ready" ? toggleSelect(l) : navigate(`/packing/${p.id}`))}
        title={stage === "Ready" && canEdit ? "Click to select · drag to a container" : `Open ${p.palNumber}`}
        style={{
          position: "relative",
          border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8, padding: 10,
          background: isSel ? "var(--accent-soft)" : "var(--bg)",
          cursor: canDrag ? "grab" : "pointer",
          opacity: drag?.lineIds.includes(l.id) ? 0.5 : 1,
        }}
      >
        {isSel && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", top: -7, right: -7, width: 18, height: 18, borderRadius: "50%",
              background: "var(--accent)", color: "var(--accent-fg, #fff)",
              fontSize: 11, lineHeight: "18px", textAlign: "center", fontWeight: 700,
            }}
          >
            ✓
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            style={{ marginLeft: "auto", fontSize: 11 }}
            title={l.palletCapacity > 0 ? `${fmt(l.boxes)} of ${fmt(l.palletCapacity)} boxes — a full ${l.palletName} container` : undefined}
          >
            {fmt(l.boxes)} box{l.palletCapacity > 0 ? ` · ${Math.round(lineFrac(l) * 100)}%` : ""}
          </span>
          <span
            className="chip"
            title={`${age} days since the plan was created`}
            style={{ fontSize: 11, color: age >= 8 ? "var(--c-red)" : undefined, borderColor: age >= 8 ? "var(--c-red)" : undefined }}
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
        {l.batchNumber && (
          <div style={{ marginTop: 4 }}>
            <span className="chip mono" style={{ fontSize: 11 }} title="Production batch — load one batch per customer for uniform texture">
              Batch {l.batchNumber}
            </span>
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
        {box && (
          <div className="dim mono" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>→ {boxLabel(box)}</div>
        )}
        {canEdit && (stage === "Planning" || stage === "Palletizing") && (
          <button
            type="button"
            className="btn"
            style={{ width: "100%", marginTop: 8, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); void moveLines([l.id], "ReadyToLoad"); }}
            title="Move to Ready for Loading"
          >
            Mark ready for loading →
          </button>
        )}
        {canEdit && stage === "Ready" && (
          <button
            type="button"
            className="btn"
            style={{ width: "100%", marginTop: 8, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setPicker({ lineId: l.id }); }}
            title="Load into a container"
          >
            <Icon name="truck" size={13} /> Load
          </button>
        )}
      </div>
    );
  };

  // ---- right panel: container card ----------------------------
  const boxCard = (box: LoadBox) => {
    const inBox = linesOfBox(box.id);
    const loaded = loadedOf(box);
    const fill = boxFill(inBox.map(({ l }) => l));
    const pct = Math.round(fill * 100);
    const cap = sharedCapacity(inBox.map(({ l }) => l)); // one pallet type → absolute box numbers are meaningful
    const rem = cap ? cap - loaded : 0;
    const open = box.status === "Open";
    const pctColor = pct > 100 ? "var(--c-red)" : pct === 100 ? "var(--c-green)" : pct >= 85 ? "var(--c-amber)" : "var(--c-blue)";
    // Stable colour per design (first-seen), same rule as VehicleFillBar.
    const colorByDesign = new Map<string, string>();
    inBox.forEach(({ l }) => {
      if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
    });
    const isTarget = open && canEdit && !!drag;

    return (
      <div
        key={box.id}
        onClick={() => setDetailBoxId(box.id)}
        onDragOver={(e) => { if (!isTarget) return; e.preventDefault(); e.stopPropagation(); setOverBox(box.id); }}
        onDragLeave={() => setOverBox((s) => (s === box.id ? null : s))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBox(box); }}
        style={{
          border: `2px ${isTarget && overBox === box.id ? "dashed" : "solid"} var(--border)`,
          borderRadius: 10, padding: 12,
          background: overBox === box.id ? "var(--accent-soft)" : "var(--bg)",
          cursor: "pointer",
          transition: "background .12s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="truck" size={14} />
          <span className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {boxLabel(box)}
          </span>
          <span className={`chip palstatus ${open ? "p-loading" : "p-completed"}`}>{open ? "Loading" : "Dispatched"}</span>
          {mixedBatchOrderItems(inBox.map(({ l }) => l)) && (
            <span
              className="chip"
              style={{ fontSize: 11, color: "var(--c-amber)", borderColor: "var(--c-amber)" }}
              title="An item in this box spans more than one batch — tile texture may vary for that customer"
            >
              Mixed batches
            </span>
          )}
          <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>
            {cap ? `${fmt(loaded)} / ${fmt(cap)} box` : `${fmt(loaded)} box`}
          </span>
          <button
            type="button"
            className="btn"
            title="Print QR label"
            style={{ padding: 0, height: 22, width: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}
            onClick={(ev) => { ev.stopPropagation(); void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, inBox)); }}
          >
            <Icon name="qr" size={12} />
          </button>
          <button
            type="button"
            className="btn"
            title="Print Dispatch Copy"
            style={{ padding: 0, height: 22, width: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}
            onClick={(ev) => { ev.stopPropagation(); void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, inBox)); }}
          >
            <Icon name="printer" size={12} />
          </button>
        </div>

        {/* Fill bar — design-coloured segments, % label by fullness. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <div
            style={{ flex: 1, display: "flex", height: 14, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
            title={`${fmt(loaded)} boxes · ${pct}% of a full container`}
          >
            {inBox.map(({ l }) => (
              <div key={l.id} style={{ width: `${lineFrac(l) * 100}%`, background: colorByDesign.get(l.designId) }} title={`${l.designLabel}: ${fmt(l.boxes)} boxes`} />
            ))}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: pctColor, minWidth: 38, textAlign: "right" }} title="Box fill vs the items' pallet capacity">
            {pct}%
          </span>
        </div>
        {inBox.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: pctColor }}>
              {cap
                ? rem > 0 ? `${fmt(rem)} boxes short` : rem === 0 ? "Full — ready to seal" : `${fmt(-rem)} boxes over`
                : pct < 100 ? `${100 - pct}% short` : pct === 100 ? "Full — ready to seal" : `${pct - 100}% over`}
            </span>
          </div>
        )}

        {/* Loaded items. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: inBox.length ? 8 : 0 }}>
          {inBox.map(({ p, l }) => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)", padding: "3px 0", borderTop: "1px solid var(--panel-2)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colorByDesign.get(l.designId), flex: "0 0 auto" }} />
              <button
                type="button"
                className="linkish"
                style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                onClick={(ev) => { ev.stopPropagation(); navigate(`/packing/${p.id}`); }}
                title={`Open ${p.palNumber}`}
              >
                <span className="mono">{l.itemCode}</span> · {l.designLabel}
                {l.batchNumber ? <span className="dim mono"> · {l.batchNumber}</span> : null}
              </button>
              <span className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.customerName}</span>
              <span className="dim mono" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{fmt(l.boxes)}</span>
              {canEdit && open && (
                <button
                  type="button"
                  className="btn x"
                  title="Back to Ready for Loading"
                  style={{ padding: 1, height: 16, width: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  onClick={(ev) => { ev.stopPropagation(); void unload(l, box); }}
                >
                  <Icon name="x" size={10} />
                </button>
              )}
            </div>
          ))}
          {open && inBox.length === 0 && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "10px 0", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 6, marginTop: 8 }}>
              Empty — select Ready items and load them here
            </div>
          )}
        </div>

        {/* Vehicle / dispatch footer. */}
        {open ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
              <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {box.vehicleNumber ? [box.vehicleNumber, box.driverName].filter(Boolean).join("  ·  ") : "No vehicle yet"}
              </span>
              {canEdit && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || inBox.length === 0}
                  title="Return all items to Ready for Loading"
                  style={{ marginLeft: "auto", height: 24, padding: "0 10px", fontSize: "var(--t-sm)", flex: "0 0 auto" }}
                  onClick={(ev) => { ev.stopPropagation(); void emptyBox(box); }}
                >
                  Empty
                </button>
              )}
            </div>
            {canEdit && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || selected.size === 0}
                  title={selected.size === 0 ? "Select Ready items on the board first" : `Load the ${selected.size} selected item${selected.size === 1 ? "" : "s"} into ${boxLabel(box)}`}
                  style={{ flex: 1, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
                  onClick={(ev) => { ev.stopPropagation(); void assignLines([...selected], box); }}
                >
                  <Icon name="truck" size={11} /> Load selected{selected.size ? ` (${selected.size})` : ""}
                </button>
                <button
                  type="button"
                  className="hbtn primary"
                  disabled={busy || inBox.length === 0}
                  title={inBox.length === 0 ? "Load at least one item" : pct >= 100 ? "Seal & dispatch this vehicle" : `Dispatch at ${pct}%`}
                  style={{ flex: 1, height: 26, borderRadius: 5, justifyContent: "center", fontSize: "var(--t-sm)" }}
                  onClick={(ev) => { ev.stopPropagation(); setVehModal({ box, dispatch: true }); }}
                >
                  <Icon name="check" size={11} /> Dispatch &amp; print
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {[box.driverName, box.mobileNumber, box.dispatchDate].filter(Boolean).join("  ·  ")}
            </span>
          </div>
        )}
      </div>
    );
  };

  // ---- render -------------------------------------------------
  const selectStyle: React.CSSProperties = { flex: "0 1 auto", minWidth: 0, maxWidth: 150 };
  const viewBtn = (v: "kanban" | "sheet", icon: "kanban" | "orders", label: string) => (
    <button
      onClick={() => setBoardView(v)}
      title={label}
      aria-label={`${label} view`}
      style={{
        background: boardView === v ? "var(--accent-soft)" : "transparent",
        color: boardView === v ? "var(--fg)" : "var(--muted)",
        border: 0, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center",
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

  return (
    <div>
      <div className="dispatch-fill" style={{ display: "flex", gap: 12, alignItems: "stretch", height: "calc(100vh - 172px)", minHeight: 480 }}>
        {/* ============ LEFT · ORDER BOARD ============ */}
        <section className="card" style={{ flex: 1, minWidth: 380, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
          {/* Stage summary + view toggle. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
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
            <span style={{ flex: 1 }} />
            <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", flex: "0 0 auto" }} role="group" aria-label="Board view" title="Switch view">
              {viewBtn("kanban", "kanban", "Kanban")}
              {viewBtn("sheet", "orders", "Sheet")}
            </span>
          </div>

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

          {boardView === "kanban" ? (
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(190px, 1fr))`, gap: 10, padding: 10, overflowX: "auto" }}>
              {COLUMNS.map((col) => {
                const entries = colEntries(col.key);
                const totalBoxes = entries.reduce((s, { l }) => s + l.boxes, 0);
                const accepts = canEdit && !!drag && col.key !== "Done";
                const isOver = overCol === col.key && !overBox;
                return (
                  <div
                    key={col.key}
                    onDragOver={(e) => { if (!accepts) return; e.preventDefault(); setOverCol(col.key); }}
                    onDragLeave={() => setOverCol((s) => (s === col.key ? null : s))}
                    onDrop={(e) => { e.preventDefault(); onDropColumn(col.key); }}
                    style={{
                      display: "flex", flexDirection: "column", minHeight: 0, minWidth: 190,
                      border: "1px solid var(--border)", borderRadius: 8,
                      background: isOver ? "var(--accent-soft)" : "var(--panel-2)",
                      transition: "background .12s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                      <span className={`chip palstatus ${col.chip}`}>{col.label}</span>
                      <span className="muted mono" style={{ fontSize: 12, marginLeft: "auto" }} title={`${fmt(totalBoxes)} boxes`}>
                        {entries.length} · {fmt(totalBoxes)} bx
                      </span>
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
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
                    <th>Container</th>
                    <th>Age</th>
                    <th aria-label="Action" />
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map(({ p, l }) => {
                    const stage = stageOf(p, l);
                    const col = COLUMNS.find((c) => c.key === stage)!;
                    const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
                    const isSel = selected.has(l.id);
                    const selectable = canEdit && stage === "Ready";
                    return (
                      <tr
                        key={l.id}
                        onClick={() => (selectable ? toggleSelect(l) : navigate(`/packing/${p.id}`))}
                        title={selectable ? "Click to select" : `Open ${p.palNumber}`}
                        style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : undefined }}
                      >
                        <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{l.itemCode}{isSel ? " ✓" : ""}</td>
                        <td>{l.designLabel}</td>
                        <td>
                          {l.customerName || "—"}
                          <div className="dim mono" style={{ fontSize: "var(--t-xs)" }}>{l.soNumber || "—"}</div>
                        </td>
                        <td className="mono" style={{ fontSize: "var(--t-sm)" }}>{l.batchNumber || "—"}</td>
                        <td><span className={`chip palstatus ${col.chip}`} style={{ whiteSpace: "nowrap" }}>{col.label}</span></td>
                        <td style={{ whiteSpace: "nowrap" }}>{box ? boxLabel(box) : "—"}</td>
                        <td className="dim">{ageDays(p)}d</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {canEdit && (stage === "Planning" || stage === "Palletizing") && (
                            <button
                              type="button"
                              className="btn"
                              style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }}
                              disabled={busy}
                              onClick={(ev) => { ev.stopPropagation(); void moveLines([l.id], "ReadyToLoad"); }}
                            >
                              Mark ready →
                            </button>
                          )}
                          {canEdit && stage === "Ready" && (
                            <button
                              type="button"
                              className="btn"
                              style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)", display: "inline-flex", alignItems: "center", gap: 5 }}
                              disabled={busy}
                              onClick={(ev) => { ev.stopPropagation(); setPicker({ lineId: l.id }); }}
                            >
                              <Icon name="truck" size={11} /> Load
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {sheetRows.length === 0 && (
                    <tr><td colSpan={8} className="dim" style={{ textAlign: "center", padding: 24 }}>Nothing here</td></tr>
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
                  ? `${selected.size} selected · ${fmt(selBoxes)} boxes — press “Load selected” on a container, or drag onto one`
                  : "Click Ready for Loading items to multi-select, or drag straight onto a container"}
              </span>
              <span style={{ flex: 1 }} />
              {selected.size > 0 && (
                <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
            </div>
          )}
        </section>

        {/* ============ RIGHT · CONTAINERS AT DOCK ============ */}
        <section
          className="card"
          style={{ width: 340, minWidth: 300, flexShrink: 0, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
          onDragOver={(e) => { if (!canEdit || !drag) return; e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (!overBox) onDropBay(); }}
        >
          <div className="fbar" style={{ margin: 0, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
            <Icon name="truck" size={13} />
            <span style={{ fontWeight: 600, fontSize: "var(--t-md)", whiteSpace: "nowrap" }}>Containers at dock</span>
            {selected.size > 0 && (
              <span className="chip" style={{ fontSize: 11, color: "var(--accent)", borderColor: "var(--accent)" }}>
                {selected.size} selected
              </span>
            )}
            <span style={{ flex: 1 }} />
            <select value={bayCountry} onChange={(e) => setBayCountry(e.target.value)} title="Destination" style={selectStyle}>
              <option value="">All destinations</option>
              {opts.countries.map((o) => <option key={o} value={o}>{isoInfo(o).country}</option>)}
            </select>
            <select value={bayStatus} onChange={(e) => setBayStatus(e.target.value as typeof bayStatus)} title="Status" style={selectStyle}>
              <option value="open">Open boxes</option>
              <option value="all">Open + dispatched</option>
              <option value="dispatched">Dispatched only</option>
              <option value="short">Short of 100% only</option>
            </select>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: 10 }}>
            {bayBoxes.map((b) => boxCard(b))}
            {bayBoxes.length === 0 && (
              <div className="dim" style={{ fontSize: "var(--t-sm)", padding: 24, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8 }}>
                No containers here — drag a Ready item onto this panel to start one
              </div>
            )}
          </div>
        </section>
      </div>

      {picker && (() => {
        const line = allLines.find(({ l }) => l.id === picker.lineId)?.l;
        return line ? (
          <BoxPickerModal
            line={line}
            boxes={openBoxes.filter((b) => !isEmptyBox(b))}
            linesOfBox={linesOfBox}
            presetBoxId={picker.presetBoxId}
            busy={busy}
            onConfirm={(boxId, count) => void confirmLoad(boxId, count)}
            onClose={() => setPicker(null)}
          />
        ) : null;
      })()}

      {palletPick && (
        <PalletPickerModal
          line={palletPick}
          busy={busy}
          onConfirm={async (palletId) => {
            setBusy(true);
            const res = await setPalLineStatus(palletPick.id, "Palletizing", palletId);
            setBusy(false);
            setPalletPick(null);
            after(res.ok, res.ok ? "" : res.error || "Move failed", `${palletPick.itemCode} → Palletization`);
          }}
          onClose={() => setPalletPick(null)}
        />
      )}

      {detailBoxId && (() => {
        const box = boxById.get(detailBoxId);
        return box ? (
          <BoxDetailsModal box={box} entries={linesOfBox(box.id)} onClose={() => setDetailBoxId(null)} />
        ) : null;
      })()}

      {vehModal && (
        <VehicleLoadModal
          palNumber={boxLabel(vehModal.box)}
          busy={busy}
          initialVehicleId={vehModal.box.vehicleId}
          initialCapture={{
            container_number: vehModal.box.containerNumber,
            line_seal: vehModal.box.lineSeal,
            electronic_seal: vehModal.box.electronicSeal,
            loading_supervisor: vehModal.box.loadingSupervisor,
          }}
          onConfirm={(vehicleId, capture) => void assignVehicle(vehicleId, capture)}
          onClose={() => setVehModal(null)}
        />
      )}

      {entryOverlay && (
        <DispatchEntryOverlay
          // Prefer the refetched box — it carries the just-assigned vehicle + dispatch date.
          box={boxById.get(entryOverlay.box.id) ?? entryOverlay.box}
          entries={entryOverlay.entries}
          onClose={() => setEntryOverlay(null)}
        />
      )}
    </div>
  );
}
