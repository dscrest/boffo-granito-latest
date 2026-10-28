/* ============================================================
   Loading Workspace — ONE page for New Loading AND a loading's Edit (CR-326,
   2026-10-12; replaces the stacked sections of CR-301):
     Customer     Combobox + 🔍 over EVERY active customer (CR-327) — an optional FILTER for
                  the design picker (blank = all stock; a container may mix customers, CR-252).
                  When the pick has nothing loadable a Note says what to do first (CR-328).
     View         Tabs | Sheet toggle (CR-335; opens on the org default view like the boards, last pick
                  remembered per browser). SHEET = every container on one grid, DESIGN FIRST (CR-374): band row
                  = identity only (dot · C k · Documents · ✕), its design rows (Design · Order · Batch · Pallets ·
                  Boxes · Pallet No. · Pallet type · Box Brand), an "Add Items in Bulk" row under them; once the
                  container has an item the band's ONE "+" menu (CR-155 style: Container & vehicle… ·
                  Dispatch · documents) enables "Container & vehicle…" → `ContainerDetailsModal` (the rail's
                  field set); the typed numbers show beside it. Nothing about the container shows before that
                  (`lockedOf`). Containers read C1, C2… everywhere; the LOAD codes show ONCE, in the strip on top.
                  Both views run the same row engine (`ContainerRows`) over the same drafts.
     Tabs         ONE TAB PER CONTAINER: status dot · "C k" / LOAD code · container no.
                  or vehicle · pallets · boxes; "+ Add container" is the last tab. Edit opens the
                  WHOLE group (LoadPlan.group siblings) as tabs — each container has its own
                  driver, vehicle, container no. and seals, so each is managed on its own tab.
       Sheet      step 1 — the entry grid: # · Design · Order · Batch · Pallets (typed) · Boxes · Pallet No.
                  · Pallet type · Box Brand · ✕. A blank row appends itself; the Batch cell opens
                  the per-batch picker (BulkLoadItemsModal); stock is SHARED across tabs
                  (`scopeBands`), so one item can be split 10 + 20 pallets.
       Rail       step 2 — Container pick, vehicle & seals + Shipping for THIS container (LoadDetailsFields
                  part="format" + "rail"; hidden behind a Note until the sheet has an item, `lockedOf`),
                  the Dispatch button (edit, open box) and the Documents row (Loading Sheet ·
                  Dispatch Copy · Pallet QR labels · Packing Report — on demand only).
     Status       derived, never stored: boxStatusOf — items → In Loading, container no. or seal →
                  Ready for Dispatch, Dispatch → Dispatched (tab locks, sheet read-only).
   One Save runs it all in order: vehicles → per container (new: mint the LoadBox → add pallets,
   a partial load's Ready remainder re-targeted for the next container; edit: unload / shrink →
   add → details) → pallet no./type on the loaded lines → sibling link (`LoadPlan.group`,
   primary patched last). It stops at the first failure; what already saved stays saved.
   Routes: /loading/new[?so=<id>] and /loading/:id/session.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useViewState } from "@/lib/usePersistedState";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { EmptyState, Note } from "@/ui/States";
import { confirmDelete, confirmDialog } from "@/ui/ConfirmDialog";
import { MoreMenu } from "@/features/common/DetailBits";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { update } from "@/lib/dataOps";
import { parseLoadPlan } from "@/data";
import { resolveVehicle } from "@/features/masters/vehiclesApi";
import { useMasters } from "@/features/masters/useMasters";
import { CustomerSearchModal } from "@/features/masters/CustomerSearchModal";
import { useOrders } from "@/features/orders/useOrders";
import { useContainerFormats } from "@/features/masters/containerFormatsApi";
import { LoadDetailsFields, blankDetails, captureOf, type VehicleDraft } from "./LoadDetailsFields";
import { BulkLoadItemsModal } from "./BulkLoadItemsModal";
import { DispatchEntryOverlay } from "./DispatchEntryOverlay";
import { blockers } from "./nextStep";
import {
  bandLabel, batchLabel, batchSummary, itemOptions, loadPlanJson, openLines, palletSplit, palletsOfLine, pickEntries, pickTotals, planFill,
  readyLabel, scopeBands, spreadPallets, spreadQty, type DesignRow, type SoBand, loadIdentity } from "./newLoadingRows";
import { useSessionPick } from "./SessionItemsStep";
import { planSlices, type PlanSlice } from "./containerPlanPrefill";
import { UNLOAD, resolveLoadSheetEdit, type LoadSheetDraft } from "./loadSheetEdit";
import { duplicateSeals } from "./sealChecks";
import {
  boxFill,
  boxLabel,
  boxStatusOf,
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
  deleteLoadBox,
  dispatchConfirmMessage,
  dispatchGate,
  dispatchLoadBox,
  invalidatePalPlans,
  listPalPlans,
  setLineBox,
  setLinesBox,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const NEW = "__new";
/** One sheet row per item (CR-256): its batches combined; `off` = batches the batch picker left out. */
interface ItemRow { key: number; /** DesignRow.key */ rowKey: string; off: string[] }
const BLANK = { rowKey: "", off: [] as string[] };
/** Pallet No. / Pallet type typed on a row — written onto its lines after the load (CR-326). */
type PalletMeta = { palletNo?: string; palletType?: string };
const sumPallets = (parts: { l: PalPlanLine; n: number }[]) => parts.reduce((s, x) => s + palletsOfLine(x.n, x.l.boxesPerPallet), 0);
/** Hover on a derived Boxes cell: "12 full + 1 partial (6 boxes)" per batch (CR-258). */
const boxesHint = (parts: { l: PalPlanLine; n: number }[]) =>
  parts
    .filter((x) => x.n > 0)
    .map((x) => {
      const { pallets, loose } = palletSplit(x.n, x.l.boxesPerPallet);
      return `${batchLabel(x.l)}: ${fmt(x.n)} boxes = ${pallets} full${loose > 0 ? ` + 1 partial (${loose} boxes)` : ""}`;
    })
    .join("\n");
/** Any of the row's lines shares a physical pallet with another batch/item. */
const mixBatchOf = (ls: PalPlanLine[]) => ls.some((l) => l.palletGroup);
const rowKeyOf = (l: PalPlanLine) => `${l.salesOrderId}|${l.designId}`;
type Entry = { p: PalPlan; l: PalPlanLine };

/** One container (= one tab): its picks (boxes per PalPlanLine id), its details, the SO-plan
    container it was filled from (per SO), pallet no./type per row, and its LoadBox when editing. */
interface ContainerDraft {
  key: number;
  boxId?: string;
  qty: Map<string, number>;
  capture: LoadingCapture;
  vehicle: VehicleDraft;
  plan: Record<string, number>;
  meta: Map<string, PalletMeta>;
}
const newDraft = (key: number, seed = blankDetails(), boxId?: string, plan: Record<string, number> = {}): ContainerDraft => ({ key, boxId, qty: new Map(), plan, meta: new Map(), ...seed });
/** The SO-plan containers a saved loading claims (CR-338), `{}` on loadings saved before the claim existed. */
const planOf = (b: LoadBox): Record<string, number> => parseLoadPlan(b.loadPlan)?.plan ?? {};
const samePlan = (a: Record<string, number>, b: Record<string, number>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
type DraftPatch = Partial<ContainerDraft> | ((d: ContainerDraft) => Partial<ContainerDraft>);
type Totals = ReturnType<typeof pickTotals>;
/** What a tab knows about one order's plan (CR-338): every container (+ who holds it), the chosen one, the count. */
type PlanPick = { slices: (PlanSlice & { takenBy: string })[]; chosen?: PlanSlice; of: number };

export function LoadingSession() {
  const { id = "" } = useParams();
  const boxId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const canEdit = can("stages", "edit");

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const res = await listPalPlans();
    setLoading(false);
    if (res.ok) {
      setPlans(res.plans);
      setBoxes(res.boxes);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const box = boxes.find((b) => b.id === boxId);
  if (!canEdit) return <EmptyState title="No access" hint="Loading needs the Stages edit permission" />;
  if (boxId && !box) {
    return loading ? <div className="muted mono" style={{ padding: 24 }}>Loading…</div> : <EmptyState title="Loading not found" />;
  }
  // Edit = the whole multi-container group (CR-301 LoadPlan.group), primary first then by place.
  // The primary's own slice can lack the group key (patched in after the mint), so match both ways.
  const groupId = box ? parseLoadPlan(box.loadPlan)?.group?.id || box.id : "";
  const group = box
    ? boxes
        .filter((b) => b.id === groupId || parseLoadPlan(b.loadPlan)?.group?.id === groupId)
        .sort((a, b) => Number(b.id === groupId) - Number(a.id === groupId) || (parseLoadPlan(a.loadPlan)?.group?.no ?? 0) - (parseLoadPlan(b.loadPlan)?.group?.no ?? 0))
    : [];
  // Keyed by the group: the drafts seed once from the boxes.
  return (
    <SessionPage
      key={group.map((b) => b.id).join("|") || NEW}
      group={group}
      openedId={box?.id || ""}
      plans={plans}
      boxes={boxes}
      presetSalesOrderId={box ? undefined : params.get("so") || undefined}
      reload={load}
    />
  );
}

function SessionPage({ group, openedId, plans, boxes, presetSalesOrderId, reload }: {
  group: LoadBox[]; openedId: string; plans: PalPlan[]; boxes: LoadBox[]; presetSalesOrderId?: string; reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const editing = group.length > 0;
  const formats = useContainerFormats();
  const { customers: masterCustomers } = useMasters();
  const { orders } = useOrders();
  const pick = useSessionPick({ plans, boxes, presetSalesOrderId, anyCustomer: true, onSaved: () => undefined });
  const allLines = useMemo(() => plans.flatMap((p) => p.lines), [plans]);
  const boxOf = (d: ContainerDraft) => (d.boxId ? boxes.find((b) => b.id === d.boxId) : undefined);
  const entriesOf = (d: ContainerDraft): Entry[] => (d.boxId ? plans.flatMap((p) => p.lines.filter((l) => l.loadBoxId === d.boxId).map((l) => ({ p, l }))) : []);
  const isOpen = (d: ContainerDraft) => !d.boxId || boxOf(d)?.status === "Open";

  // The containers (tabs). Edit = one per box of the group; new = one blank. Keys are monotonic, never the index.
  const [drafts, setDrafts] = useState<ContainerDraft[]>(() =>
    editing ? group.map((b, i) => newDraft(i, blankDetails(b, captureOf(b)), b.id, planOf(b))) : [newDraft(0)],
  );
  const [active, setActive] = useState<number>(() => Math.max(0, group.findIndex((b) => b.id === openedId)));
  // CR-335: Tabs | Sheet. Seeds from the org default view (AppSetting.default_view) like every board.
  const [view, setView] = useViewState<"tabs" | "sheet">("loading.workspace.view", "sheet", "tabs");
  const [sheetPicker, setSheetPicker] = useState<Record<number, string>>({}); // per container: "" | "all" | rowKey
  const [detailsFor, setDetailsFor] = useState<number | null>(null); // CR-374: the container whose Container & vehicle modal is open
  const patchDraft = (key: number, p: DraftPatch) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...(typeof p === "function" ? p(d) : p) } : d)));
  const addDraft = () =>
    setDrafts((ds) => {
      const key = ds.reduce((m, d) => Math.max(m, d.key), 0) + 1;
      setActive(key);
      return [...ds, newDraft(key)];
    });
  const removeDraft = (key: number) =>
    setDrafts((ds) => {
      if (ds.length <= 1) return ds;
      const next = ds.filter((d) => d.key !== key);
      if (active === key) setActive(next[0].key);
      return next;
    });
  // Loaded lines: typed qty per line id ("0" = remove).
  const [loadedDraft, setLoadedDraft] = useState<Record<string, string>>({});
  // CR-334: the reason typed when a loaded item is removed (✕) — sent with the unload, audited like a delete.
  const [removeReason, setRemoveReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [custSearch, setCustSearch] = useState(false);
  const [entryOverlay, setEntryOverlay] = useState<{ box: LoadBox; entries: Entry[] } | null>(null);

  const draftOf = (l: PalPlanLine): LoadSheetDraft | undefined => {
    const v = loadedDraft[l.id];
    if (v == null || v.trim() === "") return undefined;
    return parseInt(v, 10) === 0 ? { boxId: UNLOAD } : { qty: v };
  };
  const linesOf = (d: ContainerDraft) => entriesOf(d).map((e) => e.l);
  const loadedOpsOf = (d: ContainerDraft) => linesOf(d).map((l) => ({ l, ...resolveLoadSheetEdit(l, boxOf(d)!, [], draftOf(l)) }));
  const loadedError = drafts.flatMap(loadedOpsOf).find((o) => o.error)?.error || "";
  // Loaded lines shown one row per item too; a typed total is kept oldest batch first (per-line drafts underneath).
  const keptOf = (l: PalPlanLine) => {
    const n = parseInt(loadedDraft[l.id] ?? "", 10);
    return n >= 0 ? Math.min(n, l.boxes) : l.boxes;
  };
  const loadedGroupsOf = (d: ContainerDraft) =>
    [...linesOf(d).reduce((m, l) => m.set(rowKeyOf(l), [...(m.get(rowKeyOf(l)) ?? []), l]), new Map<string, PalPlanLine[]>()).values()]
      .map((ls) => [...ls].sort((a, b) => a.createdTime.localeCompare(b.createdTime)));
  /** ✕ on a loaded row = back to Ready for Loading — a removal, so it asks the delete reason (CR-334; Admin: Yes/No).
      The undo ("Keep this item") clears both the draft and the reason. */
  const unloadGroup = async (ls: PalPlanLine[], removed: boolean) => {
    let reason = "";
    if (!removed) {
      const di = drafts.findIndex((d) => d.boxId === ls[0].loadBoxId); // CR-374: C k, never the LOAD code
      const r = await confirmDelete({
        title: "Remove from loading",
        message: `Remove ${ls[0].designLabel} (${fmt(ls.reduce((s, l) => s + l.boxes, 0))} boxes) from ${di >= 0 ? titleOf(drafts[di], di) : "this loading"}? It returns to Ready for Loading.`,
      });
      if (r == null) return;
      reason = r;
    }
    setLoadedDraft((p) => ({ ...p, ...Object.fromEntries(ls.map((l) => [l.id, removed ? "" : "0"])) }));
    setRemoveReason((p) => ({ ...p, ...Object.fromEntries(ls.map((l) => [l.id, reason])) }));
  };
  /** Pallets typed on a loaded row: whole pallets, oldest batch first (CR-258); the rest goes back to Ready for Loading. */
  const setGroupPallets = (ls: PalPlanLine[], p: number) =>
    setLoadedDraft((d) => ({ ...d, ...Object.fromEntries([...spreadPallets(ls, p)].map(([id, n]) => [id, String(n)])) }));

  // What the OTHER containers picked — gone from this one's stock (pure scopeBands in the section).
  const useOfOthers = (key: number) => {
    const m = new Map<string, number>();
    for (const d of drafts) if (d.key !== key) for (const [id, n] of d.qty) if (n > 0) m.set(id, (m.get(id) || 0) + n);
    return m;
  };
  // CR-273: a container's picked format drives its % (saved on its LoadBox); else each line's size default.
  const capOf = (d: ContainerDraft) => {
    const c = formats.find((f) => f.id === d.capture.container_format)?.totalBoxes || 0;
    return (l: PalPlanLine) => c || l.palletCapacity;
  };
  // Edit: share already in the box, after the typed edits.
  const keptOfDraft = (d: ContainerDraft) => linesOf(d).map((l) => ({ l, n: keptOf(l) })).filter((x) => x.n > 0);
  const loadedFill = (d: ContainerDraft) => {
    const c = formats.find((f) => f.id === d.capture.container_format)?.totalBoxes || 0;
    const kept = keptOfDraft(d);
    return c ? kept.reduce((s, x) => s + x.n / c, 0) : boxFill(kept.map((x) => ({ ...x.l, boxes: x.n })));
  };
  // qty is what counts here; the unscoped bands are fine (pickTotals never reads a line's boxes).
  const totals = drafts.map((d) => pickTotals(pick.allBands, d.qty, capOf(d), d.boxId ? loadedFill(d) : 0));
  const keptCount = (d: ContainerDraft) => keptOfDraft(d).length;
  /** The tab's status: the box's derived status (after the typed edits), or what the new tab holds. */
  const statusOf = (d: ContainerDraft, i: number) => {
    const b = boxOf(d);
    if (b) return boxStatusOf(b, keptCount(d) + totals[i].picked.length);
    return totals[i].boxes > 0 ? { key: "InLoading" as const, label: "New", cls: "palstatus p-loading" } : { key: "Empty" as const, label: "Empty", cls: "palstatus p-planning" };
  };
  const dotOf = (key: string) => (key === "Dispatched" ? "var(--fg-2)" : key === "ReadyDispatch" ? "var(--c-green)" : key === "InLoading" ? "var(--accent)" : "var(--faint)");

  // CR-333: a typed container name is the tab title; "C k" becomes its subtitle.
  // CR-354/374: every container reads C1, C2 … — saved ones too (user 2026-10-22: the LOAD code "is not of any
  // significance", it shows ONCE in the strip on top and otherwise stays in the DB / URL).
  const codeOf = (_d: ContainerDraft, i: number) => `C${i + 1}`;
  const titleOf = (d: ContainerDraft, i: number) => d.capture.name?.trim() || codeOf(d, i);
  // Plan as a helper (CR-255/336): EVERY planned container of the order for this tab's picker, each marked
  // with who holds it — another tab here, or an Open loading outside this group (the group's own boxes are
  // this session's drafts). `chosen` = this tab's claim, else the first free one (the old auto hint).
  const slicesFor = (key: number, band: SoBand): { slices: (PlanSlice & { takenBy: string })[]; chosen?: PlanSlice; of: number } => {
    const so = band.salesOrderId;
    const all = planSlices(so, pick.planBySo, plans, boxes, pick.designIdOf);
    const slices = all.map((s) => {
      const tab = drafts.findIndex((d) => d.key !== key && d.plan[so] === s.ci);
      const takenBy = tab >= 0 ? titleOf(drafts[tab], tab) : s.claimedBy && !group.some((g) => g.id === s.claimedBy!.id) ? boxLabel(s.claimedBy) : "";
      return { ...s, takenBy };
    });
    const mine = drafts.find((d) => d.key === key)?.plan[so];
    const chosen = slices.find((s) => s.ci === mine) ?? slices.find((s) => s.status !== "Sent" && !s.takenBy);
    return { slices, chosen, of: all.length };
  };
  /** Claim a planned container for this tab (undefined = release) and start on its format while the Container
      field is blank (CR-274). */
  const claimPlan = (key: number, band: SoBand, slice?: PlanSlice) =>
    patchDraft(key, (d) => {
      const plan = { ...d.plan };
      if (slice) plan[band.salesOrderId] = slice.ci;
      else delete plan[band.salesOrderId];
      return {
        plan,
        capture: !slice || d.capture.container_format || !slice.containerFormat ? d.capture : { ...d.capture, container_format: slice.containerFormat },
      };
    });
  /** Fill ONE container from a planned one: claim it, then its boxes FIFO over the (scoped) band. */
  const fillFromPlan = (key: number, band: SoBand, slice: PlanSlice): Map<string, number> => {
    const m = planFill(slice.lines, band, pick.designIdOf);
    claimPlan(key, band, slice);
    patchDraft(key, (d) => ({ qty: new Map([...d.qty, ...m]) }));
    return m;
  };
  // CR-274: a loading opened from the SO starts on the plan's container format (first tab, only while blank).
  const presetBand = presetSalesOrderId && !editing ? pick.bands[0] : undefined;
  const planFormat = presetBand ? slicesFor(drafts[0].key, presetBand).chosen?.containerFormat : undefined;
  useEffect(() => {
    if (planFormat) patchDraft(drafts[0].key, (d) => (d.capture.container_format ? {} : { capture: { ...d.capture, container_format: planFormat } }));
  }, [planFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duplicate container no. / seals: against every saved loading AND the other tabs (warn-only).
  const sealId = (d: ContainerDraft) => d.boxId || `new-${d.key}`;
  const dups = duplicateSeals(
    [
      ...boxes.map((b) => ({ id: b.id, label: boxLabel(b), containerNumber: b.containerNumber, electronicSeal: b.electronicSeal, lineSeal: b.lineSeal })),
      ...drafts.filter((d) => !d.boxId).map((d, i) => ({ id: sealId(d), label: `Container ${i + 1}`, containerNumber: "", electronicSeal: "", lineSeal: "" })),
    ],
    Object.fromEntries(drafts.map((d) => [sealId(d), d.capture])),
    drafts.map(sealId),
  );

  const detailUrl = (bid: string) => `/loading/${encodeURIComponent(bid)}`;
  const back = () => navigate(editing ? detailUrl(openedId) : "/loading");
  const typedOf = (d: ContainerDraft) => Object.fromEntries(Object.entries(d.capture).filter(([, v]) => (v || "").trim())) as LoadingCapture;
  /** Unsaved work on a tab — Dispatch wants it saved first. */
  const dirty = (d: ContainerDraft) => {
    const b = boxOf(d);
    if (!b) return true;
    if (totals[drafts.indexOf(d)].boxes > 0 || d.meta.size > 0) return true;
    if (linesOf(d).some((l) => (loadedDraft[l.id] ?? "").trim() !== "")) return true;
    if (!samePlan(d.plan, planOf(b))) return true;
    const cur = captureOf(b);
    if ((Object.keys(cur) as (keyof LoadingCapture)[]).some((k) => (d.capture[k] || "") !== (cur[k] || ""))) return true;
    return d.vehicle.vehicle_number !== (b.vehicleNumber || "") || d.vehicle.driver_name !== (b.driverName || "") || d.vehicle.mobile_number !== (b.mobileNumber || "");
  };

  /** Pallet No. / Pallet type typed on a row → its lines (only what changed). */
  const writeMeta = async (lines: PalPlanLine[], m: PalletMeta | undefined, label: string): Promise<string> => {
    if (!m) return "";
    for (const l of lines) {
      const patch: Record<string, string> = {};
      if (m.palletNo != null && m.palletNo.trim() !== l.palletNo) patch.pallet_no = m.palletNo.trim();
      if (m.palletType != null && m.palletType.trim() !== l.palletType) patch.pallet_type = m.palletType.trim();
      if (!Object.keys(patch).length) continue;
      const r = await update("PalletizationPlanLine", l.id, patch);
      if (!r.ok) return `${label}: ${r.error || "could not save the pallet number"}`;
    }
    return "";
  };
  /** Metas of the lines a container just loaded (`remap` = original → current id after a split). */
  const metaOfPicks = async (d: ContainerDraft, label: string, remap: Map<string, string>): Promise<string> => {
    for (const l of pick.allBands.flatMap((b) => b.designs.flatMap(openLines)).filter((l) => (d.qty.get(l.id) || 0) > 0)) {
      const err = await writeMeta([{ ...l, id: remap.get(l.id) ?? l.id }], d.meta.get(rowKeyOf(l)), label);
      if (err) return err;
    }
    return "";
  };

  /** Runs the whole Save in order. `go` = where to land (on an error: where a retry continues; "" = stay). */
  const run = async (): Promise<{ error: string; go: string }> => {
    if (loadedError) return { error: loadedError, go: "" };
    const vehicles: string[] = [];
    for (const d of drafts) {
      const veh = await resolveVehicle(d.vehicle);
      if (!veh.ok) return { error: veh.error || "Could not save the vehicle", go: "" };
      vehicles.push(veh.rowid || "");
    }

    if (!editing) {
      const n = drafts.length;
      let first = "";
      // A partial load keeps the loaded boxes on the ORIGINAL line and splits a Ready remainder (new id):
      // the next container drawing the rest must target that remainder. original id → current id.
      const remap = new Map<string, string>();
      for (let i = 0; i < n; i++) {
        const d = drafts[i];
        const label = `Container ${i + 1}`;
        const grp = i > 0 ? { id: first, no: i + 1, of: n } : undefined;
        const created = await createLoadBox({ load_plan: loadPlanJson(pick.allBands, d.qty, grp, d.plan), ...(vehicles[i] ? { vehicle: vehicles[i] } : {}), ...typedOf(d) });
        if (!created.ok || !created.data?.ROWID) {
          return { error: `${label}: ${created.error || "could not create the loading"}${i > 0 ? ` — containers 1…${i} were created, the rest were not` : ""}`, go: i > 0 ? "/loading" : "" };
        }
        const bid = String(created.data.ROWID);
        if (!first) first = bid;
        const picks = pickEntries(pick.allBands, d.qty);
        const res = await setLinesBox(bid, picks.map((e) => ({ ...e, lineId: remap.get(e.lineId) ?? e.lineId })));
        if (!res.ok) return { error: `${label}: ${res.error || "could not load the items"}${i > 0 ? ` — containers 1…${i} were created, the rest were not` : ""}`, go: `${detailUrl(bid)}/session` };
        // The loaded boxes stay on the id we sent; the remainder (if any) is the next container's target.
        const err = await metaOfPicks(d, label, remap);
        if (err) return { error: err, go: `${detailUrl(bid)}/session` };
        res.data?.remainders?.forEach((r, j) => {
          if (r.remainder && picks[j]) remap.set(picks[j].lineId, r.remainder);
        });
      }
      if (n > 1) {
        // The primary's own slice gets its place last (its ROWID is the group id).
        const r = await updateLoadBox(first, { load_plan: loadPlanJson(pick.allBands, drafts[0].qty, { id: first, no: 1, of: n }, drafts[0].plan) });
        if (!r.ok) return { error: `All ${n} loadings were created, but linking them failed: ${r.error || "error"}`, go: detailUrl(first) };
      }
      return { error: "", go: detailUrl(first) };
    }

    // Edit: every tab of the group. Existing boxes first (unload / shrink → add → pallet no. → details),
    // then any container added here is minted as a new sibling of the group.
    const groupId = group[0].id;
    const existing = drafts.filter((d) => d.boxId);
    const added = drafts.filter((d) => !d.boxId);
    const total = existing.length + added.length;
    for (const d of existing) {
      const b = boxOf(d)!;
      const label = boxLabel(b);
      const i = drafts.indexOf(d);
      if (b.status === "Open") {
        for (const { l, ops } of loadedOpsOf(d)) {
          if (!ops.unload && !ops.move) continue;
          const r = ops.unload ? await setLineBox(l.id, "", undefined, removeReason[l.id]) : await setLineBox(l.id, b.id, ops.move!.boxes);
          if (!r.ok) return { error: `${label}: ${r.error || "could not change a loaded item"}`, go: "" };
        }
        const entries = pickEntries(pick.allBands, d.qty);
        if (entries.length) {
          const res = await setLinesBox(b.id, entries);
          if (!res.ok) return { error: `${label}: ${res.error || "could not load the items"}`, go: "" };
          const err = await metaOfPicks(d, label, new Map());
          if (err) return { error: err, go: "" };
        }
      }
      // Pallet no. / type typed on already-loaded rows (allowed after dispatch too — paperwork).
      for (const ls of loadedGroupsOf(d)) {
        const err = await writeMeta(ls, d.meta.get(rowKeyOf(ls[0])), label);
        if (err) return { error: err, go: "" };
      }
      const cur = captureOf(b);
      const patch: LoadingCapture & { vehicle?: string; load_plan?: string } = {};
      for (const k of Object.keys(cur) as (keyof LoadingCapture)[])
        if ((d.capture[k] || "") !== (cur[k] || "")) patch[k] = d.capture[k] || "";
      if (vehicles[i] && vehicles[i] !== b.vehicleId) patch.vehicle = vehicles[i];
      // CR-338: a changed plan-container claim rides on the box's load_plan (same idiom as the group key).
      if (!samePlan(d.plan, planOf(b))) {
        const lp = parseLoadPlan(b.loadPlan) ?? { v: 1 as const, lines: [] };
        const { plan: _old, ...rest } = lp;
        patch.load_plan = JSON.stringify({ ...rest, ...(Object.keys(d.plan).length ? { plan: d.plan } : {}) }).slice(0, 10000);
      }
      if (Object.keys(patch).length) {
        const r = await updateLoadBox(b.id, patch);
        if (!r.ok) return { error: `${label}: ${r.error || "could not save loading details"}`, go: "" };
      }
    }
    let no = existing.length;
    for (const d of added) {
      const i = drafts.indexOf(d);
      const label = `Container ${i + 1}`;
      no++;
      const created = await createLoadBox({ load_plan: loadPlanJson(pick.allBands, d.qty, { id: groupId, no, of: total }, d.plan), ...(vehicles[i] ? { vehicle: vehicles[i] } : {}), ...typedOf(d) });
      if (!created.ok || !created.data?.ROWID) return { error: `${label}: ${created.error || "could not create the loading"}`, go: "" };
      const bid = String(created.data.ROWID);
      const res = await setLinesBox(bid, pickEntries(pick.allBands, d.qty));
      if (!res.ok) return { error: `${label}: ${res.error || "could not load the items"}`, go: `${detailUrl(bid)}/session` };
      const err = await metaOfPicks(d, label, new Map());
      if (err) return { error: err, go: `${detailUrl(bid)}/session` };
    }
    if (added.length) {
      // The group grew: the primary's slice carries the new count (siblings keep theirs — only `of` is informative).
      const primary = group[0];
      const plan = parseLoadPlan(primary.loadPlan);
      const r = await updateLoadBox(primary.id, { load_plan: JSON.stringify({ ...(plan ?? { v: 1, lines: [] }), group: { id: groupId, no: 1, of: total } }).slice(0, 10000) });
      if (!r.ok) return { error: `Containers were added, but linking them failed: ${r.error || "error"}`, go: detailUrl(openedId) };
    }
    return { error: "", go: detailUrl(openedId) };
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const { error, go } = await run();
    invalidatePalPlans();
    if (!error) {
      toast.success(editing ? "Loading saved" : drafts.length > 1 ? `${drafts.length} loadings created` : "Loading created");
      navigate(go, { replace: !editing });
      return;
    }
    toast.error(error);
    await reload().catch(() => undefined);
    setBusy(false);
    // A new loading minted before the failure: carry on editing IT — a retry here would mint again.
    if (go) navigate(go, { replace: true });
  };

  /** ✕ on a SAVED container tab = Delete Loading (CR-334): the delete reason, the server un-allocates its lines
      (Open only). The opened box gone → carry on in a sibling's session, else back to /loading. */
  const deleteBox = async (d: ContainerDraft) => {
    const b = boxOf(d);
    if (!b || busy) return;
    const n = entriesOf(d).length;
    const reason = await confirmDelete({
      title: "Delete loading",
      message: n > 0 ? `Delete ${boxLabel(b)}? ${n} item${n === 1 ? "" : "s"} return to Ready for Loading.` : `Delete ${boxLabel(b)}?`,
    });
    if (reason == null) return;
    setBusy(true);
    const res = await deleteLoadBox(b.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not delete the loading");
      return;
    }
    toast.success(`${boxLabel(b)} deleted`);
    invalidatePalPlans();
    const rest = group.filter((x) => x.id !== b.id);
    if (b.id === openedId) navigate(rest.length ? `${detailUrl(rest[0].id)}/session` : "/loading", { replace: true });
    else void reload();
  };

  /** What the tab's ✕ does: an unsaved tab clears (never the last one); a saved Open box deletes the loading. */
  const removeOf = (d: ContainerDraft): (() => void) | undefined =>
    !d.boxId ? (drafts.length > 1 ? () => removeDraft(d.key) : undefined) : isOpen(d) ? () => void deleteBox(d) : undefined;

  /** Dispatch ONE container from its tab — the server rule (dispatchGate) plus "save first". */
  const dispatch = async (d: ContainerDraft) => {
    const b = boxOf(d);
    if (!b || busy) return;
    const entries = entriesOf(d);
    const ok = await confirmDialog({ title: "Dispatch", message: dispatchConfirmMessage(b, entries.length) });
    if (!ok) return;
    setBusy(true);
    const res = await dispatchLoadBox(b.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not dispatch");
      return;
    }
    toast.success(`${boxLabel(b)} dispatched`);
    setEntryOverlay({ box: b, entries });
    invalidatePalPlans();
    void reload();
  };

  // CR-327: every active customer, the ones with Ready stock first with their hint.
  const readyOf = new Map(pick.customers.map((c) => [c.id, `${readyLabel(c)} ready`]));
  const customerOptions = [
    ...masterCustomers
      .filter((c) => c.active)
      .map((c) => ({ value: c.id, label: c.name, hint: readyOf.get(c.id) }))
      .sort((a, b) => Number(!!b.hint) - Number(!!a.hint) || a.label.localeCompare(b.label)),
    // A customer no longer in the master (inactive) still names itself.
    ...(pick.customerId && !masterCustomers.some((c) => c.id === pick.customerId)
      ? [{ value: pick.customerId, label: pick.customers.find((c) => c.id === pick.customerId)?.name || pick.customerId }]
      : []),
  ];
  // CR-328: why nothing is loadable — for the picked customer, or for everyone.
  const anyOpen = drafts.some(isOpen);
  const why = anyOpen && pick.bands.length === 0 ? blockers("load", pick.customerId, orders, allLines) : [];
  const whyName = pick.customerId ? customerOptions.find((c) => c.value === pick.customerId)?.label || "" : "";

  // CR-350: a NEW container's vehicle & seal fields wait for its first item (design + container first).
  const lockedOf = (d: ContainerDraft, i: number) => !d.boxId && totals[i].boxes === 0;
  // Save needs every new container to carry something; name the blank one.
  const emptyAt = drafts.findIndex(lockedOf);
  // CR-350: who this loading is for — party + PO on top, SO numbers small; falls back to the Customer filter.
  const ident = loadIdentity(drafts.flatMap((d, i) => [...totals[i].picked, ...keptOfDraft(d).map((x) => x.l)]));
  const party = ident.customers.join(", ") || (pick.customerId ? pick.customers.find((c) => c.id === pick.customerId)?.name || "" : "");
  const footerError = loadedError || (emptyAt >= 0 && totals.some((t) => t.boxes > 0) ? `C${emptyAt + 1} has no items` : "");
  const grand = totals.reduce((s, t) => ({ boxes: s.boxes + t.boxes, pallets: s.pallets + t.pallets }), { boxes: 0, pallets: 0 });
  const loadedGrand = drafts.reduce((s, d) => s + keptOfDraft(d).reduce((n, x) => n + x.n, 0), 0);

  /** Edit: the already-loaded items of a tab, one row per item, as the sheet's first rows. */
  const loadedRowsOf = (d: ContainerDraft, open: boolean, indexed = true): ReactNode =>
    loadedGroupsOf(d).map((ls, i) => {
      const l0 = ls[0];
      const keptParts = ls.map((l) => ({ l, n: keptOf(l) }));
      const keptN = keptParts.reduce((n, x) => n + x.n, 0);
      const touched = ls.some((l) => (loadedDraft[l.id] ?? "").trim() !== "");
      const removed = touched && keptN === 0;
      const error = loadedOpsOf(d).find((o) => o.error && ls.includes(o.l))?.error;
      const batches = ls.map((l) => `${batchLabel(l)} · ${fmt(l.boxes)}`);
      const mix = mixBatchOf(ls);
      const meta = d.meta.get(rowKeyOf(l0));
      const setMeta = (m: PalletMeta) => patchDraft(d.key, (cur) => ({ meta: new Map(cur.meta).set(rowKeyOf(l0), { ...cur.meta.get(rowKeyOf(l0)), ...m }) }));
      return (
        <tr key={l0.id} style={removed ? { opacity: 0.5 } : undefined}>
          {indexed && <td className="mono dim">{i + 1}</td>}
          <td><span className="design-name">{l0.designLabel}</span></td>
          <td className="mono nw" title={[l0.customerName, l0.soNumber].filter(Boolean).join(" · ")}>{l0.poNumber || l0.soNumber || "—"}</td>
          <td className="mono nw" title={batches.join("\n")}>{ls.length === 1 ? l0.batchNumber || "—" : `${ls.length} batches`}{mix && <span className="chip mx" style={{ marginLeft: 6 }}>MXBATCH</span>}</td>
          <td className="num" title={error || undefined}>
            {open ? (
              <NumberInput
                maxDecimals={0}
                value={String(sumPallets(keptParts))}
                aria-label={`Pallets loaded, ${l0.designLabel}`}
                aria-invalid={!!error}
                onChange={(e) => setGroupPallets(ls, Number(e.target.value) || 0)}
                style={{ textAlign: "right", ...(error ? { borderColor: "var(--c-red)" } : {}) }}
              />
            ) : fmt(sumPallets(keptParts))}
          </td>
          <td className="num" title={boxesHint(keptParts) || undefined}>{fmt(keptN)}</td>
          <td><input value={meta?.palletNo ?? l0.palletNo} placeholder="auto" aria-label="Pallet No." onChange={(e) => setMeta({ palletNo: e.target.value })} /></td>
          <td><input value={meta?.palletType ?? l0.palletType} placeholder="—" aria-label="Pallet type" onChange={(e) => setMeta({ palletType: e.target.value })} /></td>
          <td className="dim">{pick.brandName(l0.boxBrandId || l0.soBoxBrandId || l0.customerBoxBrandId) || "—"}</td>
          <td>
            {open && (
              <button
                className="btn x"
                title={removed ? "Keep this item" : "Remove from this loading"}
                onClick={() => void unloadGroup(ls, removed)}
              >
                <Icon name={removed ? "refresh" : "x"} size={13} />
              </button>
            )}
          </td>
        </tr>
      );
    });

  const printAll = (what: "copy" | "qr" | "report") => {
    for (const d of drafts) {
      const b = boxOf(d);
      if (!b) continue;
      const entries = entriesOf(d);
      if (what === "copy") void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(b, entries));
      else if (what === "qr") void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(b, entries));
      else void import("./packingReportPdf").then((m) => m.downloadPackingReportForLines(entries.map((e) => e.l), allLines));
    }
  };

  return (
    <div>
      {/* No page title (user 2026-09-19): the strip carries the loading's identity + Back. */}
      <nav className="steps" aria-label="Loading">
        <span style={{ fontWeight: 700 }}>{editing ? "Loading" : "New Loading"}</span>
        {editing && <span className="mono dim nw">{group.map(boxLabel).join(" · ")}</span>}
        <span className="chip" style={{ fontSize: "var(--t-xs)" }}>{drafts.length} container{drafts.length === 1 ? "" : "s"}</span>
        {party && (
          <span className="nw" title="Party · customer PO · sales orders in this loading">
            <strong>{party}{ident.pos.length > 0 && ` · PO ${ident.pos.join(", ")}`}</strong>
            {ident.sos.length > 0 && <span className="mono dim" style={{ fontSize: "var(--t-xs)", marginLeft: 6 }}>{ident.sos.join(" · ")}</span>}
          </span>
        )}
        <div className="seg" role="group" aria-label="View">
          <button type="button" className={`seg-btn${view === "tabs" ? " active" : ""}`} aria-pressed={view === "tabs"} onClick={() => setView("tabs")}>Tabs</button>
          <button type="button" className={`seg-btn${view === "sheet" ? " active" : ""}`} aria-pressed={view === "sheet"} onClick={() => setView("sheet")}>Sheet</button>
        </div>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
          {editing && (
            <MoreMenu
              label="Print all"
              items={[
                { label: "Dispatch Copies", onClick: () => printAll("copy") },
                { label: "Pallet QR labels", onClick: () => printAll("qr") },
                { label: "Packing Reports", onClick: () => printAll("report") },
              ]}
            />
          )}
          <button className="hbtn" onClick={back}>
            <Icon name="chev-l" size={13} /> {editing ? "Back to loading" : "Back to Loading"}
          </button>
        </span>
      </nav>

      <div className="form-section">
        <div className="form-rows">
          <div className="form-field span2">
            <span className="lbl">Customer</span>
            <div className="ctl-row">
              <Combobox
                className="grow"
                value={pick.customerId}
                options={customerOptions}
                onChange={pick.pickCustomer}
                placeholder="All customers"
                ariaLabel="Customer"
                disabled={!pick.showRail}
                emptyText="No customers yet. Add one under Customers"
              />
              <button type="button" className="btn" aria-label="Search customers" title="Search customers" disabled={!pick.showRail} onClick={() => setCustSearch(true)}>
                <Icon name="search" size={13} />
              </button>
            </div>
          </div>
        </div>
        {why.length > 0 && (
          <Note tone="warn" style={{ marginBottom: 0 }}>
            <strong>Nothing is ready for loading{whyName ? ` for ${whyName}` : ""}.</strong>
            {why.slice(0, 6).map((b, i) => (
              <span key={i}>
                {b.label && <span className="mono">{b.label} · </span>}
                {b.to && !b.to.startsWith("/loading") ? <a href={b.to}>{b.reason}</a> : b.reason}.
              </span>
            ))}
            {why.length > 6 && <span className="dim">+{why.length - 6} more orders</span>}
            {!pick.customerId && why.length > 0 && why[0].label && <span className="dim">Pick a customer to see only their orders.</span>}
          </Note>
        )}
      </div>

      {view === "tabs" && (<>
      {/* One tab per container (CR-326). */}
      <div className="ctabs" role="tablist" aria-label="Containers">
        {drafts.map((d, i) => {
          const st = statusOf(d, i);
          const sub = d.capture.container_number || d.vehicle.vehicle_number;
          return (
            <div key={d.key} role="tab" aria-selected={d.key === active} className={`ctab${d.key === active ? " on" : ""}`} title={st.label}>
              <button type="button" className="ctab-main" onClick={() => setActive(d.key)}>
                <span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: dotOf(st.key), display: "inline-block" }} />
                {titleOf(d, i)}
                {d.capture.name?.trim() && <span className="sub mono">{codeOf(d, i)}</span>}
                {sub && <span className="sub mono">{sub}</span>}
                <span className="sub">{fmt(totals[i].pallets + sumPallets(keptOfDraft(d)))} pal · {fmt(totals[i].boxes + keptOfDraft(d).reduce((n, x) => n + x.n, 0))} bx</span>
              </button>
              {/* The ✕ lives ON the tab (user 2026-10-12): unsaved tab = clear, saved Open box = Delete loading (reason). */}
              {removeOf(d) && (
                <button type="button" className="ctab-x" aria-label={d.boxId ? `Delete ${titleOf(d, i)}` : `Remove ${titleOf(d, i)}`} title={d.boxId ? "Delete this loading" : "Remove this container"} onClick={removeOf(d)}>
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          );
        })}
        <button type="button" className="ctab add" onClick={addDraft}>
          <Icon name="plus" size={12} /> Add container
        </button>
      </div>

      {drafts.map((d, i) => {
        const b = boxOf(d);
        const open = isOpen(d);
        const gate = b && open ? dispatchGate(b, keptCount(d)) || (dirty(d) ? "Save your changes first" : null) : null;
        return (
          <div key={d.key} hidden={d.key !== active}>
            <ContainerSection
              draft={d}
              title={titleOf(d, i)}
              status={statusOf(d, i)}
              box={b}
              entries={entriesOf(d)}
              allLines={allLines}
              open={open}
              totals={totals[i]}
              pick={pick}
              otherUse={useOfOthers(d.key)}
              patch={(p) => patchDraft(d.key, p)}
              planFor={(band) => slicesFor(d.key, band)}
              onChoose={(band, slice) => claimPlan(d.key, band, slice)}
              onFill={(band, slice) => fillFromPlan(d.key, band, slice)}
              loadedRows={d.boxId ? loadedRowsOf(d, open) : undefined}
              loadedItems={loadedGroupsOf(d).filter((ls) => ls.some((l) => keptOf(l) > 0)).length}
              dispatchGate={gate}
              onDispatch={b && open ? () => void dispatch(d) : undefined}
              onSheet={b ? () => navigate(detailUrl(b.id)) : undefined}
              busy={busy}
              locked={lockedOf(d, i)}
            />
          </div>
        );
      })}
      </>)}

      {/* Sheet mode (CR-335): every container on one grid — a band row, then its design rows. */}
      {view === "sheet" && (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl load-sheet" aria-label="Loading sheet, all containers">
              <thead>
                <tr>
                  <th>Design</th>
                  <th style={{ width: 130 }}>PO</th>
                  <th style={{ width: 150 }}>Batch</th>
                  <th className="num" style={{ textAlign: "right", width: 90 }}>Pallets</th>
                  <th className="num" style={{ textAlign: "right", width: 80 }}>Boxes</th>
                  <th style={{ width: 110 }}>Pallet No.</th>
                  <th style={{ width: 110 }}>Pallet type</th>
                  <th style={{ width: 130 }}>Box Brand</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {drafts.map((d, i) => {
                  const b = boxOf(d);
                  const open = isOpen(d);
                  const st = statusOf(d, i);
                  const gate = b && open ? dispatchGate(b, keptCount(d)) || (dirty(d) ? "Save your changes first" : null) : null;
                  const fillText = totals[i].fill > 0 ? `${Math.round(totals[i].fill * 100)}%` : "";
                  const rm = removeOf(d);
                  const locked = lockedOf(d, i); // CR-350 gate; CR-374: "+ Container & vehicle" waits behind it, nothing else shows
                  const sum = [d.capture.container_number, d.vehicle.vehicle_number, d.capture.electronic_seal].filter((x) => x && x.trim()).join(" · ");
                  // CR-374: the band is the container's IDENTITY only — dot · C k · (+ Container & vehicle once it has a design,
                  // the typed numbers, Dispatch) · Documents · ✕. No status chip, no step chips, no fields (user 2026-10-22).
                  const band = (
                    <tr className={`load-band${open ? "" : " done"}`}>
                      <td colSpan={8}>
                        <div className="band-cells">
                          <span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: dotOf(st.key), display: "inline-block" }} />
                          <strong>{titleOf(d, i)}</strong>
                          {d.capture.name?.trim() && <span className="mono dim">· {codeOf(d, i)}</span>}
                          {open ? (
                            <>
                              {sum && <span className="mono dim">{sum}</span>}
                              {fillText && <span className="mono dim" style={{ color: totals[i].over ? "var(--c-amber)" : undefined }} title="Share of this container">{fillText}</span>}
                            </>
                          ) : (
                            b && <span className="mono dim">{[b.containerNumber, b.vehicleNumber, b.electronicSeal].filter(Boolean).join(" · ")}{b.dispatchDate ? ` · dispatched ${b.dispatchDate.slice(0, 10)}` : ""}</span>
                          )}
                        </div>
                      </td>
                      {/* ✕ then the "+" (user 2026-10-22: "Add the plus button after the X"), same column as the rows' ✕. */}
                      <td className="nw">
                        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          {rm && (
                            <button type="button" className="btn x" aria-label={d.boxId ? `Delete ${titleOf(d, i)}` : `Remove ${titleOf(d, i)}`} title={d.boxId ? "Delete this loading" : "Remove this container"} onClick={rm}>
                              <Icon name="x" size={13} />
                            </button>
                          )}
                          {/* CR-374 round 2: ONE "+" menu (CR-155 style) — container & vehicle, Dispatch, documents. */}
                          {(open || b) && (
                            <MoreMenu
                              kebab
                              icon="plus"
                              title="Container actions"
                              items={[
                                ...(open ? [{ label: "Container & vehicle…", disabled: locked, title: locked ? "Pick a design first" : undefined, onClick: () => setDetailsFor(d.key) }] : []),
                                ...(b && open ? [{ label: "Dispatch", disabled: busy || !!gate, title: gate || undefined, onClick: () => void dispatch(d) }] : []),
                                ...(b ? docItems(b, entriesOf(d), allLines, () => navigate(detailUrl(b.id))).map(({ label, onClick }) => ({ label, onClick })) : []),
                              ]}
                            />
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                  // CR-374: Add Items in Bulk sits UNDER the design rows (user 2026-10-22).
                  const after = open && (
                    <tr className="hint-row">
                      <td colSpan={9}>
                        <button type="button" className="btn" onClick={() => setSheetPicker((p) => ({ ...p, [d.key]: "all" }))}>
                          <Icon name="plus" size={12} /> Add Items in Bulk
                        </button>
                      </td>
                    </tr>
                  );
                  return (
                    <ContainerRows
                      key={d.key}
                      draft={d}
                      pick={pick}
                      otherUse={useOfOthers(d.key)}
                      patch={(p) => patchDraft(d.key, p)}
                      open={open}
                      loadedRows={d.boxId ? loadedRowsOf(d, open, false) : undefined}
                      loadedItems={loadedGroupsOf(d).filter((ls) => ls.some((l) => keptOf(l) > 0)).length}
                      planFor={(band) => slicesFor(d.key, band)}
                      onChoose={(band, slice) => claimPlan(d.key, band, slice)}
                      onFill={(band, slice) => fillFromPlan(d.key, band, slice)}
                      picker={sheetPicker[d.key] || ""}
                      setPicker={(v) => setSheetPicker((p) => ({ ...p, [d.key]: v }))}
                      band={band}
                      after={after}
                      indexed={false}
                    />
                  );
                })}
                <tr>
                  <td colSpan={9} style={{ height: 44 }}>
                    <button type="button" className="btn dashed" style={{ color: "var(--accent)", fontWeight: 600 }} onClick={addDraft}>
                      <Icon name="plus" size={12} /> Add container
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Total · {drafts.length} container{drafts.length === 1 ? "" : "s"} <span className="dim" style={{ fontWeight: 400 }}>· {fmt(drafts.reduce((n, d) => n + new Set(totals[drafts.indexOf(d)].picked.map(rowKeyOf)).size + loadedGroupsOf(d).filter((ls) => ls.some((l) => keptOf(l) > 0)).length, 0))} items</span></td>
                  <td /><td />
                  <td className="num">{fmt(grand.pallets + drafts.reduce((s, d) => s + sumPallets(keptOfDraft(d)), 0))}</td>
                  <td className="num">{fmt(grand.boxes + loadedGrand)}</td>
                  <td colSpan={4} className="dim" style={{ fontWeight: 400 }}>Stock is shared across containers</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {dups.map((d) => (
        <Note key={`${d.boxId}|${d.field}`} tone="warn">
          <span>{d.field} <span className="mono">{d.value}</span> is already recorded on <span className="mono">{d.otherLabel}</span>.</span>
        </Note>
      ))}

      <div className="session-foot">
        <span className="mono dim" style={{ flex: 1, fontSize: "var(--t-sm)", color: footerError ? "var(--c-red)" : undefined }}>
          {footerError ||
            (emptyAt >= 0 && !editing ? `Add at least one item to C${emptyAt + 1}` : `${drafts.length} container${drafts.length === 1 ? "" : "s"} · ${fmt(grand.pallets + drafts.reduce((s, d) => s + sumPallets(keptOfDraft(d)), 0))} pallets · ${fmt(grand.boxes + loadedGrand)} boxes`)}
        </span>
        <button className="btn" onClick={back} disabled={busy}>Cancel</button>
        <button className="hbtn primary" disabled={busy || emptyAt >= 0 || !!loadedError} onClick={() => void save()}>
          <Icon name="check" size={13} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {custSearch && <CustomerSearchModal onPick={(c) => pick.pickCustomer(c.id)} onClose={() => setCustSearch(false)} />}
      {detailsFor !== null && (() => {
        const i = drafts.findIndex((d) => d.key === detailsFor);
        const d = drafts[i];
        return d ? (
          <ContainerDetailsModal
            title={`${titleOf(d, i)} · Container & vehicle`}
            vehicle={d.vehicle}
            capture={d.capture}
            fill={totals[i].fill > 0 ? `${Math.round(totals[i].fill * 100)}% of a container${totals[i].over ? " — over" : ""}` : ""}
            onDone={(vehicle, capture) => { patchDraft(d.key, { vehicle, capture }); setDetailsFor(null); }}
            onClose={() => setDetailsFor(null)}
          />
        ) : null;
      })()}
      {entryOverlay && (
        <DispatchEntryOverlay
          box={boxes.find((b) => b.id === entryOverlay.box.id) ?? entryOverlay.box}
          entries={entryOverlay.entries}
          onClose={() => setEntryOverlay(null)}
        />
      )}
    </div>
  );
}

/** CR-374: one container's Container & vehicle details — the tabs rail's field set in a modal, opened from the
    Sheet band's "+ Container & vehicle". Edits a local copy; Save hands it back, Cancel drops it. */
function ContainerDetailsModal({ title, vehicle: v0, capture: c0, fill, onDone, onClose }: {
  title: string;
  vehicle: VehicleDraft;
  capture: LoadingCapture;
  fill: string;
  onDone: (vehicle: VehicleDraft, capture: LoadingCapture) => void;
  onClose: () => void;
}) {
  // ponytail: local copy so Cancel is free; no dirty prompt.
  const [vehicle, setVehicle] = useState(v0);
  const [capture, setCapture] = useState(c0);
  const setVeh = (k: keyof VehicleDraft, v: string) => setVehicle((c) => ({ ...c, [k]: v }));
  const setCap = (k: keyof LoadingCapture, v: string) => setCapture((c) => ({ ...c, [k]: v }));
  const panelRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1, fontWeight: 600 }}>{title}</div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div className="form-rows one">
            <LoadDetailsFields vehicle={vehicle} capture={capture} setVeh={setVeh} setCap={setCap} part="format" />
            {fill && <span className="mono dim" style={{ gridColumn: "span 2", fontSize: "var(--t-sm)" }}>{fill}</span>}
            <LoadDetailsFields vehicle={vehicle} capture={capture} setVeh={setVeh} setCap={setCap} part="rail" />
          </div>
        </div>
        <div className="df-foot">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="hbtn primary" onClick={() => onDone(vehicle, capture)}><Icon name="check" size={13} /> Save</button>
        </div>
      </div>
    </div>
  );
}

/** Documents of a saved container — ONE list for the tab's button row and the Sheet band's menu. */
function docItems(box: LoadBox, entries: Entry[], allLines: PalPlanLine[], onSheet?: () => void): { label: string; icon: string; onClick: () => void }[] {
  return [
    ...(onSheet ? [{ label: "Loading Sheet", icon: "docs", onClick: onSheet }] : []),
    { label: "Dispatch Copy", icon: "invoice", onClick: () => void import("./dispatchCopyPdf").then((m) => m.downloadDispatchCopyPdf(box, entries)) },
    { label: "Pallet QR labels", icon: "qr", onClick: () => void import("./palletQrPdf").then((m) => m.downloadPalletQrPdf(box, entries)) },
    { label: "Packing Report", icon: "printer", onClick: () => void import("./packingReportPdf").then((m) => m.downloadPackingReportForLines(entries.map((e) => e.l), allLines)) },
  ];
}

/** The row engine shared by the tab sheet and Sheet mode (CR-335): pick rows over the stock the OTHER
    containers left, the blank row that appends itself, the per-batch picker and the plan hints. Owns only the
    rows' view state; picks, details and pallet metas live in the parent's draft. Returns <tr>s (+ the picker,
    portaled). `band` = the leading row(s) Sheet mode puts above a container's rows; `after` = the row(s) it
    puts right under its design rows, before the plan hints (CR-374: Add Items in Bulk). */
function ContainerRows({ draft, pick, otherUse, patch, open, loadedRows, loadedItems = 0, planFor, onChoose, onFill, picker, setPicker, band, after, indexed = true }: {
  draft: ContainerDraft;
  pick: ReturnType<typeof useSessionPick>;
  otherUse: Map<string, number>;
  patch: (p: DraftPatch) => void;
  open: boolean;
  loadedRows?: ReactNode;
  /** Edit: loaded items still kept (numbering + totals). */
  loadedItems?: number;
  planFor: (band: SoBand) => PlanPick;
  onChoose: (band: SoBand, slice?: PlanSlice) => void;
  onFill: (band: SoBand, slice: PlanSlice) => Map<string, number>;
  /** The batch picker: "" closed, "all" = Add Items in Bulk, else the DesignRow.key of the row whose batches it edits. */
  picker: string;
  setPicker: (v: string) => void;
  band?: ReactNode;
  after?: ReactNode;
  /** Tab sheet: a leading running-number column. Sheet mode (false): no leading column — the band row names the container (CR-374). */
  indexed?: boolean;
}) {
  // Sheet rows. The boxes live in draft.qty (per line); a row only names its item.
  const [rows, setRows] = useState<ItemRow[]>([{ key: 0, ...BLANK }]);

  // This container's view of the stock: the others' picks are gone (lines CLONED — use these rows throughout).
  const bands = useMemo(() => scopeBands(pick.bands, otherUse), [pick.bands, otherUse]);
  const allBands = useMemo(() => scopeBands(pick.allBands, otherUse), [pick.allBands, otherUse]);
  // Rows resolve over EVERY band — the Customer filter only narrows the pick lists (CR-252).
  const designRows = useMemo(() => new Map(allBands.flatMap((b) => b.designs).map((r) => [r.key, r])), [allBands]);
  const bandOfRow = useMemo(() => new Map(allBands.flatMap((b) => b.designs.map((r) => [r.key, b]))), [allBands]);
  const qty = draft.qty;
  const merge = (m: Map<string, number>) => patch((d) => ({ qty: new Map([...d.qty, ...m]) }));
  const setDesign = (row: DesignRow, v: number, skip?: Set<string>) => merge(spreadQty(openLines(row), v, skip));
  /** Pallets typed on the sheet (CR-258): whole pallets, oldest batch first. */
  const setDesignPallets = (row: DesignRow, p: number, skip?: Set<string>) => merge(spreadPallets(openLines(row), p, skip));
  const setMeta = (rowKey: string, m: PalletMeta) => patch((d) => ({ meta: new Map(d.meta).set(rowKey, { ...d.meta.get(rowKey), ...m }) }));

  const taken = new Set(rows.map((r) => r.rowKey).filter(Boolean));
  const nextKey = () => rows.reduce((m, r) => Math.max(m, r.key), 0) + 1;
  const patchRow = (key: number, p: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const rowQty = (dr: DesignRow) => openLines(dr).reduce((s, l) => s + (qty.get(l.id) || 0), 0);
  const release = (r: ItemRow) => {
    const dr = designRows.get(r.rowKey);
    if (dr) setDesign(dr, 0);
  };
  /** Picking an item prefills everything it has ready (for this container). */
  const setItem = (r: ItemRow, rowKey: string) => {
    release(r);
    const dr = rowKey && !taken.has(rowKey) ? designRows.get(rowKey) : undefined;
    if (dr) setDesign(dr, dr.ready);
    patchRow(r.key, { rowKey: dr ? rowKey : "", off: [] });
  };
  const removeRow = (r: ItemRow) => {
    release(r);
    setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [{ key: nextKey(), ...BLANK }]));
  };
  // The sheet always ends in one blank row (CR-326) — no "Add New Row" button.
  useEffect(() => {
    if (open && rows.every((r) => r.rowKey)) setRows((rs) => [...rs, { key: rs.reduce((m, r) => Math.max(m, r.key), 0) + 1, ...BLANK }]);
  }, [rows, open]);
  /** Shows `keys` as rows: blank rows give way, an item already on a row is not repeated; `off` re-derived from the picks. */
  const addRows = (keys: string[], qtyOf: (lineId: string) => number = () => 1) => {
    let k = nextKey();
    // Nothing chosen = nothing left out (a row always has batches to draw on).
    const offOf = (rowKey: string) => {
      const ls = openLines(designRows.get(rowKey)!);
      const off = ls.filter((l) => qtyOf(l.id) <= 0).map((l) => l.id);
      return off.length === ls.length ? [] : off;
    };
    const uniq = [...new Set(keys)].filter((rowKey) => designRows.has(rowKey));
    setRows((rs) => [
      ...rs.filter((r) => r.rowKey).map((r) => (uniq.includes(r.rowKey) ? { ...r, off: offOf(r.rowKey) } : r)),
      ...uniq.filter((rowKey) => !taken.has(rowKey)).map((rowKey) => ({ key: k++, rowKey, off: offOf(rowKey) })),
    ]);
  };
  /** The picker's Apply: its WHOLE scope is rewritten — a batch left out goes back to 0. */
  const applyPicks = (scope: DesignRow[], picks: { rowKey: string; lineId: string; boxes: number }[]) => {
    const want = new Map(picks.map((p) => [p.lineId, p.boxes]));
    merge(new Map(scope.flatMap((dr) => openLines(dr).map((l) => [l.id, Math.max(0, Math.min(l.boxes, want.get(l.id) || 0))] as [string, number]))));
    // A one-item scope re-derives that row even when everything was deselected.
    addRows([...picks.map((p) => p.rowKey), ...(scope.length === 1 ? [scope[0].key] : [])], (id) => want.get(id) || 0);
    setPicker("");
  };
  const fill = (band: SoBand, slice: PlanSlice) => {
    const m = onFill(band, slice);
    addRows(band.designs.filter((row) => openLines(row).some((l) => (m.get(l.id) || 0) > 0)).map((row) => row.key), (id) => m.get(id) || 0);
  };

  return (
    <>
      {band}
      {/* Already loaded (edit), one row per item: fewer PALLETS sends the rest back to Ready for Loading; ✕ / 0 unloads. */}
      {loadedRows}

      {open && rows.map((r, i) => {
        const dr = designRows.get(r.rowKey);
        const soBand = bandOfRow.get(r.rowKey);
        const skip = new Set(r.off);
        const v = dr ? rowQty(dr) : 0;
        const max = dr ? openLines(dr).reduce((n, l) => n + (skip.has(l.id) ? 0 : l.boxes), 0) : 0;
        const used = dr ? openLines(dr).filter((l) => (qty.get(l.id) || 0) > 0) : [];
        const usedParts = used.map((l) => ({ l, n: qty.get(l.id)! }));
        const maxPallets = dr ? openLines(dr).reduce((n, l) => n + (skip.has(l.id) ? 0 : palletsOfLine(l.boxes, l.boxesPerPallet)), 0) : 0;
        const mix = mixBatchOf(used.length ? used : dr ? openLines(dr) : []);
        const meta = draft.meta.get(r.rowKey);
        return (
          <tr key={r.key}>
            {indexed && <td className="mono dim">{loadedItems + i + 1}</td>}
            <td>
              <Combobox
                value={r.rowKey}
                options={itemOptions(bands, new Set([...taken].filter((k) => k !== r.rowKey)))}
                onChange={(k) => setItem(r, k)}
                placeholder={dr ? "" : "Type or pick a design with ready pallets…"}
                ariaLabel="Design"
                emptyText={bands.length === 0 ? "Nothing ready for loading. See the note above" : "Every ready item is already on a row"}
              />
            </td>
            <td className="mono dim nw" style={{ fontSize: "var(--t-sm)" }} title={[soBand?.customerName, soBand?.soNumber].filter(Boolean).join(" · ")}>{soBand?.poNumber || soBand?.soNumber || (dr ? "—" : "")}</td>
            <td>
              <input
                readOnly
                disabled={!dr}
                aria-label="Batch"
                aria-haspopup="dialog"
                title={dr ? `Choose batches and pallets${mix ? "\nMXBATCH: a pallet here is shared with another batch/item" : ""}` : undefined}
                value={dr ? `${batchSummary(openLines(dr), v ? new Set(openLines(dr).filter((l) => !qty.get(l.id)).map((l) => l.id)) : skip)}${mix ? " · MXBATCH" : ""}` : ""}
                placeholder="—"
                style={{ cursor: dr ? "pointer" : undefined }}
                onClick={() => dr && setPicker(r.rowKey)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && dr && setPicker(r.rowKey)}
              />
            </td>
            <td className="num" title={dr ? `${fmt(maxPallets)} pallets · ${fmt(max)} boxes ready` : undefined}>
              <NumberInput
                maxDecimals={0}
                value={dr && v ? String(sumPallets(usedParts)) : ""}
                placeholder="0"
                disabled={!dr}
                aria-label="Pallets"
                onChange={(e) => dr && setDesignPallets(dr, Number(e.target.value) || 0, skip)}
                style={{ textAlign: "right" }}
              />
            </td>
            <td className="num" title={dr && v ? boxesHint(usedParts) : undefined}>{dr && v ? fmt(v) : ""}</td>
            <td><input value={meta?.palletNo ?? ""} placeholder={dr ? "auto" : ""} disabled={!dr} aria-label="Pallet No." onChange={(e) => setMeta(r.rowKey, { palletNo: e.target.value })} /></td>
            <td><input value={meta?.palletType ?? ""} placeholder={dr ? "—" : ""} disabled={!dr} aria-label="Pallet type" onChange={(e) => setMeta(r.rowKey, { palletType: e.target.value })} /></td>
            <td className="dim">{dr ? pick.brandName(dr.brandId) || "—" : ""}</td>
            <td><button className="btn x" title={dr ? "Remove row" : "Clear row"} onClick={() => removeRow(r)}><Icon name="x" size={13} /></button></td>
          </tr>
        );
      })}

      {after}

      {/* Container Planning (CR-255/301/336): pick WHICH planned container this one fills — a helper, never a gate.
          Options name the format, pallets and boxes; Sent / claimed containers stay listed, marked. */}
      {open && bands.flatMap((soBand) => {
        const { slices, chosen, of } = planFor(soBand);
        if (!slices.length) return [];
        const verdict = (s: PlanSlice & { takenBy: string }) =>
          s.takenBy ? `Claimed by ${s.takenBy}` : s.status === "Sent" ? "Sent" : s.status === "Partial" ? "Partially sent" : "Planned";
        const perDesign = (s: PlanSlice) => s.lines.map((ln) => `${ln.pallets}P${ln.palletName ? ` ${ln.palletName}` : ""} · ${fmt(ln.boxes)} ${ln.design}`).join("  ·  ");
        return [
          <tr key={`hint-${soBand.salesOrderId}`} className="hint-row">
            <td colSpan={indexed ? 10 : 9}>
              <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Icon name="package" size={13} />
                <span><span className="mono">{bandLabel(soBand)}</span> · container plan ({of}):</span>
                <Combobox
                  className="dial"
                  ariaLabel="Plan container"
                  placeholder="Pick a container…"
                  value={chosen ? String(chosen.ci) : ""}
                  onChange={(v) => onChoose(soBand, v === "" ? undefined : slices.find((s) => String(s.ci) === v))}
                  options={slices.map((s) => ({
                    value: String(s.ci),
                    label: `C${s.no} · ${s.containerFormatName || "—"} · ${s.pallets} pallets · ${fmt(s.boxes)} boxes`,
                    hint: perDesign(s),
                    badge: verdict(s),
                  }))}
                />
                {chosen && <span className="dim">{perDesign(chosen)}</span>}
                <button className="btn" disabled={!chosen} onClick={() => chosen && fill(soBand, chosen)}>Fill from plan</button>
              </span>
            </td>
          </tr>,
        ];
      })}

      {picker && createPortal((() => {
        const one = picker === "all" ? undefined : designRows.get(picker);
        const scope = one ? allBands.flatMap((b) => (b.designs.includes(one) ? [{ ...b, designs: [one] }] : [])) : bands;
        return (
          <BulkLoadItemsModal
            bands={scope}
            initial={qty}
            title={one ? `Batches · ${one.designLabel}` : undefined}
            onClose={() => setPicker("")}
            onAdd={(picks) => applyPicks(scope.flatMap((b) => b.designs), picks)}
          />
        );
      })(), document.body)}
    </>
  );
}

/** One container TAB (CR-326): header (title · status · fill · Add Items in Bulk), the sheet (`ContainerRows`),
    the Documents row, and the rail with this container's vehicle & seals + Dispatch. */
function ContainerSection({ draft, title, status, box, entries, allLines, open, totals, pick, otherUse, patch, planFor, onChoose, onFill, loadedRows, loadedItems = 0, dispatchGate: gate, onDispatch, onSheet, busy , locked }: {
  draft: ContainerDraft;
  title: string;
  status: { key: string; label: string; cls: string };
  box?: LoadBox;
  entries: Entry[];
  allLines: PalPlanLine[];
  open: boolean;
  totals: Totals;
  pick: ReturnType<typeof useSessionPick>;
  otherUse: Map<string, number>;
  patch: (p: DraftPatch) => void;
  planFor: (band: SoBand) => PlanPick;
  onChoose: (band: SoBand, slice?: PlanSlice) => void;
  onFill: (band: SoBand, slice: PlanSlice) => Map<string, number>;
  loadedRows?: ReactNode;
  /** Edit: loaded items still kept (the totals row's "items"). */
  loadedItems?: number;
  dispatchGate: string | null;
  onDispatch?: () => void;
  onSheet?: () => void;
  busy: boolean;
  /** CR-350/351: no item yet — step 2 (container, vehicle & seals) stays hidden. */
  locked: boolean;
}) {
  const [picker, setPicker] = useState("");
  const setCap = (k: keyof LoadingCapture, v: string) => patch((d) => ({ capture: { ...d.capture, [k]: v } }));
  const setVeh = (k: keyof VehicleDraft, v: string) => patch((d) => ({ vehicle: { ...d.vehicle, [k]: v } }));
  const fillText = totals.fill > 0 ? `${Math.round(totals.fill * 100)}% of a container` : "";

  return (
    <div className="card ctab-body">
      <div className="load-main">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>{title}</span>
          <span className={`chip ${status.cls}`}>{status.label}</span>
          {fillText &&<span className="mono nw dim" style={{ color: totals.over ? "var(--c-amber)" : undefined }} title="Share of this container">{fillText}</span>}
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {open && (
              <button className="btn" onClick={() => setPicker("all")}>
                <Icon name="plus" size={12} /> Add Items in Bulk
              </button>
            )}
          </span>
        </div>

        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="tbl load-sheet" aria-label={`${title} sheet`}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Design</th>
                <th style={{ width: 130 }}>PO</th>
                <th style={{ width: 150 }}>Batch</th>
                <th className="num" style={{ textAlign: "right", width: 90 }}>Pallets</th>
                <th className="num" style={{ textAlign: "right", width: 80 }}>Boxes</th>
                <th style={{ width: 110 }}>Pallet No.</th>
                <th style={{ width: 110 }}>Pallet type</th>
                <th style={{ width: 130 }}>Box Brand</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              <ContainerRows
                draft={draft}
                pick={pick}
                otherUse={otherUse}
                patch={patch}
                open={open}
                loadedRows={loadedRows}
                loadedItems={loadedItems}
                planFor={planFor}
                onChoose={onChoose}
                onFill={onFill}
                picker={picker}
                setPicker={setPicker}
              />
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>Total <span className="dim" style={{ fontWeight: 400 }}>· {fmt(new Set(totals.picked.map(rowKeyOf)).size + loadedItems)} items</span></td>
                <td /><td />
                <td className="num">{fmt(totals.pallets)}</td>
                <td className="num">{fmt(totals.boxes)}</td>
                <td colSpan={4} className="dim" style={{ fontWeight: 400 }}>{open ? "Pallets drive Boxes · the Batch cell splits per batch" : ""}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {box && !open && <Note tone="ok" style={{ margin: 0 }}>Dispatched{box.dispatchDate ? ` on ${box.dispatchDate.slice(0, 10)}` : ""}.</Note>}
        {box && (
          <div>
            <div className="rail-title" style={{ marginBottom: 6 }}>Documents · {title}</div>
            <div className="load-docs">
              {docItems(box, entries, allLines, onSheet).map((it) => (
                <button key={it.label} className="btn" onClick={it.onClick}><Icon name={it.icon} size={13} /> {it.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="load-rail">
        <span className="rail-title">Container &amp; vehicle · {title}</span>
        {/* CR-354: step 2 waits for step 1 — hidden (not greyed) until the container has an item; container pick first. */}
        {locked ? (
          <Note tone="info" style={{ margin: 0 }}>Pick a design in the sheet first — container, vehicle and seals come next.</Note>
        ) : (
          <div className="form-rows one">
            <LoadDetailsFields vehicle={draft.vehicle} capture={draft.capture} setVeh={setVeh} setCap={setCap} part="format" />
            <LoadDetailsFields vehicle={draft.vehicle} capture={draft.capture} setVeh={setVeh} setCap={setCap} part="rail" />
          </div>
        )}
        {onDispatch && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            <button className="hbtn primary" style={{ justifyContent: "center", height: 34 }} disabled={busy || !!gate} onClick={onDispatch} title={gate || "Dispatch this container"}>
              <Icon name="check" size={13} /> Dispatch {title}
            </button>
            {gate && <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{gate}</span>}
          </div>
        )}
        <span className="dim" style={{ fontSize: "var(--t-xs)" }}>Status follows the data: items → In Loading · container no. or seal → Ready for Dispatch · Dispatch → Dispatched</span>
      </div>
    </div>
  );
}
