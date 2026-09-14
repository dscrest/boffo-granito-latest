/* ============================================================
   Loading and Dispatch (/loading) — the loading & dispatch board, standard
   list-page kit. Cards/rows are BOXED PalletizationPlanLines moving through
   In Loading → Ready for Dispatch → Dispatched. The stage is DERIVED:
   Open box = In Loading; Open box with container no / line seal captured =
   Ready for Dispatch; Dispatched box = done. Un-boxed Ready-for-Loading
   lines live on /packing since 2026-09-04 — the Load button moved there
   (useLoadFlow is the shared confirm). "Assign Vehicle" (VehicleLoadModal)
   captures vehicle + seals on the Open box; "Dispatch" then just sets the
   date. Kanban/Sheet toggle, search, advanced filter, ColumnPicker, and the
   Production-style group-by swimlanes/bands. "New Loading" opens
   NewLoadingModal (SO → container-plan prefill → one container per
   submit); container/vehicle details are captured via Assign Vehicle.
   ============================================================ */
import { codeOf } from "@/ui/statusCode";
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
import { parseLoadPlan } from "@/data";
import { usePersistedState, useViewState } from "@/lib/usePersistedState";
import { fmt, fmtDateTime } from "@/lib/format";
import { isoInfo } from "@/features/masters/customersApi";
import { cachedOrders } from "@/features/orders/ordersApi";
import { MoreMenu } from "@/features/common/DetailBits";
import { VehicleLoadModal } from "./VehicleLoadModal";
import { LoadingCustomerSheet } from "./LoadingCustomerSheet";
import { LoadingWorkspace } from "./LoadingWorkspace";
import { NewLoadingModal } from "./NewLoadingModal";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import { useLoadFlow } from "./useLoadFlow";
import { nextPlanContainer } from "./containerPlanPrefill";
import {
  boxFill,
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  deleteLoadBox,
  dispatchConfirmMessage,
  dispatchGate,
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
type LoadStage = "InLoading" | "ReadyDispatch" | "Dispatched";
const STAGES = [
  { key: "InLoading", label: "In Loading", chip: "p-loading" },
  { key: "ReadyDispatch", label: "Ready for Dispatch", chip: "p-palletized" },
  { key: "Dispatched", label: "Dispatched", chip: "p-completed" },
] as const;
const stageMeta = (s: LoadStage) => STAGES.find((c) => c.key === s)!;
const STAGE_IDX = new Map(STAGES.map((c, i) => [c.key, i]));

// A row = one line + its derived stage (box resolved once).
type Row = { p: PalPlan; l: PalPlanLine; stage: LoadStage; box?: LoadBox };
type MenuItem = { label: string; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void };

// Board/sheet grouping dimensions (same mechanism as Production).
// Customer only for now — 2026-09-10; stale persisted dims filter out on read.
type LoadGroupBy = "customer";
const GROUP_DIMS: Array<{ id: LoadGroupBy; label: string }> = [
  { id: "customer", label: "Customer" },
];
const laneKey = (r: Row, d: LoadGroupBy): string =>
  d === "customer" ? r.l.customerName || "—" : "—";

const daysSince = (iso: string) => {
  const t = Date.parse((iso || "").slice(0, 19).replace(" ", "T"));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
};
// Age = days since the LINE was created (same rule as the Palletization board).
const ageDays = (p: PalPlan, l: PalPlanLine) => daysSince(l.createdTime || p.createdTime || "");

/* Data-driven sheet columns. Customer then Design lead (the team matches by
   customer + design, CR-161); the LOAD code sits LAST and is hideable like
   any other column. Every cell is one line: `nw` on short values, a `clip`
   span with its own max-width on the long ones (see the .clip note in styles.css). */
function loadColumns(): ColumnDef<Row>[] {
  return [
    {
      key: "customer",
      label: "Customer",
      className: "nw",
      render: (r) => (
        <span className="clip" style={{ maxWidth: 170 }} title={r.l.customerName}>{r.l.customerName || "—"}</span>
      ),
    },
    {
      key: "design",
      label: "Design",
      className: "nw",
      render: (r) => (
        <span className="design-name clip" style={{ maxWidth: 260 }} title={r.l.designLabel}>{r.l.designLabel}</span>
      ),
    },
    { key: "so", label: "Order", className: "mono nw", render: (r) => r.l.soNumber || "—" },
    {
      key: "batch",
      label: "Batch",
      className: "mono nw",
      render: (r) => (
        <>
          {r.l.batchNumber || "—"}
          {r.l.palletGroup && (
            <span className="chip" style={{ fontSize: 13, marginLeft: 6, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="Shares a physical pallet with another batch/item">
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
      render: (r) => <span className={`chip palstatus ${stageMeta(r.stage).chip}`} style={{ whiteSpace: "nowrap" }} title={stageMeta(r.stage).label}>{codeOf(stageMeta(r.stage).label)}</span>,
    },
    {
      key: "vehicle",
      label: "Vehicle",
      className: "nw",
      render: (r) => {
        const v = r.box ? [r.box.vehicleNumber, r.box.driverName].filter(Boolean).join("  ·  ") : "";
        return <span className="clip" style={{ maxWidth: 160 }} title={v}>{v || "—"}</span>;
      },
    },
    { key: "containerNo", label: "Container No.", className: "mono nw", render: (r) => r.box?.containerNumber || "—" },
    {
      key: "seal",
      label: "Seals",
      className: "mono nw",
      render: (r) => {
        const s = r.box ? [r.box.lineSeal, r.box.electronicSeal].filter(Boolean).join("  ·  ") : "";
        return <span className="clip" style={{ maxWidth: 150 }} title={s}>{s || "—"}</span>;
      },
    },
    { key: "containerSize", label: "Size", className: "nw", render: (r) => r.box?.containerSize || "—" },
    {
      key: "transporter",
      label: "Transporter",
      className: "nw",
      render: (r) => (
        <span className="clip" style={{ maxWidth: 150 }} title={r.box?.transporter}>{r.box?.transporter || "—"}</span>
      ),
    },
    { key: "lrNumber", label: "LR / Docket", className: "mono nw", render: (r) => r.box?.lrNumber || "—" },
    {
      key: "destination",
      label: "Destination",
      className: "nw",
      render: (r) => (
        <span className="clip" style={{ maxWidth: 150 }} title={r.box?.destination}>{r.box?.destination || "—"}</span>
      ),
    },
    {
      key: "supervisor",
      label: "Supervisor",
      className: "nw",
      render: (r) => (
        <span className="clip" style={{ maxWidth: 150 }} title={r.box?.loadingSupervisor}>{r.box?.loadingSupervisor || "—"}</span>
      ),
    },
    { key: "dispatchDate", label: "Dispatch Date", className: "mono muted nw", render: (r) => r.box?.dispatchDate || "—" },
    { key: "age", label: "Age", className: "muted nw", render: (r) => `${ageDays(r.p, r.l)}d` },
    { key: "code", label: "Loading", className: "mono nw", style: { fontWeight: 600 }, render: (r) => (r.box ? boxLabel(r.box) : "—") },
  ];
}

// Sortable value per column key (header-click sorting — grid standard).
function loadSortVal(r: Row, k: string): string | number {
  switch (k) {
    case "code": return r.box ? boxLabel(r.box) : "";
    case "design": return r.l.designLabel;
    case "customer": return r.l.customerName;
    case "so": return r.l.soNumber || "";
    case "batch": return r.l.batchNumber || "";
    case "boxes": return r.l.boxes;
    case "stage": return STAGE_IDX.get(r.stage) ?? 0;
    case "vehicle": return r.box?.vehicleNumber || "";
    case "containerNo": return r.box?.containerNumber || "";
    case "seal": return r.box?.lineSeal || "";
    case "containerSize": return r.box?.containerSize || "";
    case "transporter": return r.box?.transporter || "";
    case "lrNumber": return r.box?.lrNumber || "";
    case "destination": return r.box?.destination || "";
    case "supervisor": return r.box?.loadingSupervisor || "";
    case "dispatchDate": return r.box?.dispatchDate || "";
    case "age": return ageDays(r.p, r.l);
    default: return "";
  }
}

/* Loadings view: one row per LoadBox — the box-level master grid. Status is
   derived exactly like LoadingDetail's chip; aggregates are precomputed so
   renderers and sorting share them. */
type BoxStatus = "Empty" | "Planned" | "In Loading" | "Ready for Dispatch" | "Dispatched";
const BOX_STATUS_CHIP: Record<BoxStatus, string> = { Empty: "p-planning", Planned: "p-planning", "In Loading": "p-loading", "Ready for Dispatch": "p-palletized", Dispatched: "p-completed" };
const BOX_STATUS_IDX: Record<BoxStatus, number> = { Empty: 0, Planned: 1, "In Loading": 2, "Ready for Dispatch": 3, Dispatched: 4 };
type BoxRow = {
  box: LoadBox;
  lines: PalPlanLine[];
  customers: string; // distinct, joined
  sos: string; // distinct SO numbers, joined
  totalBoxes: number;
  fillPct: number; // vs pallet capacity (boxFill)
  status: BoxStatus;
};

function boxColumns(): ColumnDef<BoxRow>[] {
  return [
    {
      key: "customers",
      label: "Customers",
      className: "nw",
      render: (r) => <span className="clip" style={{ maxWidth: 200 }} title={r.customers}>{r.customers || "—"}</span>,
    },
    {
      key: "sos",
      label: "Orders",
      className: "mono nw",
      render: (r) => <span className="clip" style={{ maxWidth: 180 }} title={r.sos}>{r.sos || "—"}</span>,
    },
    { key: "items", label: "Items", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.lines.length) },
    { key: "boxes", label: "Boxes", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.totalBoxes) },
    { key: "fill", label: "Fill", className: "num mono", style: { textAlign: "right" }, render: (r) => `${r.fillPct}%` },
    {
      key: "status",
      label: "Status",
      render: (r) => <span className={`chip palstatus ${BOX_STATUS_CHIP[r.status]}`} style={{ whiteSpace: "nowrap" }} title={r.status}>{codeOf(r.status)}</span>,
    },
    { key: "containerNo", label: "Container No.", className: "mono nw", render: (r) => r.box.containerNumber || "—" },
    {
      key: "seal",
      label: "Seals",
      className: "mono nw",
      render: (r) => {
        const s = [r.box.lineSeal, r.box.electronicSeal].filter(Boolean).join("  ·  ");
        return <span className="clip" style={{ maxWidth: 150 }} title={s}>{s || "—"}</span>;
      },
    },
    { key: "containerSize", label: "Size", className: "nw", render: (r) => r.box.containerSize || "—" },
    {
      key: "transporter",
      label: "Transporter",
      className: "nw",
      render: (r) => <span className="clip" style={{ maxWidth: 150 }} title={r.box.transporter}>{r.box.transporter || "—"}</span>,
    },
    { key: "lrNumber", label: "LR / Docket", className: "mono nw", render: (r) => r.box.lrNumber || "—" },
    {
      key: "destination",
      label: "Destination",
      className: "nw",
      render: (r) => <span className="clip" style={{ maxWidth: 150 }} title={r.box.destination}>{r.box.destination || "—"}</span>,
    },
    {
      key: "supervisor",
      label: "Supervisor",
      className: "nw",
      render: (r) => <span className="clip" style={{ maxWidth: 150 }} title={r.box.loadingSupervisor}>{r.box.loadingSupervisor || "—"}</span>,
    },
    { key: "dispatchDate", label: "Dispatch Date", className: "mono muted nw", render: (r) => r.box.dispatchDate || "—" },
    { key: "age", label: "Age", className: "muted nw", render: (r) => `${daysSince(r.box.createdTime)}d` },
    { key: "created", label: "Created", className: "mono muted nw", render: (r) => fmtDateTime(r.box.createdTime) },
    {
      key: "label",
      label: "Loading",
      className: "mono nw",
      style: { fontWeight: 600 },
      render: (r) => {
        const grp = parseLoadPlan(r.box.loadPlan)?.group;
        return (
          <>
            {boxLabel(r.box)}
            {grp && grp.of > 1 && (
              <span className="chip" style={{ marginLeft: 8, fontSize: "var(--t-xs)" }} title="Part of a multi-container loading plan">C{grp.no}/{grp.of}</span>
            )}
          </>
        );
      },
    },
  ];
}

function boxSortVal(r: BoxRow, k: string): string | number {
  switch (k) {
    case "label": return boxLabel(r.box);
    case "customers": return r.customers;
    case "sos": return r.sos;
    case "items": return r.lines.length;
    case "boxes": return r.totalBoxes;
    case "fill": return r.fillPct;
    case "status": return BOX_STATUS_IDX[r.status];
    case "containerNo": return r.box.containerNumber || "";
    case "seal": return r.box.lineSeal || "";
    case "containerSize": return r.box.containerSize || "";
    case "transporter": return r.box.transporter || "";
    case "lrNumber": return r.box.lrNumber || "";
    case "destination": return r.box.destination || "";
    case "supervisor": return r.box.loadingSupervisor || "";
    case "dispatchDate": return r.box.dispatchDate || "";
    case "age": return daysSince(r.box.createdTime);
    case "created": return r.box.createdTime || "";
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
  const [rawView, setView] = useViewState<"workspace" | "kanban" | "sheet" | "loadings" | "customer">("loading.view", "sheet", "sheet");
  // Kanban is disabled here (2026-09-11) — a persisted "kanban" or "board" (the
  // retired 2026-09-10 queue board) falls back to the Sheet grid; render code kept.
  const view = (rawView as string) === "board" || rawView === "kanban" ? "sheet" : rawView;
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vehModal, setVehModal] = useState<{ box: LoadBox } | null>(null);
  // Shared load flow — picker state + confirm live in the hook ("New Loading" here).
  const flow = useLoadFlow({ plans, boxes, onChanged: () => void load() });
  // Post-dispatch printable Dispatch Entry — entries snapshotted pre-refresh.
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);

  // Grouping: an ordered list of dimensions → nested swimlanes / sheet bands.
  // Default = grouped by Customer (2026-09-11). Key bumped to .v2 so stored
  // "[]" from the ungrouped-default era doesn't defeat the new default.
  const [groupBy, setGroupBy] = useState<LoadGroupBy[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("loading.groups.v2") ?? '["customer"]');
      return Array.isArray(v) ? v.filter((d) => GROUP_DIMS.some((o) => o.id === d)) : ["customer"];
    } catch {
      return ["customer"];
    }
  });
  useEffect(() => {
    localStorage.setItem("loading.groups.v2", JSON.stringify(groupBy));
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
  // Key bumped to .v2 (CR-161) so the Customer→Design default order and the
  // now-hideable Loading column apply everywhere; the old prefs are dead.
  const { ordered, visible, hidden, toggle, move } = useColumns("loadingColumns.v2", COLS, ["vehicle", "seal", "containerSize", "transporter", "lrNumber", "destination", "supervisor", "age"]);

  // ---- derived ------------------------------------------------
  const { allLines, openBoxes, linesOfBox } = flow;
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  // Fill is fractional vs each line's PALLET capacity — a box holding 50 boxes
  // of a 100-box pallet reads 50%, whatever the LoadBox.capacity says.
  const fillOf = (b: LoadBox) => boxFill(linesOfBox(b.id).map(({ l }) => l));
  const isEmptyBox = (b: LoadBox) => linesOfBox(b.id).length === 0;

  // Plan-only loading (SO-first New Loading): minted with a load_plan but
  // nothing loaded yet. Summarise SOs/customers from the plan JSON — the SO
  // ROWIDs resolve via pal-plan lines, then the orders cache (no extra fetch).
  // The boxes total follows the SO's LATEST container plan (next unsent
  // container) when it still has one — the minted snapshot is the fallback.
  const planSummary = (b: LoadBox) => {
    const pls = parseLoadPlan(b.loadPlan)?.lines ?? [];
    if (pls.length === 0) return null;
    const soIds = [...new Set(pls.map((x) => x.so).filter(Boolean))];
    const slice = soIds.length === 1 ? nextPlanContainer(soIds[0], flow.planBySo, plans, boxes, flow.designIdOf) : null;
    const heads = soIds.map((id) => {
      const line = allLines.find(({ l }) => l.salesOrderId === id)?.l;
      if (line) return { so: line.soNumber, customer: line.customerName };
      const o = (cachedOrders() ?? []).find((o) => o.salesOrderId === id);
      return { so: o?.orderNumber || "", customer: o?.party || "" };
    });
    return {
      sos: [...new Set(heads.map((h) => h.so).filter(Boolean))].join(", "),
      customers: [...new Set(heads.map((h) => h.customer).filter(Boolean))].join(", "),
      boxes: slice
        ? slice.lines.reduce((s, x) => s + (Number(x.boxes) || 0), 0)
        : pls.reduce((s, x) => s + (Number(x.boxes) || 0), 0),
    };
  };

  // Loadings view rows: every box (Empty and Dispatched included — it's the
  // master list). A plan-only box reads its aggregates from the plan JSON so
  // the row (and search) isn't blank before anything is loaded.
  const boxRows: BoxRow[] = boxes.map((b) => {
    const inBox = linesOfBox(b.id).map(({ l }) => l);
    const plan = inBox.length === 0 ? planSummary(b) : null;
    return {
      box: b,
      lines: inBox,
      customers: plan?.customers ?? [...new Set(inBox.map((l) => l.customerName).filter(Boolean))].join(", "),
      sos: plan?.sos ?? [...new Set(inBox.map((l) => l.soNumber).filter(Boolean))].join(", "),
      totalBoxes: plan?.boxes ?? inBox.reduce((s, l) => s + l.boxes, 0),
      fillPct: Math.round(boxFill(inBox) * 100),
      status: b.status !== "Open" ? "Dispatched" : sealed(b) ? "Ready for Dispatch" : inBox.length ? "In Loading" : plan ? "Planned" : "Empty",
    };
  });

  const stageOf = (l: PalPlanLine): LoadStage | null => {
    const b = l.loadBoxId ? boxById.get(l.loadBoxId) : undefined;
    if (b?.status === "Dispatched") return "Dispatched";
    if (b) return sealed(b) ? "ReadyDispatch" : "InLoading";
    return null; // un-boxed (incl. Ready for Loading) = pre-loading, lives on /packing
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
      { key: "container", label: "Loading", type: "multiselect", options: opts((r) => (r.box ? boxLabel(r.box) : "")), get: (r) => (r.box ? boxLabel(r.box) : "") },
      { key: "boxes", label: "Boxes", type: "numrange", get: (r) => r.l.boxes },
      { key: "dispatchDate", label: "Dispatch Date Between", type: "daterange", get: (r) => r.box?.dispatchDate || "" },
    ];
  })();
  const qLower = q.trim().toLowerCase();
  // Boxes with no line rows yet (Planned / Empty) — shown as stubs on the
  // board and sheet so a fresh loading is reachable from every view.
  const stubBoxes = openBoxes.filter(isEmptyBox).filter((b) => {
    if (!qLower) return true;
    const plan = planSummary(b);
    return `${boxLabel(b)} ${plan?.sos ?? ""} ${plan?.customers ?? ""}`.toLowerCase().includes(qLower);
  });
  const searched = rows.filter(
    (r) =>
      !qLower ||
      `${r.l.itemCode} ${r.l.soNumber} ${r.l.customerName} ${r.l.designLabel} ${r.l.batchNumber} ${r.p.palNumber} ${r.box ? boxLabel(r.box) : ""}`
        .toLowerCase()
        .includes(qLower),
  );
  // A saved stage filter may still hold the old "Dispatch" label (renamed
  // "Dispatched" 2026-08-27) — normalize at read time.
  const effCriteria = useMemo(() => {
    const stage = criteria.stage;
    if (!Array.isArray(stage) || !stage.includes("Dispatch")) return criteria;
    return { ...criteria, stage: stage.map((s) => (s === "Dispatch" ? "Dispatched" : s)) };
  }, [criteria]);
  const filtered = applyFilters(searched, effCriteria, filterFields);

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

  // ---- loadings view: box-level grid state --------------------
  const BOX_COLS = useMemo(() => boxColumns(), []);
  const boxCols = useColumns("loadingBoxColumns.v2", BOX_COLS, ["containerSize", "transporter", "lrNumber", "destination", "supervisor", "age", "created"]);
  // Plain search only — the advanced-filter criteria and group dims are
  // line-shaped and would silently half-apply to box rows.
  const boxSearched = boxRows.filter(
    (r) =>
      !qLower ||
      `${boxLabel(r.box)} ${r.box.containerNumber} ${r.customers} ${r.sos} ${r.box.transporter} ${r.box.destination}`
        .toLowerCase()
        .includes(qLower),
  );
  const boxSort = useSortRows(boxSearched, boxSortVal, "created", -1);
  const boxPager = usePagination(boxSearched.length, "loadingBoxPageSize", q);

  // ---- mutations (all sequential + one refresh, house pattern) ----
  const after = (ok: boolean, err: string, msg: string) => {
    if (!ok) { toast.error(err); return; }
    toast.success(msg);
    invalidatePalPlans();
    void load();
  };

  const unload = async (line: PalPlanLine, box: LoadBox) => {
    if (busy) return;
    setBusy(true);
    const res = await setLineBox(line.id, "");
    setBusy(false);
    after(res.ok, res.error || "Could not unload the item", `${line.itemCode} back to Ready for Loading (${boxLabel(box)})`);
  };

  // "Assign Vehicle": capture vehicle + container/seal details on the Open box.
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
    after(res.ok, res.error || "Could not save loading details", t.box.status === "Open" && nowSealed ? `${boxLabel(t.box)} → Ready for Dispatch` : "Loading details saved");
  };

  // "Dispatch": confirm (warning about blank load details) + date.
  const dispatchBox = async (box: LoadBox) => {
    if (busy) return;
    const inBox = linesOfBox(box.id);
    const ok = await confirmDialog({ title: "Dispatch", message: dispatchConfirmMessage(box, inBox.length) });
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
      title: "Empty container",
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

  // Per-row container actions (Edit option) by stage.
  const menuFor = (r: Row): MenuItem[] => {
    const box = r.box;
    if (!box) return [];
    const items: MenuItem[] = [];
    if (canEdit) {
      items.push({ label: box.status === "Open" && r.stage !== "ReadyDispatch" ? "Assign Vehicle" : "Edit load details", onClick: () => setVehModal({ box }) });
    }
    if (canEdit && box.status === "Open") {
      const gate = dispatchGate(box, linesOfBox(box.id).length);
      items.push({ label: "Dispatch", disabled: !!gate, title: gate || undefined, onClick: () => void dispatchBox(box) });
    }
    if (canEdit && box.status === "Open") {
      items.push({ label: "Unload item", onClick: () => void unload(r.l, box) });
      items.push({ label: "Empty container", danger: true, onClick: () => void emptyBox(box) });
    }
    items.push({ label: "Loading details", onClick: () => navigate(`/loading/${encodeURIComponent(box.id)}`) });
    items.push({ label: "Print QR label", onClick: () => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, linesOfBox(box.id))) });
    items.push({ label: "Dispatch Copy", onClick: () => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, linesOfBox(box.id))) });
    if (canEdit && box.status === "Open") {
      items.push({ label: "Delete loading", danger: true, onClick: () => void deleteBox(box) });
    }
    return items;
  };

  // Box-scoped actions for the Loadings grid (row click opens the detail).
  const boxMenuFor = (r: BoxRow): MenuItem[] => {
    const { box } = r;
    const items: MenuItem[] = [];
    if (canEdit) {
      items.push({ label: box.status === "Open" && !sealed(box) ? "Assign Vehicle" : "Edit load details", onClick: () => setVehModal({ box }) });
    }
    if (canEdit && box.status === "Open") {
      const gate = dispatchGate(box, r.lines.length);
      items.push({ label: "Dispatch", disabled: !!gate, title: gate || undefined, onClick: () => void dispatchBox(box) });
      if (r.lines.length > 0) items.push({ label: "Empty container", danger: true, onClick: () => void emptyBox(box) });
    }
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
    return (
      <div
        key={l.id}
        onClick={() => navigate(box ? `/loading/${encodeURIComponent(box.id)}` : `/packing/${p.id}`)}
        title={box ? `Open ${boxLabel(box)}` : `Open ${p.palNumber}`}
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8, padding: 10,
          background: "var(--bg)",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="linkish mono"
            style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 600, cursor: "pointer" }}
            onClick={(ev) => { ev.stopPropagation(); navigate(box ? `/loading/${encodeURIComponent(box.id)}` : `/packing/${p.id}`); }}
            title={box ? `Open ${boxLabel(box)}` : `Open ${p.palNumber}`}
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
          {box && (
            <span onClick={(ev) => ev.stopPropagation()} style={{ flex: "0 0 auto", display: "inline-flex" }}>
              <MoreMenu kebab icon="plus" title="Loading actions" items={menuFor(r)} />
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
              <span className="chip mono" style={{ fontSize: 13 }} title="Production batch — load one batch per customer for uniform texture">
                Batch {l.batchNumber}
              </span>
            )}
            {l.palletGroup && (
              <span className="chip" style={{ fontSize: 13, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="This item shares a physical pallet with another batch/item">
                Mix Batch
              </span>
            )}
            {box && (
              <span className="chip mono" style={{ fontSize: 13 }} title={`Container · ${Math.round(fillOf(box) * 100)}% full`}>
                <Icon name="truck" size={10} /> {boxLabel(box)}
              </span>
            )}
            {box && sealed(box) && (
              <span className="chip mono" style={{ fontSize: 13 }} title="Container no. / line seal captured">
                {box.containerNumber || box.lineSeal}
              </span>
            )}
            {stage === "Dispatched" && box?.dispatchDate && (
              <span className="chip mono" style={{ fontSize: 13 }} title="Dispatch date">{box.dispatchDate}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Planned/Empty Open loadings have no line rows, so without a card they'd
  // be unreachable from the board — show them in In Loading as dashed stubs.
  const emptyBoxCard = (b: LoadBox) => {
    const plan = planSummary(b);
    return (
      <div
        key={`empty-${b.id}`}
        onClick={() => navigate(`/loading/${encodeURIComponent(b.id)}`)}
        title={`Open ${boxLabel(b)}`}
        style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 10, background: "var(--bg)", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Icon name="truck" size={12} />
          <span className="mono" style={{ fontWeight: 600 }}>{boxLabel(b)}</span>
          <span className="chip" style={{ marginLeft: "auto", fontSize: 13 }}>{plan ? "Planned" : "Empty"}</span>
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {plan
            ? [plan.customers, plan.sos, `${fmt(plan.boxes)} bx planned`].filter(Boolean).join("  ·  ")
            : "No items yet — open to add items"}
        </div>
      </div>
    );
  };

  // ---- kanban: stage columns + nested swimlanes ---------------
  // ponytail: on the grouped board the stubs render once in a strip above the
  // lanes (renderLevel) — inside group lanes they'd duplicate per lane.
  const stageGrid = (laneRows: Row[], showEmpties = false) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(230px, 1fr))`, gap: 12, alignItems: "start", overflowX: "auto" }}>
      {STAGES.map((col) => {
        const cards = laneRows.filter((r) => r.stage === col.key);
        const totalBoxes = cards.reduce((s, r) => s + r.l.boxes, 0);
        const empties = showEmpties && col.key === "InLoading" ? stubBoxes : [];
        return (
          <div key={col.key} className="card" style={{ padding: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
              <span className={`chip palstatus ${col.chip}`}>{col.label}</span>
              <span className="muted mono" style={{ fontSize: 14, marginLeft: "auto" }} title={`${fmt(totalBoxes)} boxes`}>
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
        {depth === 0 && stubBoxes.length > 0 && (
          <div className="form-section">
            <div className="form-section-title">
              <span style={{ flex: 1 }}>Planned / empty loadings</span>
              <span className="muted" style={{ fontSize: 14, fontWeight: 400, letterSpacing: 0 }}>{stubBoxes.length}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
              {stubBoxes.map(emptyBoxCard)}
            </div>
          </div>
        )}
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
              {renderLevel(sub, dims.slice(1), depth + 1)}
            </div>
          ))}
      </div>
    );
  };

  // ---- render -------------------------------------------------
  const viewBtn = (v: "workspace" | "kanban" | "sheet" | "loadings" | "customer", icon: "package" | "kanban" | "orders" | "truck" | "user", label: string) => (
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
      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar" style={{ marginBottom: 12 }}>
        {view !== "customer" && view !== "workspace" && (
          <span className="gsearch">
            <Icon name="search" size={13} />
            <input type="text" placeholder="Search item, SO, customer, batch, container…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        )}
        <div style={{ flex: 1 }} />
        {view === "sheet" && <AdvancedFilterButton title="Loading" fields={filterFields} criteria={criteria} onChange={setCriteria} />}
        <span data-tour="load-view-toggle" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="Board view" title="Switch view">
          {viewBtn("workspace", "package", "Workspace")}
          {viewBtn("sheet", "orders", "Sheet")}
          {viewBtn("loadings", "truck", "Loadings")}
          {viewBtn("customer", "user", "Customer Sheet")}
        </span>
        {view === "sheet" && (
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
        )}
        {view === "sheet" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />}
        {view === "loadings" && <ColumnPicker columns={boxCols.ordered} hidden={boxCols.hidden} onToggle={boxCols.toggle} onMove={boxCols.move} />}
        {canEdit && (
          <button className="hbtn primary" data-tour="load-new" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={flow.busy} onClick={() => setNewOpen(true)}>
            <Icon name="plus" size={13} />
            New Loading
          </button>
        )}
      </div>

      {loading && plans.length === 0 ? (
        <div className="card"><SkeletonRows rows={6} /></div>
      ) : view === "workspace" ? (
        // SO-centric workspace — owns its own customer/SO pickers.
        <LoadingWorkspace plans={plans} boxes={boxes} sheetRows={rows} canEdit={canEdit} onChanged={() => void load()} />
      ) : view === "customer" ? (
        // The sheet owns its own customer filter — global search/filters skipped.
        <LoadingCustomerSheet rows={rows} canEdit={canEdit} onSaved={() => void load()} />
      ) : view === "loadings" ? (
        <div className="card" style={{ minHeight: "calc(100vh - 172px)" }}>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  {boxCols.visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={boxSort} style={c.style} />
                  ))}
                  <th style={{ width: 36 }} aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {boxPager.slice(boxSort.sorted).map((r) => (
                  <tr
                    key={r.box.id}
                    onClick={() => navigate(`/loading/${encodeURIComponent(r.box.id)}`)}
                    title={`Open ${boxLabel(r.box)}`}
                    style={{ cursor: "pointer" }}
                  >
                    {boxCols.visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(r)}
                      </td>
                    ))}
                    <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                      <MoreMenu kebab icon="plus" title="Loading actions" items={boxMenuFor(r)} />
                    </td>
                  </tr>
                ))}
                {!loading && boxSearched.length === 0 && (
                  <tr>
                    <td colSpan={boxCols.visible.length + 1}>
                      <EmptyState title="No loadings yet" hint="New Loading creates the first container" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GridFooter {...boxPager} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(() => {
            const rows = sheetRows;
            return (
          <div className="card" style={{ minHeight: "calc(100vh - 172px)" }}>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                  {canEdit && <th style={{ width: 50 }} aria-label="Action" />}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const out: ReactNode[] = [];
                  const span = visible.length + (canEdit ? 1 : 0);
                  // Planned/Empty loadings first — no line rows yet, one
                  // summary row per box (click opens the loading).
                  for (const b of stubBoxes) {
                    const plan = planSummary(b);
                    out.push(
                      <tr
                        key={`box-${b.id}`}
                        onClick={() => navigate(`/loading/${encodeURIComponent(b.id)}`)}
                        title={`Open ${boxLabel(b)}`}
                        style={{ cursor: "pointer" }}
                      >
                        <td className="mono nw" style={{ fontWeight: 600 }}>
                          <Icon name="truck" size={12} /> {boxLabel(b)}
                        </td>
                        <td colSpan={span - 1}>
                          <span className={`chip palstatus ${BOX_STATUS_CHIP[plan ? "Planned" : "Empty"]}`} style={{ whiteSpace: "nowrap" }}>{plan ? "Planned" : "Empty"}</span>
                          <span className="dim" style={{ fontSize: "var(--t-sm)", marginLeft: 10 }}>
                            {plan
                              ? [plan.customers, plan.sos, `${fmt(plan.boxes)} bx planned`].filter(Boolean).join("  ·  ")
                              : "No items yet — open to add items"}
                          </span>
                        </td>
                      </tr>,
                    );
                  }
                  let prevKey: string | null = null;
                  for (const r of rows) {
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
                    out.push(
                      <tr
                        key={l.id}
                        onClick={() => navigate(box ? `/loading/${encodeURIComponent(box.id)}` : `/packing/${p.id}`)}
                        title={box ? `Open ${boxLabel(box)}` : `Open ${p.palNumber}`}
                        style={{ cursor: "pointer" }}
                      >
                        {/* Grouped rows indent their first cell under the customer band. */}
                        {visible.map((c, ci) => (
                          <td key={c.key} className={c.className} style={ci === 0 && groupBy.length ? { ...c.style, paddingLeft: 26 } : c.style}>
                            {c.render!(r)}
                          </td>
                        ))}
                        {canEdit && (
                          <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                            {box && <span style={{ display: "inline-flex", verticalAlign: "middle" }}><MoreMenu kebab icon="plus" title="Loading actions" items={menuFor(r)} /></span>}
                          </td>
                        )}
                      </tr>,
                    );
                  }
                  if (!loading && out.length === 0) {
                    out.push(
                      <tr key="empty">
                        <td colSpan={span} className="dim" style={{ fontSize: "var(--t-sm)" }}>—</td>
                      </tr>,
                    );
                  }
                  return out;
                })()}
              </tbody>
            </table>
          </div>
          </div>
            );
          })()}
          {!loading && filtered.length === 0 && stubBoxes.length === 0 && <EmptyState title="No matching results" hint="Try a different filter" />}
          {!(loading && plans.length === 0) && <GridFooter {...pager} />}
        </div>
      )}

      {newOpen && <NewLoadingModal onDone={() => void load()} onClose={() => setNewOpen(false)} />}

      {vehModal && (
        <VehicleLoadModal
          palNumber={boxLabel(vehModal.box)}
          title={vehModal.box.status === "Open" && !sealed(vehModal.box) ? "Assign Vehicle" : "Edit Load Details"}
          busy={busy}
          initialVehicleId={vehModal.box.vehicleId}
          initialCapture={{
            container_number: vehModal.box.containerNumber,
            line_seal: vehModal.box.lineSeal,
            electronic_seal: vehModal.box.electronicSeal,
            loading_supervisor: vehModal.box.loadingSupervisor,
            container_size: vehModal.box.containerSize,
            transporter: vehModal.box.transporter,
            lr_number: vehModal.box.lrNumber,
            destination: vehModal.box.destination,
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
