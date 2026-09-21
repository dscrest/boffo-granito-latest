/* ============================================================
   Dispatch Control Board — the /packing board view (replaces PalKanban).
   Full-width stage board: 3 columns of PalletizationPlanLines — Ready for
   Palletization → In Palletization → Ready for Loading. Two-step flow
   (2026-09-04, reverses the 2026-08-27 one-hop): Palletise moves a line to
   In Palletization (pallet confirmed in PalletiseModal); "Mark Palletized"
   then moves it to Ready for Loading. Ready-for-Loading cards carry the
   Load button (useLoadFlow + LoadContainerModal) — loading starts HERE;
   /loading holds only boxed lines onward. Kanban/Sheet is chosen by the
   page-header toggle in PalPlans and arrives as the `view` prop.
   Ready-for-Palletization and Ready-for-Loading cards carry a record-level
   checkbox — the selection palletises / loads together.
   Lines allocated to a load box (and legacy Completed plans) leave this
   board entirely — they live on the Loading and Dispatch page (/loading).
   ============================================================ */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { NumberInput } from "@/ui/NumberInput";
import { Combobox } from "@/ui/Combobox";
import { fmt } from "@/lib/format";
import { type ContainerPlan } from "@/data";
import { isoInfo } from "@/features/masters/customersApi";
import {
  invalidatePalPlans,
  lineFrac,
  loadableLineIds,
  oiProgressOf,
  PAL_LINE_STATUS_LABEL,
  palLineStatusLabel,
  palletsOf,
  palTopUp,
  setPalLineStatus,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
  type PalLineStatus,
} from "./palPlansApi";
import { MoreMenu } from "@/features/common/DetailBits";
import { codeOf } from "@/ui/statusCode";
import { TotalsRow } from "@/features/reports/ReportShell";
import { hasOps, resolvePalSheetEdit, type PalSheetDraft, type PalSheetOps } from "./palSheetEdit";
import { useContainerPlanBySo } from "./containerPlanPrefill";
import { PalletiseModal, type PalletiseEntry } from "./PalletiseModal";
import { TopUpModal } from "./TopUpModal";
import { LoadContainerModal } from "./LoadContainerModal";
import { useLoadFlow } from "./useLoadFlow";

// Board columns — all hold ITEM cards (a PalPlanLine each). Exported so
// PalPlans' Sections picker builds its defs from the same list.
export const COLUMNS = [
  { key: "Planning", label: "Ready for Palletization", chip: "p-planning" },
  { key: "Palletizing", label: "In Palletization", chip: "p-palletized" },
  { key: "Ready", label: "Ready for Loading", chip: "p-ready" },
  // Read-only: in a container or dispatched. Only ever filled by showAll.
  { key: "Done", label: "Loaded / Completed", chip: "p-completed" },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

type Entry = { p: PalPlan; l: PalPlanLine };
type Drag = { lineIds: string[]; from: "Planning" | "Palletizing" | "Ready" } | null;

// Swimlane dimensions for the group-by picker (rendered in PalPlans' toolbar,
// same mechanism as Production). Ordered multi-select → nested lanes.
export type DispatchGroupBy = "customer" | "so" | "batch" | "item" | "status";
export const DISPATCH_GROUP_DIMS: Array<{ id: DispatchGroupBy; label: string }> = [
  { id: "customer", label: "Customer" },
  { id: "so", label: "Order" },
  { id: "batch", label: "Batch" },
  { id: "item", label: "Item" },
  { id: "status", label: "Status" },
];

/** Board stage of one line — shared with the PalPlans status counts. */
export const lineStage = (l: PalPlanLine, loadable: Set<string>): (typeof COLUMNS)[number]["key"] => {
  if (l.status === "ReadyToLoad") return loadable.has(l.id) ? "Ready" : "Palletizing";
  return l.status === "Palletizing" ? "Palletizing" : "Planning";
};

export function DispatchBoard({
  plans,
  allPlans = plans,
  boxes,
  view,
  canEdit,
  groupBy,
  visibleStages,
  showAll = false,
  onChanged,
}: {
  plans: PalPlan[];
  allPlans?: PalPlan[]; // UNFILTERED plans — the gates below need every line (palLoadGate contract)
  boxes: LoadBox[];
  view: "kanban" | "sheet";
  canEdit: boolean;
  groupBy: DispatchGroupBy[];
  visibleStages?: string[]; // ordered stage keys from the Sections picker; empty/undefined = all
  showAll?: boolean; // "All" status filter: every stage + boxed/dispatched lines, read-only
  onChanged: () => void;
}) {
  // Stage sections the board renders (kanban lanes + sheet rows + footer chips).
  // All-hidden falls back to all-visible so the board can never render blank.
  const picked = (visibleStages ?? [])
    .map((k) => COLUMNS.find((c) => c.key === k))
    .filter((c): c is (typeof COLUMNS)[number] => !!c);
  const cols = showAll ? [...COLUMNS] : picked.length ? picked : COLUMNS.filter((c) => c.key !== "Done");
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
  // In-Palletization line whose open pallet is being topped up (Mix Batch).
  const [topUp, setTopUp] = useState<PalPlanLine | null>(null);
  // Sheet edit mode: staged qty/donor per line, committed on Save (mirrors
  // the Production sheet edit — nothing is written until Save).
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Record<string, PalSheetDraft>>({});
  const [savingEdits, setSavingEdits] = useState(false);

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
  // showAll lists them too, as read-only "Done" rows.
  const isDone = (p: PalPlan, l: PalPlanLine) => !!l.loadBoxId || p.status === "Completed";
  const allLines: Entry[] = plans.flatMap((p) => p.lines.map((l) => ({ p, l }))).filter(({ p, l }) => showAll || !isDone(p, l));
  const boxStatusById = new Map(boxes.map((b) => [b.id, b.status]));
  // Partial-palletise progress across ALL lines (boxed + Completed included,
  // or split siblings would deflate the totals).
  const oiProgress = oiProgressOf(allPlans.flatMap((p) => p.lines));
  // Loading pool: every un-boxed ReadyToLoad line — a partly palletized batch's
  // palletized slice is Ready for Loading too (CR-248 reversed CR-151's gate).
  const loadable = loadableLineIds(allPlans.flatMap((p) => p.lines));
  // Age = days since the LINE was created (auto-enqueue creates it right after
  // production; plans are reused per SO so the plan date is the wrong anchor).
  // Catalyst stamps "YYYY-MM-DD HH:mm:ss:SSS" — colon before the millis breaks
  // Date.parse, so cut to seconds first.
  const ageDays = (p: PalPlan, l: PalPlanLine) => {
    const t = Date.parse((l.createdTime || p.createdTime || "").slice(0, 19).replace(" ", "T"));
    return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : 0;
  };
  const stageOf = (p: PalPlan, l: PalPlanLine): ColKey => (isDone(p, l) ? "Done" : lineStage(l, loadable));

  // Sheet columns (grid standard, CR-161): data-driven, show/hide + reorder
  // via the ColumnPicker. Customer then Item lead; the PAL line code sits
  // LAST and is hideable. The checkbox, edit-mode inputs and the "+" menu
  // stay fixed outside the picker.
  const SHEET_COLS = useMemo<ColumnDef<Entry>[]>(
    () => [
      {
        key: "customer",
        label: "Customer",
        className: "nw",
        render: ({ l }) => <span className="clip" style={{ maxWidth: 180 }} title={l.customerName}>{l.customerName || "—"}</span>,
      },
      {
        key: "item",
        label: "Item",
        className: "nw",
        render: ({ l }) => <span className="clip" style={{ maxWidth: 260 }} title={l.designLabel}>{l.designLabel}</span>,
      },
      { key: "so", label: "Order", className: "mono nw", render: ({ l }) => l.soNumber || "—" },
      {
        key: "batch",
        label: "Batch",
        className: "mono nw",
        style: { fontSize: "var(--t-sm)" },
        render: ({ l }) => {
          const prog = oiProgress.get(l.orderItemId);
          // CR-176: per-ROW chip. A recorded slice held back by the batch gate
          // reads "Recorded"; only the not-yet-recorded rows read "Partial"
          // (same rule as PalPlanDetail's status column).
          const done = l.status === "ReadyToLoad" || !!l.loadBoxId;
          const partialItem = !!prog && prog.done > 0 && prog.done < prog.total;
          return (
            <>
              {l.batchNumber || "—"}
              {l.palletGroup && (
                <span className="chip" style={{ fontSize: 13, marginLeft: 6, color: "var(--c-amber)", borderColor: "var(--c-amber)" }} title="Shares a physical pallet with another batch/item">
                  Mix Batch
                </span>
              )}
              {partialItem && done && (
                <span className="chip palstatus p-ready" style={{ fontSize: 13, marginLeft: 6, whiteSpace: "nowrap" }} title="Palletized — waiting for the rest of this batch before loading">
                  Recorded
                </span>
              )}
              {partialItem && !done && (
                <span className="chip palstatus p-palletized" style={{ fontSize: 13, marginLeft: 6, whiteSpace: "nowrap" }} title="Still to be palletized — Complete Palletization records it">
                  Partial
                </span>
              )}
            </>
          );
        },
      },
      { key: "boxes", label: "Boxes", className: "num mono", style: { textAlign: "right" }, render: ({ l }) => fmt(l.boxes) },
      {
        key: "ordered",
        label: "Ordered",
        className: "num mono",
        style: { textAlign: "right" },
        render: ({ l }) => fmt(oiProgress.get(l.orderItemId)?.total ?? 0),
      },
      {
        key: "completed",
        label: "Completed",
        className: "num mono",
        style: { textAlign: "right" },
        render: ({ l }) => {
          const done = oiProgress.get(l.orderItemId)?.done ?? 0;
          return done ? <span style={{ color: "var(--c-green)" }}>{fmt(done)}</span> : <span className="dim">—</span>;
        },
      },
      {
        key: "remaining",
        label: "Remaining",
        className: "num mono",
        style: { textAlign: "right" },
        render: ({ l }) => {
          const prog = oiProgress.get(l.orderItemId);
          return fmt(Math.max(0, (prog?.total ?? 0) - (prog?.done ?? 0)));
        },
      },
      {
        key: "status",
        label: "Status",
        className: "nw",
        render: ({ p, l }) => {
          const label = palLineStatusLabel(l, boxStatusById.get(l.loadBoxId), p.status);
          return <span className="chip" title={label}>{codeOf(label)}</span>;
        },
      },
      { key: "age", label: "Age", className: "dim nw", render: ({ p, l }) => `${ageDays(p, l)}d` },
      { key: "pal", label: "PAL", className: "mono nw", style: { fontWeight: 600 }, render: ({ l }) => l.itemCode },
    ],
    // oiProgress/ageDays are re-derived from plans each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plans],
  );
  const sheetCols = useColumns("packingSheetColumns", SHEET_COLS);

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
    setBusy(false);
    // Batch failure mid-way: report + refresh anyway so the board resyncs.
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} moved to ${PAL_LINE_STATUS_LABEL[to]}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  // Palletise-dialog confirm: every target moves to `to` with its pallet in
  // one call (`to` = Palletizing from the Palletise button, ReadyToLoad from
  // Record Palletised / "+" / pallet-less drop on Ready — a line never
  // reaches Ready for Loading without a pallet on record). A partial qty
  // splits the line server-side; the remainder stays in its stage.
  const confirmPalletise = async (entries: PalletiseEntry[]) => {
    if (busy || entries.length === 0 || !palletise) return;
    const to = palletise.to;
    setBusy(true);
    let ok = 0, err = "";
    for (const e of entries) {
      const res = await setPalLineStatus(e.lineId, to, e.palletId, e.boxes);
      if (res.ok) ok++; else err = res.error || "Move failed";
    }
    // No auto-print here: slips print on demand (line/detail buttons) after
    // the user verifies the palletisation.
    setBusy(false);
    setPalletise(null);
    setSelected(new Set());
    after(!err, err, `${ok} item${ok === 1 ? "" : "s"} moved to ${PAL_LINE_STATUS_LABEL[to]}`);
    if (err && ok > 0) { invalidatePalPlans(); onChanged(); }
  };

  // Same-item queue lines that can top up an In-Palletization pallet
  // (usually another batch — that's the Mix Batch flow).
  const topUpDonors = (l: PalPlanLine) =>
    allLines
      .filter(({ l: d }) => d.status === "Planning" && !!l.designId && d.designId === l.designId && d.id !== l.id)
      .map(({ l: d }) => d);

  const confirmTopUp = async (donorLineId: string, boxes: number) => {
    if (busy || !topUp) return;
    setBusy(true);
    const res = await palTopUp(topUp.id, donorLineId, boxes);
    setBusy(false);
    setTopUp(null);
    after(res.ok, res.ok ? "" : res.error || "Top up failed", `Topped up with ${fmt(boxes)} boxes — Mix Batch pallet`);
  };

  // ---- sheet edit mode ----------------------------------------
  const setCell = (id: string, k: keyof PalSheetDraft, v: string) =>
    setDraft((m) => ({ ...m, [id]: { ...m[id], [k]: v } }));

  // Resolve every drafted row once: what Save must do, and whether anything is
  // invalid (a bad row disables Save rather than firing a doomed request).
  const editRows: Array<{ l: PalPlanLine; ops: PalSheetOps }> = [];
  let editBad = false;
  if (editMode) {
    for (const { l } of allLines) {
      if (!draft[l.id]) continue;
      const { ops, error } = resolvePalSheetEdit(l, topUpDonors(l), draft[l.id]);
      if (error) editBad = true;
      else if (hasOps(ops)) editRows.push({ l, ops });
    }
  }
  const editDirty = editRows.length > 0 || editBad;

  const leaveEdit = async () => {
    if (editDirty && !(await confirmDialog({ message: "Discard unsaved changes?", danger: true }))) return;
    setDraft({});
    setEditMode(false);
  };

  // ponytail: the Kanban/Sheet toggle lives in PalPlans, so leaving the sheet
  // drops staged edits silently — lift an onBeforeViewChange if that bites.
  useEffect(() => {
    if (view !== "sheet") { setDraft({}); setEditMode(false); }
  }, [view]);

  // Record = the exact call confirmPalletise makes: a partial qty splits
  // the line server-side, the remainder stays in its stage. Per-row only —
  // a Mix Batch row does NOT pull its pallet_group siblings here (the +
  // menu's Complete still records the whole physical pallet together).
  // Two-step: a Ready-for-Palletization row records INTO In Palletization;
  // only an In-Palletization row completes to Ready for Loading.
  const commitRow = (l: PalPlanLine, ops: PalSheetOps) =>
    ops.record
      ? setPalLineStatus(l.id, l.status === "Planning" ? "Palletizing" : "ReadyToLoad", l.palletId, ops.record.boxes)
      : palTopUp(l.id, ops.topUp!.donorId, ops.topUp!.boxes);

  // Per-row ✓ (CR-169): commit ONE row, keep edit mode + the other drafts.
  const saveRow = async (l: PalPlanLine) => {
    const row = editRows.find((r) => r.l.id === l.id);
    if (!row || savingEdits) return;
    setSavingEdits(true);
    const res = await commitRow(l, row.ops);
    setSavingEdits(false);
    if (!res.ok) { toast.error(`${l.itemCode}: ${res.error || "Save failed"}`); return; }
    dropDraft(l.id);
    toast.success(`${l.itemCode} saved`);
    invalidatePalPlans();
    onChanged();
  };
  const dropDraft = (id: string) =>
    setDraft((m) => { const { [id]: _gone, ...rest } = m; return rest; });

  const saveEdits = async () => {
    if (!editRows.length || editBad || savingEdits) return;
    setSavingEdits(true);
    const failed: Record<string, PalSheetDraft> = {};
    let done = 0;
    // ponytail: sequential + non-atomic, one request per row (house pattern —
    // same as the Production sheet and confirmPalletise's loop).
    for (const { l, ops } of editRows) {
      const res = await commitRow(l, ops);
      if (res.ok) done += 1;
      else {
        failed[l.id] = draft[l.id];
        toast.error(`${l.itemCode}: ${res.error || "Save failed"}`);
      }
    }
    setSavingEdits(false);
    setDraft(failed);
    if (done) toast.success(`${done} line${done === 1 ? "" : "s"} saved`);
    if (!Object.keys(failed).length) setEditMode(false);
    invalidatePalPlans();
    onChanged();
  };

  // ---- drag & drop --------------------------------------------
  const clearDnd = () => { setDrag(null); setOverCol(null); };

  const onDropColumn = (colKey: ColKey) => {
    const d = drag;
    clearDnd();
    if (!d || colKey === "Done") return;
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
    : d === "status" ? palLineStatusLabel(e.l, boxStatusById.get(e.l.loadBoxId), e.p.status) // same label as the Status column
    : e.l.designLabel || "—";
  const groupKeyOf = (e: Entry) => groupBy.map((d) => laneKeyOf(e, d)).join("  ›  ");
  // Sheet rows: stage sections first, group bands nested inside, then pallet
  // code. Hidden sections drop their rows here too — one consistent setting.
  const stageIdx = new Map(cols.map((c, i) => [c.key, i]));
  const sheetRows = visible.filter((e) => stageIdx.has(stageOf(e.p, e.l))).sort((a, b) => {
    const d = (stageIdx.get(stageOf(a.p, a.l)) ?? 0) - (stageIdx.get(stageOf(b.p, b.l)) ?? 0);
    if (d !== 0) return d;
    if (groupBy.length) {
      const g = groupKeyOf(a).localeCompare(groupKeyOf(b));
      if (g !== 0) return g;
    }
    return a.l.itemCode.localeCompare(b.l.itemCode, undefined, { numeric: true });
  });
  // Sheet column count — band/empty rows span it: checkbox + visible defs
  // (+ Palletise + Top Up From + ✓/✗ in edit mode) + the "+" menu cell.
  const nCols = 1 + sheetCols.visible.length + (editMode ? 3 : 0) + 1;
  // Grand totals over what's on screen (CR-171).
  const sheetLines = sheetRows.map(({ l }) => l);
  const totalBoxes = sheetLines.reduce((s, l) => s + l.boxes, 0);
  const totalPallets = palletsOf(sheetLines);
  // Ordered/Completed are per order item and several rows can share one —
  // dedupe before summing (CR-187 footer).
  const oiIds = [...new Set(sheetLines.map((l) => l.orderItemId))];
  const totalOrdered = oiIds.reduce((s, id) => s + (oiProgress.get(id)?.total ?? 0), 0);
  const totalCompleted = oiIds.reduce((s, id) => s + (oiProgress.get(id)?.done ?? 0), 0);
  const totalRemaining = Math.max(0, totalOrdered - totalCompleted);

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
  // Record Palletised acts on the whole PHYSICAL pallet: a topped-up
  // (pallet_group) line brings its group siblings into the dialog, so the
  // mixed pallet is recorded together (one combined slip when printed).
  const recordTargets = (l: PalPlanLine) =>
    l.palletGroup
      ? allLines.filter(({ l: d }) => d.status === "Palletizing" && d.palletGroup === l.palletGroup).map(({ l: d }) => d)
      : [l];

  // The one "+" menu on every card & row (CR-168: Ready rows too — their loose
  // Load button folded in). Planning / In-Palletization list all three
  // palletisation options, inapplicable ones greyed out; Complete on a
  // Planning line is the skip-a-stage shortcut (dialog still forces a pallet).
  const plusMenuItems = (l: PalPlanLine, stage: ColKey) => stage === "Ready" ? [
    {
      label: `Load${loadTargets(l).length > 1 ? ` (${loadTargets(l).length})` : ""}`,
      disabled: flow.busy,
      title: loadTargets(l).length > 1 ? `Load the ${loadTargets(l).length} selected items into a container` : "Load into a container",
      onClick: () => flow.setPicker({ lineIds: loadTargets(l) }),
    },
  ] : [
    {
      label: `Start Palletization${stage === "Planning" && palletiseTargets(l).length > 1 ? ` (${palletiseTargets(l).length})` : ""}`,
      disabled: stage !== "Planning",
      title: stage !== "Planning" ? "Already in palletization" : "Moves to In Palletization",
      onClick: () => openPalletise(palletiseTargets(l), "Palletizing"),
    },
    {
      label: "Top Up Batch",
      disabled: stage !== "Palletizing" || !l.palletId || topUpDonors(l).length === 0,
      title: stage !== "Palletizing"
        ? "Start palletization first"
        : !l.palletId || topUpDonors(l).length === 0
          ? "No same-design batch waiting to top up from"
          : "Top up this pallet from another batch of the same design (Mix Batch)",
      onClick: () => setTopUp(l),
    },
    {
      label: "Complete Palletization",
      // A ReadyToLoad slice held back by the batch gate is already recorded —
      // it moves on when the rest of its batch is palletised.
      disabled: l.status === "ReadyToLoad",
      title: l.status === "ReadyToLoad"
        ? "Recorded — waiting for the rest of this batch to be palletized"
        : "Record palletized boxes — they move to Ready for Loading",
      onClick: () => openPalletise(stage === "Palletizing" ? recordTargets(l) : palletiseTargets(l), "ReadyToLoad"),
    },
  ];

  // ---- item card ----------------------------------------------
  const itemCard = (p: PalPlan, l: PalPlanLine, stage: ColKey) => {
    const isSel = selected.has(l.id);
    const canDrag = canEdit && stage !== "Done";
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
              title={stage === "Planning" ? "Select to palletize together" : "Select to load together"}
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
        {canEdit && stage !== "Done" && (
          // MoreMenu doesn't stop propagation and the card is draggable +
          // click-navigates, so the wrapper span eats the events.
          <span
            style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); }}
          >
            <MoreMenu kebab icon="plus" title={stage === "Ready" ? "Loading actions" : "Palletization actions"} items={plusMenuItems(l, stage)} />
          </span>
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
          ? { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(210px, 1fr))`, gap: 10, padding: 10, overflowX: "auto" }
          : { display: "grid", gridTemplateColumns: `repeat(${cols.length}, minmax(210px, 1fr))`, gap: 10, alignItems: "start", overflowX: "auto" }
      }
    >
      {cols.map((col) => {
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
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, flex: "0 0 auto" }}>
              {anyFilter && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setQ(""); setFCustomer(""); setFCountry(""); setFDesign(""); setFSize(""); }}
                >
                  Clear filters
                </button>
              )}
              {view === "sheet" && (
                <ColumnPicker columns={sheetCols.ordered} hidden={sheetCols.hidden} onToggle={sheetCols.toggle} onMove={sheetCols.move} active={sheetCols.customised} />
              )}
              {/* Sheet edit mode: Palletise qty + Top Up donor go editable across
                  every row; nothing is written until Save. */}
              {view === "sheet" && canEdit && (
                editMode ? (
                  <>
                    <button className="hbtn" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={savingEdits} onClick={() => void leaveEdit()}>
                      Cancel
                    </button>
                    <button
                      className="hbtn primary"
                      style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
                      disabled={!editRows.length || editBad || savingEdits}
                      onClick={() => void saveEdits()}
                      title={editBad ? "Fix the highlighted cells first" : "Save every edited line"}
                    >
                      {savingEdits ? "Saving…" : `Save${editRows.length ? ` (${editRows.length})` : ""}`}
                    </button>
                  </>
                ) : (
                  <button
                    className="hbtn"
                    style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
                    onClick={() => setEditMode(true)}
                    title="Record palletized boxes or a batch top-up across rows, then Save"
                  >
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )
              )}
            </div>
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
                    <th style={{ width: 34 }} aria-label="Select" />
                    {sheetCols.visible.map((c) => (
                      <th key={c.key} className={c.className?.includes("num") ? "num" : undefined} style={c.style}
                          title={c.key === "ordered" ? "Total boxes sent to palletization for this order item" : c.key === "completed" ? "Boxes palletized (Ready or loaded)" : undefined}>
                        {c.label}
                      </th>
                    ))}
                    {editMode && <th className="num" style={{ textAlign: "right" }}>Palletize</th>}
                    {editMode && <th>Top Up From</th>}
                    {editMode && <th aria-label="Save or discard row" />}
                    <th aria-label="Action" />
                  </tr>
                </thead>
                <tbody>
                  {/* ponytail: band rows duplicated across the boards (see ProductionTable) —
                      grouping keys differ per board, a shared helper would outweigh them.
                      CR-171: no stage band — each page is one stage; totals sit in the footer. */}
                  {sheetRows.map(({ p, l }, i) => {
                    const stage = stageOf(p, l);
                    const isSel = selected.has(l.id);
                    const key = groupBy.length ? groupKeyOf({ p, l }) : "";
                    const band =
                      groupBy.length && (i === 0 || groupKeyOf(sheetRows[i - 1]) !== key) ? (
                        <tr key={`h-${stage}-${key}`} style={{ background: "var(--accent-soft)", fontWeight: 700, color: "var(--accent-ink)" }}>
                          <td colSpan={nCols} style={{ paddingLeft: 20 }}>
                            {key}
                            <span className="mono" style={{ fontWeight: 400, marginLeft: 10 }}>
                              {(() => {
                                const sub = sheetRows.filter((e) => groupKeyOf(e) === key);
                                return `${sub.length} item${sub.length === 1 ? "" : "s"} · ${fmt(sub.reduce((s, e) => s + e.l.boxes, 0))} bx`;
                              })()}
                            </span>
                          </td>
                        </tr>
                      ) : null;
                    return (
                      <Fragment key={l.id}>
                      {band}
                      <tr
                        key={l.id}
                        onClick={() => navigate(`/packing/${p.id}`)}
                        title={`Open ${p.palNumber}`}
                        style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : undefined }}
                      >
                        <td style={{ textAlign: "center" }} onClick={(ev) => ev.stopPropagation()}>
                          {canEdit && (stage === "Planning" || stage === "Ready") && (
                            <input
                              type="checkbox"
                              checked={isSel}
                              onChange={() => toggleSelect(l)}
                              title={stage === "Planning" ? "Select to palletize together" : "Select to load together"}
                              style={{ margin: 0 }}
                            />
                          )}
                        </td>
                        {sheetCols.visible.map((c) => (
                          <td key={c.key} className={c.className} style={c.style}>
                            {c.render!({ p, l })}
                          </td>
                        ))}
                        {editMode && (() => {
                          const d = draft[l.id];
                          const donors = topUpDonors(l);
                          const rowErr = d ? resolvePalSheetEdit(l, donors, d).error : null;
                          const bad = rowErr ? { borderColor: "var(--c-red)" } : undefined;
                          const topUpOk = l.status === "Palletizing" && !!l.palletId && donors.length > 0;
                          return (
                            <>
                              <td className="num" style={{ textAlign: "right" }} onClick={(ev) => ev.stopPropagation()}>
                                {l.status === "ReadyToLoad" ? (
                                  <span className="dim" title="Recorded — waiting for the rest of this batch to be palletized">—</span>
                                ) : (
                                  <NumberInput
                                    value={d?.qty ?? ""}
                                    placeholder="0"
                                    onChange={(ev) => setCell(l.id, "qty", ev.target.value)}
                                    style={{ width: 90, textAlign: "right", ...bad }}
                                    title={rowErr || (d?.donorId ? `Boxes moved from the picked batch onto this pallet` : `Boxes palletized now — less than ${fmt(l.boxes)} splits the line`)}
                                  />
                                )}
                              </td>
                              <td onClick={(ev) => ev.stopPropagation()} style={{ minWidth: 160 }}>
                                {topUpOk ? (
                                  <Combobox
                                    value={d?.donorId ?? ""}
                                    onChange={(v) => setCell(l.id, "donorId", v)}
                                    placeholder="Same-design batch…"
                                    ariaLabel="Top up from batch"
                                    options={donors.map((x) => ({
                                      value: x.id,
                                      label: x.batchNumber ? `Batch ${x.batchNumber}` : x.itemCode,
                                      hint: `${fmt(x.boxes)} bx · ${x.itemCode}`,
                                    }))}
                                  />
                                ) : (
                                  <span className="dim" title="Top-up needs an In-Palletization line with a same-design batch waiting">—</span>
                                )}
                              </td>
                              {/* Per-row ✓ / ✗ (CR-169) — visible once the row has a draft. */}
                              <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                                {d && (
                                  <span style={{ display: "inline-flex", gap: 4 }}>
                                    <button
                                      type="button"
                                      className="hbtn primary"
                                      style={{ height: 24, width: 26, padding: 0, borderRadius: 5, justifyContent: "center" }}
                                      disabled={savingEdits || !!rowErr || !editRows.some((r) => r.l.id === l.id)}
                                      title={rowErr || "Save this row"}
                                      aria-label="Save this row"
                                      onClick={() => void saveRow(l)}
                                    >
                                      <Icon name="check" size={13} />
                                    </button>
                                    <button
                                      type="button"
                                      className="hbtn"
                                      style={{ height: 24, width: 26, padding: 0, borderRadius: 5, justifyContent: "center" }}
                                      disabled={savingEdits}
                                      title="Discard this row's edits"
                                      aria-label="Discard this row's edits"
                                      onClick={() => dropDraft(l.id)}
                                    >
                                      <Icon name="x" size={13} />
                                    </button>
                                  </span>
                                )}
                              </td>
                            </>
                          );
                        })()}
                        <td style={{ whiteSpace: "nowrap" }} onClick={(ev) => ev.stopPropagation()}>
                          {canEdit && stage !== "Done" && (
                            <MoreMenu kebab icon="plus" title={stage === "Ready" ? "Loading actions" : "Palletization actions"} items={plusMenuItems(l, stage)} />
                          )}
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                  {sheetRows.length === 0 && (
                    <tr><td colSpan={nCols} className="dim" style={{ textAlign: "center", padding: 24 }}>Nothing here</td></tr>
                  )}
                </tbody>
                {sheetRows.length > 0 && (
                  // CR-187: totals under their own columns (same shape as /loading's footer).
                  <TotalsRow>
                    <td />
                    {sheetCols.visible.map((c, ci) => (
                      <td key={c.key} className={c.className?.includes("num") ? "num mono" : undefined} style={c.style}>
                        {ci === 0
                          ? `Total · ${fmt(totalPallets)} pallet${totalPallets === 1 ? "" : "s"}`
                          : c.key === "boxes" ? fmt(totalBoxes)
                          : c.key === "ordered" ? fmt(totalOrdered)
                          : c.key === "completed" ? fmt(totalCompleted)
                          : c.key === "remaining" ? fmt(totalRemaining)
                          : ""}
                      </td>
                    ))}
                    {editMode && <><td /><td /><td /></>}
                    <td />
                  </TotalsRow>
                )}
              </table>
            </div>
          )}

          {/* Totals + selection bar (CR-178): idle = grand total of what's on
              screen in Kanban (the Sheet carries its totals in the tfoot,
              CR-187), selected = the selection's count + actions. Always
              shown; selection itself needs canEdit. */}
            <div data-tour="pal-selbar" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderTop: "1px solid var(--border)", background: selected.size ? "var(--accent-soft)" : "var(--panel-2)" }}>
              <span className={selected.size ? undefined : "mono"} style={{ fontSize: "var(--t-md)", fontWeight: 600, color: "var(--fg)" }}>
                {selected.size
                  ? `${selected.size} selected · ${fmt(selBoxes)} boxes`
                  : view === "sheet"
                    ? ""
                    : `Total · ${fmt(totalPallets)} pallet${totalPallets === 1 ? "" : "s"} · ${fmt(totalBoxes)} boxes`}
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
                      <Icon name="package" size={12} /> Palletize ({selPlanning.length})
                    </button>
                  )}
                  {selReady.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="hbtn"
                        style={{ height: 26, padding: "0 12px", borderRadius: 5, flex: "0 0 auto" }}
                        title="Print the pallet packing report for the selected palletized items"
                        onClick={() => void import("./packingReportPdf").then((m) =>
                          m.downloadPackingReportForLines(selReady.map(({ l }) => l), plans.flatMap((p) => p.lines)))}
                      >
                        <Icon name="printer" size={12} /> Packing Report ({selReady.length})
                      </button>
                      <button
                        type="button"
                        className="hbtn"
                        style={{ height: 26, padding: "0 12px", borderRadius: 5, flex: "0 0 auto" }}
                        title="Print per-pallet slips for the selected palletized items"
                        onClick={() => void import("./packingReportPdf").then((m) =>
                          m.downloadPalletSlipsForLines(selReady.map(({ l }) => l)))}
                      >
                        <Icon name="printer" size={12} /> Pallet Slips ({selReady.length})
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

          {/* Stage summary — kanban only; the sheet already shows a Stage column. */}
          {view === "kanban" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
            {cols.map((col, i) => {
              const n = allLines.filter((e) => stageOf(e.p, e.l) === col.key).length;
              return (
                <span key={col.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className={`chip palstatus ${col.chip}`} title={`${n} item${n === 1 ? "" : "s"}`}>
                    {col.label} <span className="mono">{n}</span>
                  </span>
                  {i < cols.length - 1 && <span className="dim" aria-hidden="true">→</span>}
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

      {topUp && (
        <TopUpModal
          target={topUp}
          donors={topUpDonors(topUp)}
          busy={busy}
          onConfirm={(donorLineId, boxes) => void confirmTopUp(donorLineId, boxes)}
          onClose={() => setTopUp(null)}
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
            availableLines={flow.allLines.filter(({ l }) => loadable.has(l.id)).map(({ l }) => l)}
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
