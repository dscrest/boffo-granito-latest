/* ============================================================
   Loading Session — ONE scrolling page for New Loading AND the loading
   detail's Edit (no steps since 2026-09-21; CR-203's stepper is gone):
   laid out like a Sales Order form (CR-247), N containers since CR-301:
     Customer          Combobox on top — an optional FILTER (CR-252): blank = every customer's
                       stock, a container may mix customers
     Container 1…N     one SECTION per container (CR-301), "+ Add Container" below them:
       header          "Container k" · Container Master format (sets this container's fill %,
                       saved as LoadBox.container_format) · fill % · ✕
       Item Table      palletized Ready-for-Loading stock only: ONE row per item (CR-256) — its
                       batches combined; the Batches cell opens the batch picker (boxes per batch),
                       Pallets typed on the row drain the chosen batches oldest first;
                       Add New Row + Add Items in Bulk; (edit) loaded items are its first rows.
                       Stock is SHARED across sections: what one container picked is gone from the
                       others (pure `scopeBands`), so one item can be split 10 + 20 pallets.
       Totals row      under the Boxes / Pallets columns + this container's fill % (CR-253)
       Plan hint       per order: the next planned container no other section claimed + Fill from
                       plan — fills THIS container only (CR-255/301)
       Tabs            Loading Details | Vehicle Details — each container has its own vehicle
   One Save runs it all in order: vehicles → per container (mint the LoadBox → add pallets,
   a partial load's Ready remainder re-targeted for the next container) → sibling link
   (`LoadPlan.group`, primary patched last) → edit: unload / shrink → load details. It stops at
   the first failure; what already saved stays saved and the page reloads for a retry.
   Edit (`/loading/:id/session`) is ONE section — the box. A dispatched loading shows its
   details only (the server keeps those editable; its lines are immutable).
   Routes: /loading/new[?so=<id>] and /loading/:id/session.
   The ruled Loading Sheet lives on /loading/:id, not here.
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Combobox } from "@/ui/Combobox";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { tabStyle } from "@/features/common/RecordDetail";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { resolveVehicle } from "@/features/masters/vehiclesApi";
import { LoadDetailsFields, blankDetails, captureOf, type VehicleDraft } from "./LoadDetailsFields";
import { useContainerFormats, type ContainerFormatRow } from "@/features/masters/containerFormatsApi";
import { BulkLoadItemsModal } from "./BulkLoadItemsModal";
import {
  bandLabel, batchLabel, batchSummary, itemOptions, loadPlanJson, openLines, palletSplit, palletsOfLine, pickEntries, pickTotals, planFill,
  readyLabel, scopeBands, spreadPallets, spreadQty, type DesignRow, type SoBand,
} from "./newLoadingRows";
import { useSessionPick } from "./SessionItemsStep";
import { unsentPlanContainers, type PlanSlice } from "./containerPlanPrefill";
import { UNLOAD, resolveLoadSheetEdit, type LoadSheetDraft } from "./loadSheetEdit";
import { duplicateSeals } from "./sealChecks";
import {
  boxFill,
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
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
/** One row per item (CR-256): its batches combined; `off` = its batches the batch picker left out. */
interface ItemRow { key: number; /** DesignRow.key */ rowKey: string; off: string[] }
const BLANK = { rowKey: "", off: [] as string[] };
const sumPallets = (parts: { l: PalPlanLine; n: number }[]) => parts.reduce((s, x) => s + palletsOfLine(x.n, x.l.boxesPerPallet), 0);
const palletNames = (ls: PalPlanLine[]) => [...new Set(ls.map((l) => l.palletName).filter(Boolean))].join(" / ");
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

/** One container of the save (CR-301): its picks (boxes per PalPlanLine id), its details, and the
    SO-plan container it was filled from (per SO — a container may mix orders). */
interface ContainerDraft {
  key: number;
  qty: Map<string, number>;
  capture: LoadingCapture;
  vehicle: VehicleDraft;
  plan: Record<string, number>;
}
const newDraft = (key: number, seed = blankDetails()): ContainerDraft => ({ key, qty: new Map(), plan: {}, ...seed });
type DraftPatch = Partial<ContainerDraft> | ((d: ContainerDraft) => Partial<ContainerDraft>);
type Totals = ReturnType<typeof pickTotals>;

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
  // Keyed by box: the details form seeds once from it.
  return <SessionPage key={box?.id || NEW} box={box} plans={plans} boxes={boxes} presetSalesOrderId={box ? undefined : params.get("so") || undefined} reload={load} />;
}

function SessionPage({ box, plans, boxes, presetSalesOrderId, reload }: {
  box?: LoadBox; plans: PalPlan[]; boxes: LoadBox[]; presetSalesOrderId?: string; reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const open = !box || box.status === "Open";
  const formats = useContainerFormats();
  const pick = useSessionPick({ plans, boxes, box, presetSalesOrderId, anyCustomer: true, onSaved: () => undefined });
  // The containers (CR-301). Edit = exactly one, seeded from the box. Keys are monotonic, never the index.
  const [drafts, setDrafts] = useState<ContainerDraft[]>(() => [newDraft(0, box ? blankDetails(box, captureOf(box)) : undefined)]);
  const patchDraft = (key: number, p: DraftPatch) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...(typeof p === "function" ? p(d) : p) } : d)));
  const addDraft = () => setDrafts((ds) => [...ds, newDraft(ds.reduce((m, d) => Math.max(m, d.key), 0) + 1)]);
  const removeDraft = (key: number) => setDrafts((ds) => (ds.length > 1 ? ds.filter((d) => d.key !== key) : ds));
  // Loaded lines: typed qty per line id ("0" = remove).
  const [loadedDraft, setLoadedDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loaded = pick.boxLines;
  const draftOf = (l: PalPlanLine): LoadSheetDraft | undefined => {
    const v = loadedDraft[l.id];
    if (v == null || v.trim() === "") return undefined;
    return parseInt(v, 10) === 0 ? { boxId: UNLOAD } : { qty: v };
  };
  const loadedOps = loaded.map((l) => ({ l, ...resolveLoadSheetEdit(l, box, [], draftOf(l)) }));
  const loadedError = loadedOps.find((o) => o.error)?.error || "";
  // Loaded lines shown one row per item too; a typed total is kept oldest batch first (per-line drafts underneath).
  const keptOf = (l: PalPlanLine) => {
    const n = parseInt(loadedDraft[l.id] ?? "", 10);
    return n >= 0 ? Math.min(n, l.boxes) : l.boxes;
  };
  const loadedGroups = [...loaded.reduce((m, l) => {
    const k = `${l.salesOrderId}|${l.designId}`;
    return m.set(k, [...(m.get(k) ?? []), l]);
  }, new Map<string, PalPlanLine[]>()).values()].map((ls) => [...ls].sort((a, b) => a.createdTime.localeCompare(b.createdTime)));
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
  const kept = loaded.map((l) => ({ l, n: keptOf(l) })).filter((x) => x.n > 0);
  const loadedFill = (d: ContainerDraft) => {
    const c = formats.find((f) => f.id === d.capture.container_format)?.totalBoxes || 0;
    return c ? kept.reduce((s, x) => s + x.n / c, 0) : boxFill(kept.map((x) => ({ ...x.l, boxes: x.n })));
  };
  // qty is what counts here; the unscoped bands are fine (pickTotals never reads a line's boxes).
  const totals = drafts.map((d) => pickTotals(pick.allBands, d.qty, capOf(d), box ? loadedFill(d) : 0));

  // Plan as a helper (CR-255): per order, the first unsent planned container no OTHER section claimed.
  const hintFor = (key: number, band: SoBand): (PlanSlice & { of: number }) | undefined => {
    const slices = unsentPlanContainers(band.salesOrderId, pick.planBySo, plans, boxes, pick.designIdOf);
    const slice = slices.find((s) => !drafts.some((d) => d.key !== key && d.plan[band.salesOrderId] === s.ci));
    return slice && { ...slice, of: pick.planBySo.get(band.salesOrderId)!.plan.containers.length };
  };
  /** Fill ONE container from a planned one: its boxes FIFO over the (scoped) band, claim the plan
      container, and start on the plan's format while the Container field is blank (CR-274). */
  const fillFromPlan = (key: number, band: SoBand, slice: PlanSlice): Map<string, number> => {
    const m = planFill(slice.lines, band, pick.designIdOf);
    patchDraft(key, (d) => ({
      qty: new Map([...d.qty, ...m]),
      plan: { ...d.plan, [band.salesOrderId]: slice.ci },
      capture: d.capture.container_format || !slice.containerFormat ? d.capture : { ...d.capture, container_format: slice.containerFormat },
    }));
    return m;
  };
  // CR-274: a loading opened from the SO starts on the plan's container format (first section, only while blank).
  const presetBand = presetSalesOrderId && !box ? pick.bands[0] : undefined;
  const planFormat = presetBand ? hintFor(drafts[0].key, presetBand)?.containerFormat : undefined;
  useEffect(() => {
    if (planFormat) patchDraft(drafts[0].key, (d) => (d.capture.container_format ? {} : { capture: { ...d.capture, container_format: planFormat } }));
  }, [planFormat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Duplicate container no. / seals: against every saved loading AND the other sections (warn-only).
  const sealId = (d: ContainerDraft) => (box ? box.id : `new-${d.key}`);
  const dups = duplicateSeals(
    [
      ...boxes.map((b) => ({ id: b.id, label: boxLabel(b), containerNumber: b.containerNumber, electronicSeal: b.electronicSeal, lineSeal: b.lineSeal })),
      ...(box ? [] : drafts.map((d, i) => ({ id: sealId(d), label: `Container ${i + 1}`, containerNumber: "", electronicSeal: "", lineSeal: "" }))),
    ],
    Object.fromEntries(drafts.map((d) => [sealId(d), d.capture])),
    drafts.map(sealId),
  );

  const detailUrl = (bid: string) => `/loading/${encodeURIComponent(bid)}`;
  const back = () => navigate(box ? detailUrl(box.id) : "/loading");
  const typedOf = (d: ContainerDraft) => Object.fromEntries(Object.entries(d.capture).filter(([, v]) => (v || "").trim())) as LoadingCapture;

  /** Runs the whole Save in order. `go` = where to land (on an error: where a retry continues; "" = stay). */
  const run = async (): Promise<{ error: string; go: string }> => {
    if (loadedError) return { error: loadedError, go: "" };
    const vehicles: string[] = [];
    for (const d of drafts) {
      const veh = await resolveVehicle(d.vehicle);
      if (!veh.ok) return { error: veh.error || "Could not save the vehicle", go: "" };
      vehicles.push(veh.rowid || "");
    }

    if (!box) {
      const n = drafts.length;
      let first = "";
      // A partial load keeps the loaded boxes on the ORIGINAL line and splits a Ready remainder (new id):
      // the next container drawing the rest must target that remainder. original id → current id.
      const remap = new Map<string, string>();
      for (let i = 0; i < n; i++) {
        const d = drafts[i];
        const label = `Container ${i + 1}`;
        const group = i > 0 ? { id: first, no: i + 1, of: n } : undefined;
        const created = await createLoadBox({ load_plan: loadPlanJson(pick.allBands, d.qty, group), ...(vehicles[i] ? { vehicle: vehicles[i] } : {}), ...typedOf(d) });
        if (!created.ok || !created.data?.ROWID) {
          return { error: `${label}: ${created.error || "could not create the loading"}${i > 0 ? ` — containers 1…${i} were created, the rest were not` : ""}`, go: i > 0 ? "/loading" : "" };
        }
        const bid = String(created.data.ROWID);
        if (!first) first = bid;
        const picks = pickEntries(pick.allBands, d.qty);
        const res = await setLinesBox(bid, picks.map((e) => ({ ...e, lineId: remap.get(e.lineId) ?? e.lineId })));
        if (!res.ok) return { error: `${label}: ${res.error || "could not load the items"}${i > 0 ? ` — containers 1…${i} were created, the rest were not` : ""}`, go: `${detailUrl(bid)}/session` };
        res.data?.remainders?.forEach((r, j) => {
          if (r.remainder && picks[j]) remap.set(picks[j].lineId, r.remainder);
        });
      }
      if (n > 1) {
        // The primary's own slice gets its place last (its ROWID is the group id).
        const r = await updateLoadBox(first, { load_plan: loadPlanJson(pick.allBands, drafts[0].qty, { id: first, no: 1, of: n }) });
        if (!r.ok) return { error: `All ${n} loadings were created, but linking them failed: ${r.error || "error"}`, go: detailUrl(first) };
      }
      return { error: "", go: detailUrl(first) };
    }

    // Edit: the one section is the box.
    const d = drafts[0];
    if (open) {
      for (const { l, ops } of loadedOps) {
        if (!ops.unload && !ops.move) continue;
        const r = ops.unload ? await setLineBox(l.id, "") : await setLineBox(l.id, box.id, ops.move!.boxes);
        if (!r.ok) return { error: r.error || "Could not change a loaded item", go: "" };
      }
      setLoadedDraft({});
      const entries = pickEntries(pick.allBands, d.qty);
      if (entries.length) {
        const res = await setLinesBox(box.id, entries);
        if (!res.ok) return { error: res.error || "Could not load the items", go: "" };
        patchDraft(d.key, { qty: new Map() });
      }
    }
    const cur = captureOf(box);
    const patch: LoadingCapture & { vehicle?: string } = {};
    for (const k of Object.keys(cur) as (keyof LoadingCapture)[])
      if ((d.capture[k] || "") !== (cur[k] || "")) patch[k] = d.capture[k] || "";
    if (vehicles[0] && vehicles[0] !== box.vehicleId) patch.vehicle = vehicles[0];
    if (Object.keys(patch).length) {
      const r = await updateLoadBox(box.id, patch);
      if (!r.ok) return { error: r.error || "Could not save loading details", go: "" };
    }
    return { error: "", go: detailUrl(box.id) };
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const { error, go } = await run();
    invalidatePalPlans();
    if (!error) {
      toast.success(box ? "Loading saved" : drafts.length > 1 ? `${drafts.length} loadings created` : "Loading created");
      navigate(go, { replace: !box });
      return;
    }
    toast.error(error);
    await reload().catch(() => undefined);
    setBusy(false);
    // A new loading minted before the failure: carry on editing IT — a retry here would mint again.
    if (go) navigate(go, { replace: true });
  };

  const customerLocked = !pick.showRail || !open;
  const customerOptions = [
    ...pick.customers.map((c) => ({ value: c.id, label: c.name, hint: `${readyLabel(c)} ready` })),
    // A locked customer with nothing left to load is not in the ready list — still name them.
    ...(pick.customerId && !pick.customers.some((c) => c.id === pick.customerId)
      ? [{ value: pick.customerId, label: loaded[0]?.customerName || pick.customerId }]
      : []),
  ];

  // Save needs every new container to carry something; name the blank one once the user has started.
  const emptyAt = box ? -1 : totals.findIndex((t) => t.boxes === 0);
  const started = totals.some((t) => t.boxes > 0);
  const footerError = loadedError || (emptyAt >= 0 && started ? `Container ${emptyAt + 1} has no items` : "");
  const grand = totals.reduce((s, t) => ({ boxes: s.boxes + t.boxes, pallets: s.pallets + t.pallets }), { boxes: 0, pallets: 0 });

  // Edit: the already-loaded items, one row per item, as the section's first rows.
  const loadedRows = loadedGroups.map((ls) => {
    const l0 = ls[0];
    const keptParts = ls.map((l) => ({ l, n: keptOf(l) }));
    const keptN = keptParts.reduce((n, x) => n + x.n, 0);
    const touched = ls.some((l) => (loadedDraft[l.id] ?? "").trim() !== "");
    const removed = touched && keptN === 0;
    const error = loadedOps.find((o) => o.error && ls.includes(o.l))?.error;
    const batches = ls.map((l) => `${batchLabel(l)} · ${fmt(l.boxes)}`);
    const mix = mixBatchOf(ls);
    return (
      <div key={l0.id} className="ord-line qt-line load-line" style={removed ? { opacity: 0.5 } : undefined}>
        <div className="form-field"><input readOnly tabIndex={-1} value={`${l0.designLabel} · ${l0.soNumber || "—"}`} /></div>
        <div className="form-field"><input readOnly tabIndex={-1} title={batches.join("\n")} value={`${ls.length === 1 ? l0.batchNumber || "—" : `${ls.length} batches`}${mix ? " · MXBATCH" : ""}`} /></div>
        <div className="form-field" title={error || undefined}>
          <NumberInput
            maxDecimals={0}
            value={String(sumPallets(keptParts))}
            aria-label={`Pallets loaded, ${l0.designLabel}`}
            aria-invalid={!!error}
            onChange={(e) => setGroupPallets(ls, Number(e.target.value) || 0)}
            style={{ textAlign: "right", ...(error ? { borderColor: "var(--c-red)" } : {}) }}
          />
        </div>
        <div className="form-field" title={boxesHint(keptParts) || undefined}><input readOnly tabIndex={-1} style={{ textAlign: "right" }} value={fmt(keptN)} /></div>
        <div className="form-field"><input readOnly tabIndex={-1} value={palletNames(ls) || "—"} /></div>
        <div className="form-field"><input readOnly tabIndex={-1} value={pick.brandName(l0.boxBrandId || l0.soBoxBrandId || l0.customerBoxBrandId) || "—"} /></div>
        <button
          className="btn ord-rm"
          title={removed ? "Keep this item" : "Remove from this loading"}
          onClick={() => setLoadedDraft((p) => ({ ...p, ...Object.fromEntries(ls.map((l) => [l.id, removed ? "" : "0"])) }))}
        >
          <Icon name={removed ? "refresh" : "x"} size={13} />
        </button>
      </div>
    );
  });

  return (
    <div>
      {/* No page title (user 2026-09-19): the strip carries the loading's identity + Back. */}
      <nav className="steps" aria-label="Loading">
        <span style={{ fontWeight: 700 }}>{box ? "Edit Loading" : "New Loading"}</span>
        {box && <span className="mono dim nw" style={{ marginLeft: "auto" }}>{boxLabel(box)}{new Set(loaded.map((l) => l.customerId)).size === 1 && loaded[0].customerName ? ` · ${loaded[0].customerName}` : ""}</span>}
        <button className="hbtn" style={box ? undefined : { marginLeft: "auto" }} onClick={back}>
          <Icon name="chev-l" size={13} /> {box ? "Back to loading" : "Back to Loading"}
        </button>
      </nav>

      <div className="form-section">
        <div className="form-rows">
          <label className="form-field span2">
            <span className="lbl">Customer</span>
            <Combobox
              value={pick.customerId}
              options={customerOptions}
              onChange={pick.pickCustomer}
              placeholder="All customers"
              ariaLabel="Customer"
              disabled={customerLocked}
            />
          </label>
        </div>
      </div>

      {drafts.map((d, i) => (
        <ContainerSection
          key={d.key}
          draft={d}
          title={box ? boxLabel(box) : `Container ${i + 1}`}
          loadingNo={box ? boxLabel(box) : "Auto"}
          open={open}
          totals={totals[i]}
          formats={formats}
          pick={pick}
          otherUse={useOfOthers(d.key)}
          patch={(p) => patchDraft(d.key, p)}
          onRemove={!box && drafts.length > 1 ? () => removeDraft(d.key) : undefined}
          hintFor={(band) => hintFor(d.key, band)}
          onFill={(band, slice) => fillFromPlan(d.key, band, slice)}
          loadedRows={box ? loadedRows : undefined}
          loadedItems={new Set(kept.map((x) => `${x.l.salesOrderId}|${x.l.designId}`)).size}
        />
      ))}
      {!box && (
        <button className="btn" style={{ marginBottom: 14 }} onClick={addDraft}>
          <Icon name="plus" size={12} /> Add Container
        </button>
      )}

      {dups.map((d) => (
        <div key={`${d.boxId}|${d.field}`} className="card" role="alert" style={{ marginTop: 10, padding: "9px 12px", display: "flex", gap: 8, alignItems: "center", borderColor: "var(--c-amber)", color: "var(--c-amber)" }}>
          <Icon name="alert" size={14} />
          <span>{d.field} <span className="mono">{d.value}</span> is already recorded on <span className="mono">{d.otherLabel}</span>.</span>
        </div>
      ))}

      <div className="session-foot">
        <span className="mono dim" style={{ flex: 1, fontSize: "var(--t-sm)", color: footerError ? "var(--c-red)" : undefined }}>
          {footerError || (drafts.length > 1 ? `${drafts.length} containers · ${fmt(grand.pallets)} pallets · ${fmt(grand.boxes)} boxes` : "")}
        </span>
        <button className="btn" onClick={back} disabled={busy}>Cancel</button>
        <button className="hbtn primary" disabled={busy || (!box && emptyAt >= 0) || !!loadedError} onClick={() => void save()}>
          <Icon name="check" size={13} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** One container of the page (CR-301): header (title · Container format · fill % · ✕), its Item Table
    over the stock the OTHER containers left, its plan hints, its Loading / Vehicle Details tabs.
    Owns only view state (rows, picker, tab); the picks + details live in the parent's draft. */
function ContainerSection({ draft, title, loadingNo, open, totals, formats, pick, otherUse, patch, onRemove, hintFor, onFill, loadedRows, loadedItems = 0 }: {
  draft: ContainerDraft;
  title: string;
  loadingNo: string;
  open: boolean;
  totals: Totals;
  formats: ContainerFormatRow[];
  pick: ReturnType<typeof useSessionPick>;
  otherUse: Map<string, number>;
  patch: (p: DraftPatch) => void;
  onRemove?: () => void;
  hintFor: (band: SoBand) => (PlanSlice & { of: number }) | undefined;
  onFill: (band: SoBand, slice: PlanSlice) => Map<string, number>;
  loadedRows?: ReactNode;
  /** Edit: loaded items still kept (the totals row's "lines"). */
  loadedItems?: number;
}) {
  // Item Table rows. The boxes live in draft.qty (per line); a row only names its item.
  const [rows, setRows] = useState<ItemRow[]>([{ key: 0, ...BLANK }]);
  /** The batch picker: "all" = Add Items in Bulk, else the DesignRow.key of the row whose batches it edits. */
  const [picker, setPicker] = useState("");
  const [tab, setTab] = useState<"details" | "vehicle">("details");

  // This container's view of the stock: the others' picks are gone (lines CLONED — use these rows throughout).
  const bands = useMemo(() => scopeBands(pick.bands, otherUse), [pick.bands, otherUse]);
  const allBands = useMemo(() => scopeBands(pick.allBands, otherUse), [pick.allBands, otherUse]);
  // Rows resolve over EVERY band — the Customer filter only narrows the pick lists (CR-252).
  const designRows = useMemo(() => new Map(allBands.flatMap((b) => b.designs).map((r) => [r.key, r])), [allBands]);
  const qty = draft.qty;
  const merge = (m: Map<string, number>) => patch((d) => ({ qty: new Map([...d.qty, ...m]) }));
  const setDesign = (row: DesignRow, v: number, skip?: Set<string>) => merge(spreadQty(openLines(row), v, skip));
  /** Pallets typed on the Item Table (CR-258): whole pallets, oldest batch first. */
  const setDesignPallets = (row: DesignRow, p: number, skip?: Set<string>) => merge(spreadPallets(openLines(row), p, skip));
  const setCap = (k: keyof LoadingCapture, v: string) => patch((d) => ({ capture: { ...d.capture, [k]: v } }));
  const setVeh = (k: keyof VehicleDraft, v: string) => patch((d) => ({ vehicle: { ...d.vehicle, [k]: v } }));

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

  const details = { vehicle: draft.vehicle, capture: draft.capture, setVeh, setCap };
  const fillText = totals.fill > 0 ? `${Math.round(totals.fill * 100)}% of a container` : "";
  return (
    <div className="form-section">
      <div className="form-section-title" style={{ flexWrap: "wrap" }}>
        <span>{title}</span>
        {/* The container selection level (CR-301): the Container Master format this container is. */}
        <span style={{ textTransform: "none", fontWeight: 400, width: "min(420px, 100%)" }}>
          <Combobox
            value={draft.capture.container_format || ""}
            options={formats.map((f) => ({ value: f.id, label: f.name }))}
            onChange={(v) => setCap("container_format", v)}
            placeholder="Search container…"
            ariaLabel={`Container format, ${title}`}
            clearable
          />
        </span>
        <span className="mono nw" style={{ marginLeft: "auto", fontWeight: 400, textTransform: "none", color: totals.over ? "var(--c-amber)" : "var(--muted)" }} title="Share of this container">
          {open ? "" : fillText}
        </span>
        {onRemove && (
          <button className="btn ord-rm" title="Remove this container" onClick={onRemove}><Icon name="x" size={13} /></button>
        )}
      </div>

      {open && (
        <div className="ord-lines" style={{ marginTop: 10 }}>
          <div className="ord-line ord-line-head qt-line load-line">
            <span>Item Details</span>
            <span>Batches</span>
            <span style={{ textAlign: "right" }}>Pallets</span>
            <span style={{ textAlign: "right" }}>Boxes</span>
            <span>Pallet</span>
            <span>Box Brand</span>
            <span />
          </div>

          {/* Already loaded (edit), one row per item: fewer PALLETS sends the rest back to Ready for Loading; ✕ / 0 unloads. */}
          {loadedRows}

          {rows.map((r) => {
            const dr = designRows.get(r.rowKey);
            const skip = new Set(r.off);
            const v = dr ? rowQty(dr) : 0;
            const max = dr ? openLines(dr).reduce((n, l) => n + (skip.has(l.id) ? 0 : l.boxes), 0) : 0;
            const used = dr ? openLines(dr).filter((l) => (qty.get(l.id) || 0) > 0) : [];
            const usedParts = used.map((l) => ({ l, n: qty.get(l.id)! }));
            const maxPallets = dr ? openLines(dr).reduce((n, l) => n + (skip.has(l.id) ? 0 : palletsOfLine(l.boxes, l.boxesPerPallet)), 0) : 0;
            const mix = mixBatchOf(used.length ? used : dr ? openLines(dr) : []);
            return (
              <div key={r.key} className="ord-line qt-line load-line">
                <Combobox
                  value={r.rowKey}
                  options={itemOptions(bands, new Set([...taken].filter((k) => k !== r.rowKey)))}
                  onChange={(k) => setItem(r, k)}
                  placeholder="Type or click to select an item…"
                  ariaLabel="Item"
                />
                <div className="combo">
                  <input
                    className="combo-input"
                    readOnly
                    disabled={!dr}
                    aria-label="Batches"
                    aria-haspopup="dialog"
                    title={dr ? `Choose batches and pallets${mix ? "\nMXBATCH: a pallet here is shared with another batch/item" : ""}` : undefined}
                    value={dr ? `${batchSummary(openLines(dr), v ? new Set(openLines(dr).filter((l) => !qty.get(l.id)).map((l) => l.id)) : skip)}${mix ? " · MXBATCH" : ""}` : ""}
                    placeholder="—"
                    style={{ cursor: dr ? "pointer" : undefined }}
                    onClick={() => setPicker(r.rowKey)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPicker(r.rowKey)}
                  />
                </div>
                <div className="form-field" title={dr ? `${fmt(maxPallets)} pallets · ${fmt(max)} boxes ready` : undefined}>
                  <NumberInput
                    maxDecimals={0}
                    value={dr && v ? String(sumPallets(usedParts)) : ""}
                    placeholder="0"
                    disabled={!dr}
                    aria-label="Pallets"
                    onChange={(e) => dr && setDesignPallets(dr, Number(e.target.value) || 0, skip)}
                    style={{ textAlign: "right" }}
                  />
                </div>
                <div className="form-field" title={dr && v ? boxesHint(usedParts) : undefined}><input readOnly tabIndex={-1} style={{ textAlign: "right" }} value={dr && v ? fmt(v) : ""} /></div>
                <div className="form-field"><input readOnly tabIndex={-1} value={dr ? palletNames(used.length ? used : openLines(dr)) : ""} /></div>
                <div className="form-field"><input readOnly tabIndex={-1} value={dr ? pick.brandName(dr.brandId) : ""} /></div>
                <button className="btn ord-rm" title="Remove row" onClick={() => removeRow(r)}><Icon name="x" size={13} /></button>
              </div>
            );
          })}

          {/* Totals sit under their columns (same grid as the rows) — loaded (after edits) + picked. */}
          <div className="ord-line qt-line load-line" style={{ fontWeight: 700, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <span>Total <span className="dim" style={{ fontWeight: 400 }}>· {fmt(new Set(totals.picked.map((l) => `${l.salesOrderId}|${l.designId}`)).size + loadedItems)} lines</span></span>
            <span />
            <span className="mono" style={{ textAlign: "right", paddingRight: 10 }}>{fmt(totals.pallets)}</span>
            <span className="mono" style={{ textAlign: "right", paddingRight: 10 }}>{fmt(totals.boxes)}</span>
            <span className="mono nw" style={{ fontWeight: 400, color: totals.over ? "var(--c-amber)" : "var(--muted)" }} title="Share of this container">{fillText}</span>
            <span />
            <span />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setRows((rs) => [...rs, { key: nextKey(), ...BLANK }])}>
              <Icon name="plus" size={12} /> Add New Row
            </button>
            <button className="btn" onClick={() => setPicker("all")}>
              <Icon name="plus" size={12} /> Add Items in Bulk
            </button>
          </div>

          {/* Container Planning (CR-255/301): the order's next planned container no other section claimed — a helper, never a gate. */}
          {bands.flatMap((band) => {
            const next = hintFor(band);
            if (!next) return [];
            const planned = next.lines.reduce((s, ln) => s + ln.boxes, 0);
            return [
              <div key={band.salesOrderId} className="dim" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: "var(--t-sm)", flexWrap: "wrap" }}>
                <Icon name="package" size={13} />
                <span>
                  <span className="mono">{bandLabel(band)}</span> · container plan: Container {next.ci + 1} of {next.of} · <span className="mono">{fmt(planned)}</span> boxes
                </span>
                <button className="btn" onClick={() => fill(band, next)}>Fill from plan</button>
              </div>,
            ];
          })}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="row" role="tablist" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <button role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")} style={tabStyle(tab === "details")}>Loading Details</button>
          <button role="tab" aria-selected={tab === "vehicle"} onClick={() => setTab("vehicle")} style={tabStyle(tab === "vehicle")}>Vehicle Details</button>
        </div>
        {/* Both stay mounted — one Save reads the same draft either way. */}
        <div className="form-rows" style={tab === "details" ? undefined : { display: "none" }}>
          <label className="form-field">
            <span className="lbl">Loading No.</span>
            <input readOnly tabIndex={-1} value={loadingNo} />
          </label>
          <LoadDetailsFields {...details} part="details" />
        </div>
        <div className="form-rows" style={tab === "vehicle" ? undefined : { display: "none" }}>
          <LoadDetailsFields {...details} part="vehicle" />
        </div>
      </div>

      {picker && (() => {
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
      })()}
    </div>
  );
}
