/* ============================================================
   Loading (/loading) — the loading & dispatch board, standard list-page kit
   (2026-08-24 revamp of the two-panel dock; git history holds the old layout).
   Cards/rows are PalletizationPlanLines moving through Ready for Loading →
   In Loading → Ready for Dispatch → Dispatch. The stage is DERIVED: no box =
   Ready; Open box = In Loading; Open box with container no / line seal
   captured = Ready for Dispatch; Dispatched box = done. "Confirm Load"
   (VehicleLoadModal) captures vehicle + seals on the Open box; "Dispatch" then
   just sets the date — the old one-shot dispatch is split in two.
   Kanban/Sheet toggle, search, advanced filter, ColumnPicker, and the
   Production-style group-by swimlanes/bands; "New Loading" mints an empty
   LoadBox and opens its detail page (/loading/:id) — loadings can be filled
   there directly (Add Items), independent of palletization.
   ponytail: no drag-and-drop here — checkbox selection + Load batch covers
   it; restore b600df5's onDropBox/onDropBay wiring if the crew asks.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { fmt } from "@/lib/format";
import { isoInfo } from "@/features/masters/customersApi";
import { MoreMenu } from "@/features/common/DetailBits";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { BoxPickerModal } from "./BoxPickerModal";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import {
  boxFill,
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
  deleteLoadBox,
  dispatchLoadBox,
  invalidatePalPlans,
  lineFrac,
  listPalPlans,
  sealed,
  setLineBox,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

type Entry = { p: PalPlan; l: PalPlanLine };

// Derived loading stage of a line (see the header comment).
type LoadStage = "Ready" | "InLoading" | "ReadyDispatch" | "Dispatched";
const STAGES = [
  { key: "Ready", label: "Ready for Loading", chip: "p-ready" },
  { key: "InLoading", label: "In Loading", chip: "p-loading" },
  { key: "ReadyDispatch", label: "Ready for Dispatch", chip: "p-palletized" },
  { key: "Dispatched", label: "Dispatch", chip: "p-completed" },
] as const;
const stageMeta = (s: LoadStage) => STAGES.find((c) => c.key === s)!;
const STAGE_IDX = new Map(STAGES.map((c, i) => [c.key, i]));

// A row = one line + its derived stage (box resolved once).
type Row = { p: PalPlan; l: PalPlanLine; stage: LoadStage; box?: LoadBox };

// Board/sheet grouping dimensions (same mechanism as Production).
type LoadGroupBy = "customer" | "so" | "container" | "batch" | "item";
const GROUP_DIMS: Array<{ id: LoadGroupBy; label: string }> = [
  { id: "customer", label: "Customer" },
  { id: "so", label: "Order" },
  { id: "container", label: "Container" },
  { id: "batch", label: "Batch" },
  { id: "item", label: "Item" },
];
const laneKey = (r: Row, d: LoadGroupBy): string =>
  d === "customer" ? r.l.customerName || "—"
  : d === "so" ? r.l.soNumber || "No SO"
  : d === "container" ? (r.box ? boxLabel(r.box) : "—")
  : d === "batch" ? (r.l.batchNumber ? `Batch ${r.l.batchNumber}` : "No batch")
  : r.l.designLabel || "—";

// Age = days since the LINE was created (same rule as the Palletization board).
const ageDays = (p: PalPlan, l: PalPlanLine) => {
  const t = Date.parse((l.createdTime || p.createdTime || "").slice(0, 19).replace(" ", "T"));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
};

/* Data-driven sheet columns (item code pinned outside as the row identity). */
function loadColumns(): ColumnDef<Row>[] {
  return [
    { key: "design", label: "Design", render: (r) => <span className="design-name">{r.l.designLabel}</span> },
    { key: "customer", label: "Customer", render: (r) => r.l.customerName || "—" },
    { key: "so", label: "Order", className: "mono", render: (r) => r.l.soNumber || "—" },
    {
      key: "batch",
      label: "Batch",
      className: "mono",
      render: (r) => (
        <>
          {r.l.batchNumber || "—"}
          {r.l.palletGroup && (
            <span className="chip" style={{ fontSize: 11, marginLeft: 6, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="Shares a physical pallet with another batch/item">
              Mix Batch
            </span>
          )}
        </>
      ),
    },
    { key: "boxes", label: "Boxes", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.l.boxes) },
    {
      key: "stage",
      label: "Status",
      render: (r) => <span className={`chip palstatus ${stageMeta(r.stage).chip}`} style={{ whiteSpace: "nowrap" }}>{stageMeta(r.stage).label}</span>,
    },
    { key: "container", label: "Container", render: (r) => (r.box ? boxLabel(r.box) : "—") },
    { key: "vehicle", label: "Vehicle", render: (r) => (r.box ? [r.box.vehicleNumber, r.box.driverName].filter(Boolean).join("  ·  ") || "—" : "—") },
    { key: "containerNo", label: "Container No.", className: "mono", render: (r) => r.box?.containerNumber || "—" },
    { key: "seal", label: "Seals", className: "mono", render: (r) => (r.box ? [r.box.lineSeal, r.box.electronicSeal].filter(Boolean).join("  ·  ") || "—" : "—") },
    { key: "supervisor", label: "Supervisor", render: (r) => r.box?.loadingSupervisor || "—" },
    { key: "dispatchDate", label: "Dispatch Date", className: "mono muted", render: (r) => r.box?.dispatchDate || "—" },
    { key: "age", label: "Age", className: "muted", render: (r) => `${ageDays(r.p, r.l)}d` },
  ];
}

// Sortable value per column key (header-click sorting — grid standard).
function loadSortVal(r: Row, k: string): string | number {
  switch (k) {
    case "code": return r.l.itemCode;
    case "design": return r.l.designLabel;
    case "customer": return r.l.customerName;
    case "so": return r.l.soNumber || "";
    case "batch": return r.l.batchNumber || "";
    case "boxes": return r.l.boxes;
    case "stage": return STAGE_IDX.get(r.stage) ?? 0;
    case "container": return r.box ? boxLabel(r.box) : "";
    case "vehicle": return r.box?.vehicleNumber || "";
    case "containerNo": return r.box?.containerNumber || "";
    case "seal": return r.box?.lineSeal || "";
    case "supervisor": return r.box?.loadingSupervisor || "";
    case "dispatchDate": return r.box?.dispatchDate || "";
    case "age": return ageDays(r.p, r.l);
    default: return "";
  }
}

export function LoadingBay() {
  const navigate = useNavigate();
  const canEdit = can("stages", "edit");

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listPalPlans();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load palletization plans");
      return;
    }
    setError(null);
    setPlans(res.plans);
    setBoxes(res.boxes);
  };
  useEffect(() => {
    void load();
  }, []);

  // Interaction state.
  const [q, setQ] = usePersistedState("loading.query", "");
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("loading.criteria", {});
  const [view, setView] = usePersistedState<"kanban" | "sheet">("loading.view", "kanban");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState<{ box: LoadBox } | null>(null);
  const [picker, setPicker] = useState<{ lineId: string; presetBoxId?: string } | null>(null);
  // Post-dispatch printable Dispatch Entry — entries snapshotted pre-refresh.
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);

  // Grouping: an ordered list of dimensions → nested swimlanes / sheet bands.
  const [groupBy, setGroupBy] = useState<LoadGroupBy[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("loading.groups") || "[]");
      return Array.isArray(v) ? v.filter((d) => GROUP_DIMS.some((o) => o.id === d)) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("loading.groups", JSON.stringify(groupBy));
  }, [groupBy]);
  // Grouping picker (reuses the grid's ColumnPicker: checked = included, row
  // order = nesting order). Checked dims first (in nesting order), rest after.
  const groupCols = useMemo<ColumnDef<unknown>[]>(() => {
    const ordered = [...groupBy, ...GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))];
    return ordered.map((id) => ({ key: id, label: GROUP_DIMS.find((o) => o.id === id)!.label }));
  }, [groupBy]);
  const groupHidden = useMemo(() => new Set(GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))), [groupBy]);
  const toggleGroup = (key: string) =>
    setGroupBy((prev) => (prev.includes(key as LoadGroupBy) ? prev.filter((d) => d !== key) : [...prev, key as LoadGroupBy]));
  const moveGroup = (keys: string[]) => setGroupBy((prev) => keys.filter((k) => prev.includes(k as LoadGroupBy)) as LoadGroupBy[]);

  const COLS = useMemo(() => loadColumns(), []);
  const { ordered, visible, hidden, toggle, move } = useColumns("loadingColumns", COLS, ["vehicle", "seal", "supervisor", "age"]);

  // ---- derived ------------------------------------------------
  const allLines: Entry[] = plans.flatMap((p) => p.lines.map((l) => ({ p, l })));
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const linesOfBox = (boxId: string) => allLines.filter(({ l }) => l.loadBoxId === boxId);
  // Fill is fractional vs each line's PALLET capacity — a box holding 50 boxes
  // of a 100-box pallet reads 50%, whatever the LoadBox.capacity says.
  const fillOf = (b: LoadBox) => boxFill(linesOfBox(b.id).map(({ l }) => l));
  // Hard 100% cap: how many of THIS line's boxes still fit (its pallet's boxes).
  const fitOf = (l: PalPlanLine, b: LoadBox) =>
    l.palletCapacity > 0 ? Math.floor(Math.max(0, 1 - fillOf(b)) * l.palletCapacity) : l.boxes;
  const isEmptyBox = (b: LoadBox) => linesOfBox(b.id).length === 0;
  const openBoxes = boxes.filter((b) => b.status === "Open");

  const stageOf = (l: PalPlanLine): LoadStage | null => {
    const b = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
    if (b?.status === "Dispatched") return "Dispatched";
    if (b) return sealed(b) ? "ReadyDispatch" : "InLoading";
    return l.status === "ReadyToLoad" ? "Ready" : null; // null = pre-loading, lives on /packing
  };
  const rows: Row[] = allLines.flatMap(({ p, l }) => {
    const stage = stageOf(l);
    return stage ? [{ p, l, stage, box: l.loadBoxId ? boxById.get(l.loadBoxId) : undefined }] : [];
  });

  // ---- search + advanced filter -------------------------------
  const filterFields: FilterField<Row>[] = (() => {
    const opts = (get: (r: Row) => string) => [...new Set(rows.map(get).filter(Boolean))].sort();
    const country = (r: Row) => (r.l.countryCode ? isoInfo(r.l.countryCode).country : "");
    return [
      { key: "customer", label: "Customer", type: "multiselect", options: opts((r) => r.l.customerName), get: (r) => r.l.customerName },
      { key: "country", label: "Country", type: "multiselect", options: opts(country), get: country },
      { key: "stage", label: "Status", type: "multiselect", options: STAGES.map((s) => s.label), get: (r) => stageMeta(r.stage).label },
      { key: "batch", label: "Batch", type: "multiselect", options: opts((r) => r.l.batchNumber), get: (r) => r.l.batchNumber },
      { key: "container", label: "Container", type: "multiselect", options: opts((r) => (r.box ? boxLabel(r.box) : "")), get: (r) => (r.box ? boxLabel(r.box) : "") },
      { key: "boxes", label: "Boxes", type: "numrange", get: (r) => r.l.boxes },
      { key: "dispatchDate", label: "Dispatch Date Between", type: "daterange", get: (r) => r.box?.dispatchDate || "" },
    ];
  })();
  const qLower = q.trim().toLowerCase();
  const searched = rows.filter(
    (r) =>
      !qLower ||
      `${r.l.itemCode} ${r.l.soNumber} ${r.l.customerName} ${r.l.designLabel} ${r.l.batchNumber} ${r.p.palNumber} ${r.box ? boxLabel(r.box) : ""}`
        .toLowerCase()
        .includes(qLower),
  );
  const filtered = applyFilters(searched, criteria, filterFields);

  // ---- sort / pager / group bands (sheet) ---------------------
  const sort = useSortRows(filtered, loadSortVal, "stage");
  const pager = usePagination(filtered.length, "loadingPageSize", `${q}|${JSON.stringify(criteria)}|${groupBy.join(",")}`);
  const groupKeyOf = (r: Row): string => groupBy.map((d) => laneKey(r, d)).join("  ›  ");
  // Sheet groups rows into sections by the selected dims (adjacent within page).
  const sheetSorted = groupBy.length ? [...sort.sorted].sort((a, b) => groupKeyOf(a).localeCompare(groupKeyOf(b))) : sort.sorted;
  const sheetRows = pager.slice(sheetSorted);
  // Per-section totals over the WHOLE filtered set (not just the page).
  const groupTotals = (() => {
    const m = new Map<string, { count: number; boxes: number }>();
    if (!groupBy.length) return m;
    for (const r of sheetSorted) {
      const k = groupKeyOf(r);
      const cur = m.get(k) || { count: 0, boxes: 0 };
      cur.count += 1;
      cur.boxes += r.l.boxes;
      m.set(k, cur);
    }
    return m;
  })();

  // Prune stale selection after a refresh moves lines on.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(allLines.filter(({ l }) => l.status === "ReadyToLoad" && !l.loadBoxId).map(({ l }) => l.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, boxes]);

  // ---- mutations (all sequential + one refresh, house pattern) ----
  const after = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    void load();
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
    if (err && ok > 0) { invalidatePalPlans(); void load(); }
  };

  // "Load selected" into a chosen container. boxId null = reuse a lingering
  // empty box before minting another, so box numbers don't pile up.
  const loadBatch = async (ids: string[], boxId: string | null) => {
    if (busy || ids.length === 0) return;
    let box = boxId ? boxes.find((b) => b.id === boxId) : openBoxes.find(isEmptyBox);
    if (!box) {
      setBusy(true);
      const created = await createLoadBox();
      setBusy(false);
      if (!created.ok || !created.data?.ROWID) {
        after(false, created.error || "Could not add a box", "");
        return;
      }
      // Fresh box — enough of a stub for assignLines (fill 0, label "Box N").
      box = {
        id: String(created.data.ROWID),
        boxNumber: Number(created.data.box_number) || 0,
        vehicleId: "", vehicleNumber: "", driverName: "", mobileNumber: "",
        capacity: 0, status: "Open", dispatchDate: "",
        containerNumber: "", lineSeal: "", electronicSeal: "", loadingSupervisor: "",
        createdTime: "",
      };
    }
    await assignLines(ids, box);
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
      // "New box": reuse a lingering empty box before minting another.
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

  // "New Loading": an empty Open box, independent of palletization — lands on
  // its detail page where items are added directly (Add Items) or from Ready.
  const newContainer = async () => {
    if (busy) return;
    setBusy(true);
    const res = await createLoadBox();
    setBusy(false);
    after(res.ok, res.error || "Could not add a loading", `Loading ${res.data?.box_number ?? ""} added`.trim());
    if (res.ok && res.data?.ROWID) navigate(`/loading/${encodeURIComponent(String(res.data.ROWID))}`);
  };

  // "Confirm Load": capture vehicle + container/seal details on the Open box.
  // Once a container no or line seal lands, the box derives Ready for Dispatch.
  const confirmLoadDetails = async (vehicleId: string, capture: LoadingCapture) => {
    const t = vehModal;
    setVehModal(null);
    if (!t) return;
    setBusy(true);
    // Only send `vehicle` when chosen (server rejects an empty vehicle).
    const res = await updateLoadBox(t.box.id, { ...(vehicleId ? { vehicle: vehicleId } : {}), ...capture });
    setBusy(false);
    const nowSealed = !!(capture.container_number || capture.line_seal);
    after(res.ok, res.error || "Could not save loading details", nowSealed ? `${boxLabel(t.box)} → Ready for Dispatch` : "Loading details saved");
  };

  // "Dispatch": the box is already sealed (Confirm Load) — just confirm + date.
  const dispatchBox = async (box: LoadBox) => {
    if (busy) return;
    const inBox = linesOfBox(box.id);
    const ok = await confirmDialog({
      title: "Dispatch",
      message: `Dispatch ${boxLabel(box)}? ${inBox.length} item${inBox.length === 1 ? "" : "s"} leave with it.`,
    });
    if (!ok) return;
    // Snapshot the loaded lines BEFORE the refetch moves them to Dispatched.
    setBusy(true);
    const res = await dispatchLoadBox(box.id);
    setBusy(false);
    after(res.ok, res.error || "Could not dispatch", `${boxLabel(box)} dispatched`);
    if (res.ok) setEntryOverlay({ box, entries: inBox });
  };

  // Delete an Open loading — its items fall back to Ready for Loading.
  const deleteBox = async (box: LoadBox) => {
    if (busy) return;
    const inBox = linesOfBox(box.id);
    const ok = await confirmDialog({
      title: "Delete loading",
      message:
        inBox.length > 0
          ? `Delete ${boxLabel(box)}? ${inBox.length} item${inBox.length === 1 ? "" : "s"} return to Ready for Loading.`
          : `Delete ${boxLabel(box)}?`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await deleteLoadBox(box.id);
    setBusy(false);
    after(res.ok, res.error || "Could not delete the loading", `${boxLabel(box)} deleted`);
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
    if (err) { invalidatePalPlans(); void load(); }
  };

  // ---- selection ----------------------------------------------
  const selBoxes = allLines.filter(({ l }) => selected.has(l.id)).reduce((s, { l }) => s + l.boxes, 0);
  const toggleSelect = (l: PalPlanLine) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(l.id)) next.delete(l.id); else next.add(l.id);
      return next;
    });

  // "Load selected" targets: the open containers plus a fresh one.
  const batchMenuItems = (ids: string[]) => [
    ...openBoxes.map((b) => ({ label: `${boxLabel(b)} · ${Math.round(fillOf(b) * 100)}% full`, onClick: () => void loadBatch(ids, b.id) })),
    { label: "New box", onClick: () => void loadBatch(ids, null) },
  ];

  // Per-row container actions (Edit option) by stage.
  const menuFor = (r: Row): { label: string; danger?: boolean; onClick: () => void }[] => {
    const box = r.box;
    if (!box) return [];
    const items: { label: string; danger?: boolean; onClick: () => void }[] = [];
    if (canEdit && box.status === "Open") {
      items.push({ label: r.stage === "ReadyDispatch" ? "Edit load details" : "Confirm Load", onClick: () => setVehModal({ box }) });
      items.push({ label: "Unload item", onClick: () => void unload(r.l, box) });
      items.push({ label: "Empty box", danger: true, onClick: () => void emptyBox(box) });
    }
    items.push({ label: "Loading details", onClick: () => navigate(`/loading/${encodeURIComponent(box.id)}`) });
    items.push({ label: "Print QR label", onClick: () => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, linesOfBox(box.id))) });
    items.push({ label: "Dispatch Copy", onClick: () => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, linesOfBox(box.id))) });
    if (canEdit && box.status === "Open") {
      items.push({ label: "Delete loading", danger: true, onClick: () => void deleteBox(box) });
    }
    return items;
  };

  // ---- kanban card --------------------------------------------
  const card = (r: Row) => {
    const { p, l, stage, box } = r;
    const isSel = selected.has(l.id);
    return (
      <div
        key={l.id}
        onClick={() => navigate(box ? `/loading/${encodeURIComponent(box.id)}` : `/packing/${p.id}`)}
        title={box ? `Open ${boxLabel(box)}` : `Open ${p.palNumber}`}
        style={{
          border: `1px solid ${isSel ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8, padding: 10,
          background: isSel ? "var(--accent-soft)" : "var(--bg)",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {canEdit && stage === "Ready" && (
            <input
              type="checkbox"
              checked={isSel}
              onClick={(ev) => ev.stopPropagation()}
              onChange={() => toggleSelect(l)}
              title="Select to load together"
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
            style={{ marginLeft: "auto", fontSize: 11 }}
            title={l.palletCapacity > 0 ? `${fmt(l.boxes)} of ${fmt(l.palletCapacity)} boxes — a full ${l.palletName} container` : undefined}
          >
            {fmt(l.boxes)} box{l.palletCapacity > 0 ? ` · ${Math.round(lineFrac(l) * 100)}%` : ""}
          </span>
          {box && (
            <span onClick={(ev) => ev.stopPropagation()} style={{ flex: "0 0 auto", display: "inline-flex" }}>
              <MoreMenu kebab items={menuFor(r)} />
            </span>
          )}
        </div>
        <div className="design-name" style={{ marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {l.designLabel}
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[l.customerName, l.soNumber].filter(Boolean).join("  ·  ") || "—"}
        </div>
        {(l.batchNumber || l.palletGroup || box) && (
          <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            {l.batchNumber && (
              <span className="chip mono" style={{ fontSize: 11 }} title="Production batch — load one batch per customer for uniform texture">
                Batch {l.batchNumber}
              </span>
            )}
            {l.palletGroup && (
              <span className="chip" style={{ fontSize: 11, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="This item shares a physical pallet with another batch/item">
                Mix Batch
              </span>
            )}
            {box && (
              <span className="chip mono" style={{ fontSize: 11 }} title={`Container · ${Math.round(fillOf(box) * 100)}% full`}>
                <Icon name="truck" size={10} /> {boxLabel(box)}
              </span>
            )}
            {box && sealed(box) && (
              <span className="chip mono" style={{ fontSize: 11 }} title="Container no. / line seal captured">
                {box.containerNumber || box.lineSeal}
              </span>
            )}
            {stage === "Dispatched" && box?.dispatchDate && (
              <span className="chip mono" style={{ fontSize: 11 }} title="Dispatch date">{box.dispatchDate}</span>
            )}
          </div>
        )}
        {canEdit && stage === "Ready" && (
          <button
            type="button"
            className="btn"
            disabled={busy}
            style={{ width: "100%", marginTop: 8, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); setPicker({ lineId: l.id }); }}
            title="Load into a container"
          >
            <Icon name="truck" size={11} /> Load →
          </button>
        )}
        {canEdit && stage === "InLoading" && box && (
          <button
            type="button"
            className="hbtn primary"
            disabled={busy}
            style={{ width: "100%", marginTop: 8, height: 26, borderRadius: 5, justifyContent: "center", fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); setVehModal({ box }); }}
            title={`Capture vehicle + seals for ${boxLabel(box)}`}
          >
            Confirm Load →
          </button>
        )}
        {canEdit && stage === "ReadyDispatch" && box && (
          <button
            type="button"
            className="hbtn primary"
            disabled={busy}
            style={{ width: "100%", marginTop: 8, height: 26, borderRadius: 5, justifyContent: "center", fontSize: "var(--t-sm)" }}
            onClick={(ev) => { ev.stopPropagation(); void dispatchBox(box); }}
            title={`Dispatch ${boxLabel(box)} — the Dispatch Entry opens after`}
          >
            <Icon name="check" size={11} /> Dispatch →
          </button>
        )}
      </div>
    );
  };

  // Empty Open loadings have no line rows, so without a card they'd be
  // unreachable from the board — show them in In Loading as dashed stubs.
  const emptyBoxCard = (b: LoadBox) => (
    <div
      key={`empty-${b.id}`}
      onClick={() => navigate(`/loading/${encodeURIComponent(b.id)}`)}
      title={`Open ${boxLabel(b)}`}
      style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)", cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="truck" size={12} />
        <span className="mono" style={{ fontWeight: 600 }}>{boxLabel(b)}</span>
        <span className="chip" style={{ marginLeft: "auto", fontSize: 11 }}>Empty</span>
      </div>
      <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>No items yet — open to add items</div>
    </div>
  );

  // ---- kanban: stage columns + nested swimlanes ---------------
  // ponytail: empty loadings render on the ungrouped board only — inside
  // group lanes they'd duplicate per lane; the sheet stays line-rows only.
  const stageGrid = (laneRows: Row[], showEmpties = false) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
      {STAGES.map((col) => {
        const cards = laneRows.filter((r) => r.stage === col.key);
        const totalBoxes = cards.reduce((s, r) => s + r.l.boxes, 0);
        const empties = showEmpties && col.key === "InLoading" ? openBoxes.filter(isEmptyBox) : [];
        return (
          <div key={col.key} className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
              <span className={`chip palstatus ${col.chip}`}>{col.label}</span>
              <span className="muted mono" style={{ fontSize: 12, marginLeft: "auto" }} title={`${fmt(totalBoxes)} boxes`}>
                {cards.length} · {fmt(totalBoxes)} bx
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, minHeight: 80 }}>
              {cards.map(card)}
              {empties.map(emptyBoxCard)}
              {cards.length === 0 && empties.length === 0 && <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "6px 2px" }}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Nested swimlanes: partition by dims[0], recurse on the rest; at the leaf
  // render the stage columns. Empty groupBy → flat board.
  // ponytail: duplicated from ProductionKanban.renderLevel — a generic
  // extraction (card type + dims + laneKey params) would outweigh these lines.
  const renderLevel = (laneRows: Row[], dims: LoadGroupBy[], depth: number): JSX.Element => {
    if (dims.length === 0) return stageGrid(laneRows, depth === 0);
    const by = new Map<string, Row[]>();
    for (const r of laneRows) {
      const k = laneKey(r, dims[0]);
      (by.get(k) ?? by.set(k, []).get(k)!).push(r);
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
                  <span className="muted" style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0 }}>{sub.length}</span>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--muted)" }}>{k}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{sub.length}</span>
                </div>
              )}
              {renderLevel(sub, dims.slice(1), depth + 1)}
            </div>
          ))}
      </div>
    );
  };

  // ---- render -------------------------------------------------
  const stageCount = (s: LoadStage) => rows.filter((r) => r.stage === s).length;

  const viewBtn = (v: "kanban" | "sheet", icon: "kanban" | "orders", label: string) => (
    <button
      onClick={() => setView(v)}
      title={label}
      aria-label={`${label} view`}
      style={{
        background: view === v ? "var(--accent-soft)" : "transparent",
        color: view === v ? "var(--fg)" : "var(--muted)",
        border: 0, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center",
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Loading</div>
          <div className="sub">
            {stageCount("Ready")} ready · {stageCount("InLoading")} in loading · {stageCount("ReadyDispatch")} ready for dispatch
          </div>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar" style={{ marginBottom: 12 }}>
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search item, SO, customer, batch, container…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        <div style={{ flex: 1 }} />
        <AdvancedFilterButton title="Loading" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="Board view" title="Switch view">
          {viewBtn("kanban", "kanban", "Kanban")}
          {viewBtn("sheet", "orders", "Sheet")}
        </span>
        <ColumnPicker
          columns={groupCols}
          hidden={groupHidden}
          onToggle={toggleGroup}
          onMove={moveGroup}
          onClear={() => setGroupBy([])}
          label={groupBy.length ? `Group: ${groupBy.map((d) => GROUP_DIMS.find((o) => o.id === d)!.label).join(" › ")}` : "Group"}
          icon="menu"
          title="Group into sections — check dimensions, drag to set order"
        />
        {view === "sheet" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />}
        {canEdit && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={busy} onClick={() => void newContainer()}>
            <Icon name="plus" size={13} />
            New Loading
          </button>
        )}
      </div>

      {/* Selection bar — load several Ready items into one container. */}
      {canEdit && selected.size > 0 && (
        <div className="fbar" style={{ marginBottom: 12, borderLeft: "3px solid var(--accent)" }}>
          <span className="mono" style={{ color: "var(--accent)" }}>{selected.size} selected · {fmt(selBoxes)} boxes</span>
          <MoreMenu label="Load selected" items={batchMenuItems([...selected])} />
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {loading && plans.length === 0 ? (
        <div className="card"><SkeletonRows rows={6} /></div>
      ) : view === "kanban" ? (
        renderLevel(filtered, groupBy, 0)
      ) : (
        <div className="card">
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="code" label="Pallet" sort={sort} />
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                  {canEdit && <th style={{ width: 130 }} aria-label="Action" />}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const out: ReactNode[] = [];
                  const span = visible.length + 1 + (canEdit ? 1 : 0);
                  let prevKey: string | null = null;
                  for (const r of sheetRows) {
                    if (groupBy.length) {
                      const key = groupKeyOf(r);
                      if (key !== prevKey) {
                        prevKey = key;
                        const tot = groupTotals.get(key) || { count: 0, boxes: 0 };
                        out.push(
                          <tr key={`h-${key}`} style={{ background: "var(--accent-soft)", fontWeight: 700, color: "var(--accent-ink)" }}>
                            <td colSpan={span}>
                              {key}
                              <span className="mono" style={{ fontWeight: 400, marginLeft: 10 }}>{tot.count} item{tot.count === 1 ? "" : "s"} · {fmt(tot.boxes)} bx</span>
                            </td>
                          </tr>,
                        );
                      }
                    }
                    const { p, l, stage, box } = r;
                    const isSel = selected.has(l.id);
                    out.push(
                      <tr
                        key={l.id}
                        onClick={() => navigate(box ? `/loading/${encodeURIComponent(box.id)}` : `/packing/${p.id}`)}
                        title={box ? `Open ${boxLabel(box)}` : `Open ${p.palNumber}`}
                        style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : undefined }}
                      >
                        <td className="mono" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {canEdit && stage === "Ready" && (
                              <input
                                type="checkbox"
                                checked={isSel}
                                onClick={(ev) => ev.stopPropagation()}
                                onChange={() => toggleSelect(l)}
                                title="Select to load together"
                                style={{ margin: 0 }}
                              />
                            )}
                            {l.itemCode}
                          </span>
                        </td>
                        {visible.map((c) => (
                          <td key={c.key} className={c.className} style={c.style}>
                            {c.render!(r)}
                          </td>
                        ))}
                        {canEdit && (
                          <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                            {stage === "Ready" && (
                              <button type="button" className="btn" disabled={busy} style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }} onClick={() => setPicker({ lineId: l.id })}>
                                Load →
                              </button>
                            )}
                            {stage === "InLoading" && box && (
                              <button type="button" className="btn" disabled={busy} style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }} onClick={() => setVehModal({ box })}>
                                Confirm Load →
                              </button>
                            )}
                            {stage === "ReadyDispatch" && box && (
                              <button type="button" className="btn" disabled={busy} style={{ height: 24, padding: "0 10px", fontSize: "var(--t-sm)" }} onClick={() => void dispatchBox(box)}>
                                Dispatch →
                              </button>
                            )}
                            {box && <span style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 6 }}><MoreMenu kebab items={menuFor(r)} /></span>}
                          </td>
                        )}
                      </tr>,
                    );
                  }
                  if (!loading && sheetRows.length === 0) {
                    out.push(
                      <tr key="empty">
                        <td colSpan={span}><EmptyState title="No matching results" hint="Try a different filter" /></td>
                      </tr>,
                    );
                  }
                  return out;
                })()}
              </tbody>
            </table>
          </div>
          {!(loading && plans.length === 0) && <GridFooter {...pager} />}
        </div>
      )}

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

      {vehModal && (
        <VehicleLoadModal
          palNumber={boxLabel(vehModal.box)}
          title="Confirm Load"
          busy={busy}
          initialVehicleId={vehModal.box.vehicleId}
          initialCapture={{
            container_number: vehModal.box.containerNumber,
            line_seal: vehModal.box.lineSeal,
            electronic_seal: vehModal.box.electronicSeal,
            loading_supervisor: vehModal.box.loadingSupervisor,
          }}
          onConfirm={(vehicleId, capture) => void confirmLoadDetails(vehicleId, capture)}
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
