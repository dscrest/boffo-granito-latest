/* ============================================================
   Dispatch Control Board — the /packing board view (replaces PalKanban).
   Two panels: LEFT is a 4-column order board of PalletizationPlanLines
   (In Palletization → Ready for Loading → In Dispatch → Dispatched) with
   filters, FIFO/fits chips and multi-select; RIGHT is the Dispatch panel — one
   card per LoadBox (vehicle slot) with a design-coloured fill bar, gap label,
   swap, and the dispatch flow (vehicle asked at dispatch).
   Click a bay card to open its details (+ Dispatch Copy print); an Open card
   also becomes the FOCUS: the target of the Assign button and multi-drops.
   Hand-rolled HTML5 drag-and-drop
   like Production; loading still routes through BoxPickerModal for single
   lines so partial (split) loads keep working. KPI strip + Board/Split/Bay (hidden/locked)
   width toggle on top.
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { KPI } from "@/ui/primitives";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { fmt } from "@/lib/format";
import { isoInfo } from "@/features/masters/customersApi";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { BoxPickerModal } from "./BoxPickerModal";
import { BoxDetailsModal } from "./BoxDetailsModal";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import {
  createLoadBox,
  dispatchLoadBox,
  invalidatePalPlans,
  setLineBox,
  setPalLineStatus,
  updateLoadBox,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
  type PalLineStatus,
} from "./palPlansApi";

// Board columns — all four hold ITEM cards (a PalPlanLine each); the last two
// are derived from the line's box (Open = In Dispatch, Dispatched = done).
const COLUMNS = [
  { key: "Planning", label: "In Palletization", chip: "p-planning" },
  { key: "Ready", label: "Ready for Loading", chip: "p-ready" },
  { key: "Loading", label: "In Dispatch", chip: "p-loading" },
  { key: "Done", label: "Dispatched", chip: "p-completed" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

// ponytail: KPI strip + FIFO/Fits chips hidden for now — flip to restore.
const SHOW_EXTRAS: boolean = false;

type Entry = { p: PalPlan; l: PalPlanLine };
type Drag = { lineIds: string[]; from: "Planning" | "Ready" } | null;

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
  // Layout locked to Board (wide order board); Split/Bay toggle removed 2026-07-29.
  const leftWidth = "68%";
  // Board filters (session-scoped is overkill — the outer PalPlans search persists already).
  const [q, setQ] = useState("");
  const [fCustomer, setFCustomer] = useState("");
  const [fCountry, setFCountry] = useState("");
  const [fDesign, setFDesign] = useState("");
  const [fSize, setFSize] = useState("");
  const [fifo, setFifo] = useState(false);
  const [fitsFocused, setFitsFocused] = useState(false);
  // Bay filters.
  const [bayCountry, setBayCountry] = useState("");
  const [bayStatus, setBayStatus] = useState<"open" | "all" | "dispatched" | "short">("open");
  // Interaction state.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusBoxId, setFocusBoxId] = useState<string | null>(null);
  const [swapLineId, setSwapLineId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [overBox, setOverBox] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState<{ box: LoadBox; dispatch?: boolean } | null>(null);
  const [detailBoxId, setDetailBoxId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ lineId: string; presetBoxId?: string } | null>(null);

  // ---- derived ------------------------------------------------
  const allLines: Entry[] = plans.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const linesOfBox = (boxId: string) => allLines.filter(({ l }) => l.loadBoxId === boxId);
  const loadedOf = (b: LoadBox) => linesOfBox(b.id).reduce((s, { l }) => s + l.boxes, 0);
  const remainingOf = (b: LoadBox) => b.capacity - loadedOf(b);
  const boxLabel = (b: LoadBox) => b.vehicleNumber || `Box ${b.boxNumber}`;
  // Lines carry no date — age comes from the owning plan (Catalyst "YYYY-MM-DD HH:mm:ss").
  const ageDays = (p: PalPlan) => {
    const t = Date.parse((p.createdTime || "").replace(" ", "T"));
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
  };
  const stageOf = (p: PalPlan, l: PalPlanLine): ColKey => {
    if (l.loadBoxId) return boxById.get(l.loadBoxId)?.status === "Dispatched" ? "Done" : "Loading";
    if (p.status === "Completed") return "Done"; // legacy pre-box dispatched plans
    return l.status === "ReadyToLoad" ? "Ready" : "Planning";
  };

  const openBoxes = boxes.filter((b) => b.status === "Open");
  const focusBox = (focusBoxId && openBoxes.find((b) => b.id === focusBoxId)) || null;
  const focusRemaining = focusBox ? remainingOf(focusBox) : 0;
  const swapEntry = swapLineId ? allLines.find(({ l }) => l.id === swapLineId) ?? null : null;

  // Default / self-heal focus: first Open box once loaded, or after the
  // focused box is dispatched/deleted.
  useEffect(() => {
    if (!focusBoxId || !openBoxes.some((b) => b.id === focusBoxId)) setFocusBoxId(openBoxes[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes]);

  // Prune stale selection / swap target after a refresh moves lines on.
  useEffect(() => {
    setSelected((prev) => {
      const ready = new Set(allLines.filter(({ p, l }) => stageOf(p, l) === "Ready").map(({ l }) => l.id));
      const next = new Set([...prev].filter((id) => ready.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setSwapLineId((id) => (id && allLines.some(({ l }) => l.id === id && l.loadBoxId) ? id : null));
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
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} → ${to === "ReadyToLoad" ? "Ready for Loading" : "In Palletization"}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  const assignLines = async (ids: string[], box: LoadBox) => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    let ok = 0, err = "";
    for (const id of ids) {
      const res = await setLineBox(id, box.id);
      if (res.ok) ok++; else err = res.error || "Could not load the item";
    }
    setBusy(false);
    setSelected(new Set());
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} → ${boxLabel(box)}`);
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
      const created = await createLoadBox();
      if (!created.ok || !created.data?.ROWID) {
        setBusy(false);
        after(false, created.error || "Could not add a box", "");
        return;
      }
      toBox = String(created.data.ROWID);
      label = `Box ${created.data.box_number ?? ""}`.trim();
    }
    const res = await setLineBox(line.id, toBox, count < line.boxes ? count : undefined);
    setBusy(false);
    setPicker(null);
    after(res.ok, res.error || "Could not load the item", `${line.itemCode} → ${label}`);
  };

  const dispatchBox = async (box: LoadBox) => {
    setBusy(true);
    const res = await dispatchLoadBox(box.id);
    setBusy(false);
    after(res.ok, res.error || "Could not dispatch", `${boxLabel(box)} dispatched`);
  };

  const assignVehicle = async (vehicleId: string) => {
    const t = vehModal;
    setVehModal(null);
    if (!t) return;
    setBusy(true);
    const res = await updateLoadBox(t.box.id, { vehicle: vehicleId });
    setBusy(false);
    if (t.dispatch) {
      if (!res.ok) { after(false, res.error || "Could not assign vehicle", ""); return; }
      await dispatchBox(t.box);
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

  // Swap-mode "Swap in": unload the swapped line first.
  const addSuggestion = async (line: PalPlanLine, box: LoadBox, swapOut: PalPlanLine) => {
    if (busy) return;
    setBusy(true);
    const out = await setLineBox(swapOut.id, "");
    if (!out.ok) { setBusy(false); after(false, out.error || "Could not swap out", ""); return; }
    const res = await setLineBox(line.id, box.id);
    setBusy(false);
    setSwapLineId(null);
    after(res.ok, res.error || "Could not load the item", `${swapOut.itemCode} ⇄ ${line.itemCode} in ${boxLabel(box)}`);
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
    if (colKey === "Planning" || colKey === "Ready") {
      const to: PalLineStatus = colKey === "Ready" ? "ReadyToLoad" : "Planning";
      const ids = d.lineIds
        .map((id) => allLines.find(({ l }) => l.id === id)?.l)
        .filter((l): l is PalPlanLine => !!l && !l.loadBoxId && l.status !== to)
        .map((l) => l.id);
      void moveLines(ids, to);
      return;
    }
    if (colKey === "Loading") {
      const ready = draggedReady(d);
      if (ready.length === 0) return;
      if (ready.length === 1) { setPicker({ lineId: ready[0].l.id }); return; }
      if (focusBox) void assignLines(ready.map(({ l }) => l.id), focusBox);
      else toast.error("Click a box in Dispatch to focus it first");
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
    if (fifo && ageDays(p) < 8) return false;
    if (qLower && !`${l.itemCode} ${l.soNumber} ${l.customerName} ${l.designLabel} ${l.sizeCode} ${p.palNumber}`.toLowerCase().includes(qLower)) return false;
    return true;
  };
  const anyFilter = !!(q || fCustomer || fCountry || fDesign || fSize || fifo || fitsFocused);
  const visible = allLines.filter(matches);
  const colEntries = (key: ColKey) => {
    let list = visible.filter((e) => stageOf(e.p, e.l) === key);
    // "Fits" narrows the pickable columns to lines the focused box can absorb whole.
    if (fitsFocused && focusBox && (key === "Planning" || key === "Ready")) list = list.filter(({ l }) => l.boxes <= focusRemaining);
    if (fifo) list = [...list].sort((a, b) => ageDays(b.p) - ageDays(a.p));
    return list;
  };

  // ---- bay filtering ------------------------------------------
  const bayBoxes = boxes
    .filter((b) => {
      if (bayStatus === "open" && b.status !== "Open") return false;
      if (bayStatus === "dispatched" && b.status !== "Dispatched") return false;
      if (bayStatus === "short" && (b.status !== "Open" || remainingOf(b) <= 0)) return false;
      if (bayCountry && !linesOfBox(b.id).some(({ l }) => l.countryCode === bayCountry)) return false;
      return true;
    })
    .sort((a, b) =>
      a.status !== b.status
        ? (a.status === "Open" ? -1 : 1) // Open boxes first
        : a.status === "Open"
          ? a.boxNumber - b.boxNumber
          : (b.dispatchDate || b.createdTime).localeCompare(a.dispatchDate || a.createdTime));

  // ---- KPIs ---------------------------------------------------
  const pending = allLines.filter(({ p, l }) => { const s = stageOf(p, l); return s === "Planning" || s === "Ready"; });
  const aged = pending.filter(({ p }) => ageDays(p) > 7);
  const avgFill = openBoxes.length
    ? Math.round(openBoxes.reduce((s, b) => s + (loadedOf(b) / Math.max(1, b.capacity)) * 100, 0) / openBoxes.length)
    : 0;
  const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const dispatchedToday = boxes.filter((b) => b.status === "Dispatched" && b.dispatchDate.slice(0, 10) === todayISO);

  // ---- selection ----------------------------------------------
  const selEntries = allLines.filter(({ l }) => selected.has(l.id));
  const selBoxes = selEntries.reduce((s, { l }) => s + l.boxes, 0);
  const selOver = focusBox ? selBoxes - focusRemaining : 0;
  const toggleSelect = (l: PalPlanLine) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
      return next;
    });

  const chipBtn = (on: boolean, onClick: () => void, label: string, title?: string) => (
    <button
      type="button"
      className="btn"
      title={title}
      onClick={onClick}
      style={{
        flex: "0 0 auto", whiteSpace: "nowrap",
        background: on ? "var(--accent-soft)" : undefined,
        borderColor: on ? "var(--accent)" : undefined,
        color: on ? "var(--fg)" : undefined,
      }}
    >
      {label}
    </button>
  );

  // ---- left panel: item card ----------------------------------
  const itemCard = (p: PalPlan, l: PalPlanLine, stage: ColKey) => {
    const isSel = selected.has(l.id);
    const canDrag = canEdit && (stage === "Planning" || stage === "Ready");
    const age = ageDays(p);
    const box = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
    const fitsHint = !!swapEntry && stage === "Ready" && focusBox && l.boxes <= focusRemaining + swapEntry.l.boxes;
    return (
      <div
        key={l.id}
        draggable={canDrag}
        onDragStart={() => {
          if (!canDrag) return;
          setDrag({ lineIds: isSel ? [...selected] : [l.id], from: stage as "Planning" | "Ready" });
        }}
        onDragEnd={clearDnd}
        onClick={() => (canEdit && stage === "Ready" ? toggleSelect(l) : navigate(`/packing/${p.id}`))}
        title={stage === "Ready" && canEdit ? "Click to select · drag to a box" : `Open ${p.palNumber}`}
        style={{
          border: `1px solid ${isSel ? "var(--accent)" : fitsHint ? "var(--c-amber)" : "var(--border)"}`,
          borderRadius: 8, padding: 10,
          background: isSel ? "var(--accent-soft)" : "var(--bg)",
          cursor: canDrag ? "grab" : "pointer",
          opacity: drag?.lineIds.includes(l.id) ? 0.5 : 1,
        }}
      >
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
          <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(l.boxes)} box</span>
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
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[l.soNumber, l.palletName].filter((s) => s && s !== "—").join("  ·  ") || "—"}
        </div>
        {box && (
          <div className="dim mono" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>→ {boxLabel(box)}</div>
        )}
        {canEdit && stage === "Ready" && (
          <button
            type="button"
            className="btn"
            style={{ width: "100%", marginTop: 8, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setPicker({ lineId: l.id }); }}
            title="Load into a box"
          >
            <Icon name="truck" size={13} /> Load
          </button>
        )}
      </div>
    );
  };

  // ---- right panel: box card ----------------------------------
  const boxCard = (box: LoadBox) => {
    const inBox = linesOfBox(box.id);
    const loaded = loadedOf(box);
    const rem = box.capacity - loaded;
    const pct = Math.round((loaded / Math.max(1, box.capacity)) * 100);
    const open = box.status === "Open";
    const isFocus = open && focusBox?.id === box.id;
    const pctColor = rem < 0 ? "var(--c-red)" : rem === 0 ? "var(--c-green)" : pct >= 85 ? "var(--c-amber)" : "var(--c-blue)";
    // Stable colour per design (first-seen), same rule as VehicleFillBar.
    const colorByDesign = new Map<string, string>();
    inBox.forEach(({ l }) => {
      if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
    });
    const isTarget = open && canEdit && !!drag;

    // Swap candidates — while swapping a line out of this box: Ready lines
    // that fit the freed space (remaining + the swapped-out line's boxes).
    const swapping = !!swapEntry && swapEntry.l.loadBoxId === box.id;
    const avail = rem + (swapping ? swapEntry!.l.boxes : 0);
    const showSug = open && canEdit && swapping && avail > 0;
    const sugs = showSug
      ? allLines
          .filter(({ p, l }) => stageOf(p, l) === "Ready" && l.boxes <= avail)
          .map((e) => ({ ...e, left: avail - e.l.boxes }))
          .sort((a, b) => a.left - b.left)
          .slice(0, 4)
      : [];

    return (
      <div
        key={box.id}
        onClick={() => { setDetailBoxId(box.id); if (open) setFocusBoxId(box.id); }}
        onDragOver={(e) => { if (!isTarget) return; e.preventDefault(); e.stopPropagation(); setOverBox(box.id); }}
        onDragLeave={() => setOverBox((s) => (s === box.id ? null : s))}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onDropBox(box); }}
        style={{
          border: `2px ${isTarget && overBox === box.id ? "dashed" : "solid"} ${isFocus ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 10, padding: 12,
          background: overBox === box.id ? "var(--accent-soft)" : isFocus ? "var(--accent-soft)" : "var(--bg)",
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
          <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>{fmt(loaded)} / {fmt(box.capacity)} box</span>
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
            title={`${fmt(loaded)} / ${fmt(box.capacity)} boxes`}
          >
            {inBox.map(({ l }) => (
              <div key={l.id} style={{ width: `${(l.boxes / Math.max(1, box.capacity)) * 100}%`, background: colorByDesign.get(l.designId) }} title={`${l.designLabel}: ${fmt(l.boxes)} boxes`} />
            ))}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: pctColor, minWidth: 38, textAlign: "right" }} title="Box fill vs capacity">
            {pct}%
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: pctColor }}>
            {rem > 0 ? `${fmt(rem)} boxes short` : rem === 0 ? "Full — ready to seal" : `${fmt(-rem)} boxes over`}
          </span>
        </div>

        {/* Loaded items. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: inBox.length ? 8 : 0 }}>
          {inBox.map(({ p, l }) => {
            const isSwap = swapLineId === l.id;
            return (
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
                </button>
                <span className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.customerName}</span>
                <span className="dim mono" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{fmt(l.boxes)}</span>
                {canEdit && open && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      title={isSwap ? "Cancel swap" : "Swap this item for another"}
                      style={{
                        height: 20, padding: "0 6px", fontSize: 11, flex: "0 0 auto",
                        background: isSwap ? "var(--c-amber)" : undefined,
                        color: isSwap ? "#fff" : "var(--c-amber)",
                        borderColor: "var(--c-amber)",
                      }}
                      onClick={(ev) => { ev.stopPropagation(); setSwapLineId((s) => (s === l.id ? null : l.id)); setFocusBoxId(box.id); }}
                    >
                      {isSwap ? "Cancel" : "Swap"}
                    </button>
                    <button
                      type="button"
                      className="btn x"
                      title="Back to Ready for Loading"
                      style={{ padding: 1, height: 16, width: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                      onClick={(ev) => { ev.stopPropagation(); void unload(l, box); }}
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {open && inBox.length === 0 && (
            <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "10px 0", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 6, marginTop: 8 }}>
              Drag Ready items here, or select on the board and press Assign
            </div>
          )}
        </div>

        {/* Swap candidates. */}
        {showSug && (
          <div style={{ borderTop: "1px dashed var(--border)", marginTop: 8, paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="dim" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>
              Swap {swapEntry!.l.itemCode} for
            </div>
            {sugs.map(({ p, l, left }) => (
              <div
                key={l.id}
                style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: "var(--t-sm)", padding: "4px 6px",
                  borderRadius: 6, border: `1px dashed ${left === 0 ? "var(--c-green)" : "var(--border)"}`,
                  background: left === 0 ? "color-mix(in oklab, var(--c-green) 10%, transparent)" : undefined,
                }}
              >
                <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.designLabel}</span>
                <span className="dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.customerName}</span>
                <span className="dim mono" style={{ marginLeft: "auto", flex: "0 0 auto" }} title={`${p.palNumber} · leaves ${fmt(left)} boxes`}>
                  {left === 0 ? "exact fit" : `${fmt(l.boxes)} bx · ${fmt(left)} left`}
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ height: 20, padding: "0 8px", fontSize: 11, flex: "0 0 auto" }}
                  disabled={busy}
                  onClick={(ev) => { ev.stopPropagation(); void addSuggestion(l, box, swapEntry!.l); }}
                >
                  Swap in
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Vehicle / dispatch footer. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
          {open ? (
            <>
              <span className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {box.vehicleNumber ? [box.vehicleNumber, box.driverName].filter(Boolean).join("  ·  ") : "No vehicle yet"}
              </span>
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || inBox.length === 0}
                    title={inBox.length === 0 ? "Load at least one item" : "Dispatch this vehicle"}
                    style={{ marginLeft: "auto", height: 24, padding: "0 10px", fontSize: "var(--t-sm)", display: "inline-flex", alignItems: "center", gap: 4, flex: "0 0 auto" }}
                    onClick={(ev) => { ev.stopPropagation(); box.vehicleId ? void dispatchBox(box) : setVehModal({ box, dispatch: true }); }}
                  >
                    <Icon name="check" size={11} /> {rem <= 0 ? "Seal & dispatch" : `Dispatch at ${pct}%`}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || inBox.length === 0}
                    title="Return all items to Ready for Loading"
                    style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)", flex: "0 0 auto" }}
                    onClick={(ev) => { ev.stopPropagation(); void emptyBox(box); }}
                  >
                    Empty
                  </button>
                </>
              )}
            </>
          ) : (
            <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {[box.driverName, box.mobileNumber, box.dispatchDate].filter(Boolean).join("  ·  ")}
            </span>
          )}
        </div>
      </div>
    );
  };

  // ---- render -------------------------------------------------
  const selectStyle: React.CSSProperties = { flex: "0 1 auto", minWidth: 0, maxWidth: 150 };

  return (
    <div>
      {/* KPI strip (hidden for now). */}
      {SHOW_EXTRAS && <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 12 }}>
          <KPI label="Pending to Load" value={fmt(pending.length)} unit="items" delta={`${fmt(pending.reduce((s, { l }) => s + l.boxes, 0))} boxes`} />
          <KPI label="Boxes Open" value={fmt(openBoxes.length)} delta={`avg ${avgFill}% full`} />
          <KPI label="Ageing > 7 Days" value={fmt(aged.length)} unit="items" delta={aged.length ? `${fmt(aged.reduce((s, { l }) => s + l.boxes, 0))} boxes waiting` : "all fresh"} />
          <KPI label="Dispatched Today" value={fmt(dispatchedToday.length)} unit={dispatchedToday.length === 1 ? "vehicle" : "vehicles"} delta={`${fmt(dispatchedToday.reduce((s, b) => s + loadedOf(b), 0))} boxes`} />
        </div>}

      <div className="dispatch-fill" style={{ display: "flex", gap: 12, alignItems: "stretch", height: "calc(100vh - 172px)", minHeight: 480 }}>
        {/* ============ LEFT · ORDER BOARD ============ */}
        <section className="card" style={{ width: leftWidth, minWidth: 380, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
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
            {SHOW_EXTRAS && chipBtn(fifo, () => setFifo((v) => !v), "FIFO · ageing first", "Show only items ageing 8+ days, oldest first")}
            {SHOW_EXTRAS && focusBox && chipBtn(
              fitsFocused,
              () => setFitsFocused((v) => !v),
              `Fits ${boxLabel(focusBox)} (${fmt(focusRemaining)} bx left)`,
              "Only items that still fit whole in the focused box",
            )}
            {anyFilter && (
              <button
                type="button"
                className="btn"
                style={{ marginLeft: "auto", flex: "0 0 auto" }}
                onClick={() => { setQ(""); setFCustomer(""); setFCountry(""); setFDesign(""); setFSize(""); setFifo(false); setFitsFocused(false); }}
              >
                Clear filters
              </button>
            )}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(190px, 1fr))`, gap: 10, padding: 10, overflowX: "auto" }}>
            {COLUMNS.map((col) => {
              const entries = colEntries(col.key);
              const totalBoxes = entries.reduce((s, { l }) => s + l.boxes, 0);
              const accepts = canEdit && !!drag && (col.key === "Planning" || col.key === "Ready" || col.key === "Loading");
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
                    {entries.map(({ p, l }) => itemCard(p, l, col.key))}
                    {entries.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px", textAlign: "center" }}>—</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Selection bar. */}
          {canEdit && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border)", background: selected.size ? (selOver > 0 ? "color-mix(in oklab, var(--c-red) 8%, transparent)" : "var(--accent-soft)") : "var(--panel-2)" }}>
              <span style={{ fontSize: "var(--t-md)", fontWeight: selected.size ? 600 : 400, color: selected.size ? (selOver > 0 ? "var(--c-red)" : "var(--fg)") : "var(--muted)" }}>
                {selected.size
                  ? `${selected.size} selected · ${fmt(selBoxes)} boxes${focusBox ? (selOver > 0 ? ` · exceeds ${boxLabel(focusBox)} by ${fmt(selOver)} bx` : ` · leaves ${fmt(focusRemaining - selBoxes)} bx in ${boxLabel(focusBox)}`) : ""}`
                  : "Click Ready items to multi-select, or drag straight onto a box"}
              </span>
              <span style={{ flex: 1 }} />
              {selected.size > 0 && (
                <button type="button" className="btn" style={{ flex: "0 0 auto" }} onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              )}
              <button
                type="button"
                className="hbtn primary"
                style={{ height: 26, padding: "0 10px", borderRadius: 5, flex: "0 0 auto" }}
                disabled={busy || selected.size === 0 || !focusBox}
                title={!focusBox ? "Click a box in Dispatch to focus it" : selOver > 0 ? "Exceeds capacity — capacity is advisory" : "Assign the selection to the focused box"}
                onClick={() => focusBox && void assignLines([...selected], focusBox)}
              >
                {focusBox ? `Assign ${selected.size || ""} → ${boxLabel(focusBox)}`.replace("  ", " ") : "Assign to box"}
              </button>
            </div>
          )}
        </section>

        {/* ============ RIGHT · DISPATCH ============ */}
        <section
          className="card"
          style={{ flex: 1, minWidth: 340, display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}
          onDragOver={(e) => { if (!canEdit || !drag) return; e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); if (!overBox) onDropBay(); }}
        >
          <div className="fbar" style={{ margin: 0, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexWrap: "nowrap" }}>
            <Icon name="truck" size={13} />
            <span style={{ fontWeight: 600, fontSize: "var(--t-md)", whiteSpace: "nowrap" }}>Dispatch</span>
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
                No boxes here — drag a Ready item onto this panel to start one
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
            boxes={openBoxes}
            linesOfBox={linesOfBox}
            presetBoxId={picker.presetBoxId}
            busy={busy}
            onConfirm={(boxId, count) => void confirmLoad(boxId, count)}
            onClose={() => setPicker(null)}
          />
        ) : null;
      })()}

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
          onConfirm={(vehicleId) => void assignVehicle(vehicleId)}
          onClose={() => setVehModal(null)}
        />
      )}
    </div>
  );
}
