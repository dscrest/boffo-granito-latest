/* ============================================================
   Load container — the container-first load flow (replaces BoxPickerModal).
   Loading now STARTS with the container: pick an open one and see what it
   looks like after this load, or fill a new container's details right here
   (identity, vehicle, seals, paperwork) instead of naming it afterwards in
   Confirm Load.

   `ContainerPicker` is the shared half — LOAD INTO + the after-loading
   preview + the new-container form — and is mounted by all three entry
   points: the board's Load button (pallet mode), "New Loading"
   (container-only mode) and Add Items on a loading detail page.

   Vehicle/driver stay on the Vehicle master: the typed registration is
   find-or-created (formatVehicleNumber match), so LoadBox.vehicle keeps
   pointing at a real Vehicle row.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { type Order } from "@/data";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { CONTAINER_TYPES } from "@/features/masters/containersApi";
import { createVehicle, formatVehicleNumber, listVehicles, type VehicleRow } from "@/features/masters/vehiclesApi";
import { DESIGN_PALETTE } from "./VehicleFillBar";
import {
  boxFill,
  boxLabel,
  lineFrac,
  mixedBatchOrderItems,
  sharedCapacity,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

/* LOAD INTO sentinels — anything else is an existing LoadBox ROWID. */
/** Mint a new container from the details form. */
export const NEW_CONTAINER = "__new__";
/** No container yet — items just wait in Ready for Loading (opt-in via allowNone). */
export const NO_CONTAINER = "__none__";

/** Everything the new-container form collects. Vehicle fields resolve to a
    Vehicle ROWID at submit; the rest map straight onto LoadBox columns. */
export interface ContainerDraft {
  container_number: string;
  container_size: string;
  vehicle_number: string;
  electronic_seal: string;
  driver_name: string;
  driver_phone: string;
  transporter: string;
  lr_number: string;
  destination: string;
  dispatch_date: string;
}

export const newContainerDraft = (): ContainerDraft => ({
  container_number: "",
  container_size: CONTAINER_TYPES[1], // 40ft — the common export box
  vehicle_number: "",
  electronic_seal: "",
  driver_name: "",
  driver_phone: "",
  transporter: "",
  lr_number: "",
  destination: "",
  dispatch_date: todayISO(),
});

/** The four the crew cannot dispatch without — mirrors the footer hint. */
export const draftMissing = (d: ContainerDraft): boolean =>
  !d.container_number.trim() || !d.vehicle_number.trim() || !d.driver_name.trim() || !d.electronic_seal.trim();

/** Find-or-create the Vehicle behind a typed registration, then hand back the
    LoadBox payload. Returns null (after surfacing nothing) if the create fails —
    callers show their own error. */
export async function draftToCreateInput(
  d: ContainerDraft,
  vehicles: VehicleRow[],
): Promise<({ vehicle?: string; dispatch_date?: string } & LoadingCapture) | null> {
  const reg = formatVehicleNumber(d.vehicle_number);
  let vehicleId = vehicles.find((v) => formatVehicleNumber(v.vehicleNumber) === reg)?.id || "";
  if (!vehicleId) {
    const res = await createVehicle({
      vehicle_number: reg,
      driver_name: d.driver_name.trim(),
      mobile_number: d.driver_phone.trim(),
    });
    if (!res.ok || !res.rowid) return null;
    vehicleId = res.rowid;
  }
  return {
    vehicle: vehicleId,
    dispatch_date: d.dispatch_date,
    container_number: d.container_number.trim(),
    container_size: d.container_size,
    electronic_seal: d.electronic_seal.trim(),
    transporter: d.transporter.trim(),
    lr_number: d.lr_number.trim(),
    destination: d.destination.trim(),
  };
}

/* ---- LOAD INTO + after-loading preview + new-container form ---- */

export function ContainerPicker({
  boxes,
  linesOfBox,
  selected,
  onSelect,
  draft,
  onDraft,
  showErrors,
  /** Boxes this load would add — drives the "After loading" preview. */
  adding = 0,
  /** Locked target (Add Items on a loading detail page): read-only, no picker. */
  lockedTo,
  /** Offer "no container yet" — items wait in Ready for Loading (Send to Loading). */
  allowNone,
  /** Skip the picker entirely — there is nothing to load into yet ("New Loading"). */
  onlyNew,
}: {
  boxes: LoadBox[]; // Open boxes only
  linesOfBox: (boxId: string) => Array<{ p: PalPlan; l: PalPlanLine }>;
  selected: string;
  onSelect: (boxId: string) => void;
  draft: ContainerDraft;
  onDraft: (d: ContainerDraft) => void;
  showErrors?: boolean;
  adding?: number;
  lockedTo?: LoadBox;
  allowNone?: boolean;
  onlyNew?: boolean;
}) {
  const set = (k: keyof ContainerDraft, v: string) => onDraft({ ...draft, [k]: v });
  const box = lockedTo ?? boxes.find((b) => b.id === selected);

  const options = [
    ...(allowNone ? [{ value: NO_CONTAINER, label: "Ready for Loading", hint: "no container yet — pick one later" }] : []),
    ...boxes.map((b) => {
      const inBox = linesOfBox(b.id);
      const loaded = inBox.reduce((s, { l }) => s + l.boxes, 0);
      return {
        value: b.id,
        label: b.containerNumber || boxLabel(b),
        hint: [
          `${inBox.length} pal`,
          `${fmt(loaded)} boxes`,
          b.containerSize,
          b.vehicleNumber,
        ].filter(Boolean).join(" · "),
      };
    }),
    { value: NEW_CONTAINER, label: "+ New container…" },
  ];

  return (
    <>
      {lockedTo ? (
        <div className="form-field" style={{ marginBottom: 10 }}>
          <span className="lbl">Load Into</span>
          <div className="mono" style={{ fontWeight: 600 }}>{lockedTo.containerNumber || boxLabel(lockedTo)}</div>
        </div>
      ) : onlyNew ? null : (
        <label className="form-field" style={{ marginBottom: 10 }}>
          <span className="lbl">Load Into<span className="req"> *</span></span>
          <Combobox
            value={selected}
            options={options}
            onChange={onSelect}
            placeholder="Search containers…"
            clearable={false}
            ariaLabel="Load into"
          />
        </label>
      )}

      {box ? (
        <AfterLoadingBar box={box} lines={linesOfBox(box.id).map(({ l }) => l)} adding={adding} />
      ) : selected === NO_CONTAINER ? null : (
        <div className="form-section">
          <div className="form-section-title">New container details</div>
          <div className="form-grid">
            <label className="form-field">
              <span className="lbl">Container No.<span className="req"> *</span></span>
              <input
                value={draft.container_number}
                autoFocus
                placeholder="e.g. TCLU 4829137"
                className={showErrors && !draft.container_number.trim() ? "error" : undefined}
                onChange={(e) => set("container_number", e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="lbl">Size</span>
              <Combobox
                value={draft.container_size}
                options={CONTAINER_TYPES.map((t) => ({ value: t, label: t }))}
                onChange={(v) => set("container_size", v)}
                clearable={false}
                ariaLabel="Container size"
              />
            </label>
            <label className="form-field">
              <span className="lbl">Vehicle No.<span className="req"> *</span></span>
              <input
                value={draft.vehicle_number}
                placeholder="e.g. GJ-01-XT-4521"
                className={showErrors && !draft.vehicle_number.trim() ? "error" : undefined}
                onChange={(e) => set("vehicle_number", formatVehicleNumber(e.target.value))}
              />
            </label>
            <label className="form-field">
              <span className="lbl">E-Seal No.<span className="req"> *</span></span>
              <input
                value={draft.electronic_seal}
                placeholder="e.g. ES-99120034"
                className={showErrors && !draft.electronic_seal.trim() ? "error" : undefined}
                onChange={(e) => set("electronic_seal", e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="lbl">Driver Name<span className="req"> *</span></span>
              <input
                value={draft.driver_name}
                placeholder="Driver name"
                className={showErrors && !draft.driver_name.trim() ? "error" : undefined}
                onChange={(e) => set("driver_name", e.target.value)}
              />
            </label>
            <label className="form-field">
              <span className="lbl">Driver Phone</span>
              <input value={draft.driver_phone} placeholder="+91 …" onChange={(e) => set("driver_phone", e.target.value)} />
            </label>
            <label className="form-field">
              <span className="lbl">Transporter</span>
              <input value={draft.transporter} placeholder="Carrier company" onChange={(e) => set("transporter", e.target.value)} />
            </label>
            <label className="form-field">
              <span className="lbl">LR / Docket No.</span>
              <input value={draft.lr_number} placeholder="LR number" onChange={(e) => set("lr_number", e.target.value)} />
            </label>
            <label className="form-field">
              <span className="lbl">Destination / Port</span>
              <input value={draft.destination} placeholder="Port / city" onChange={(e) => set("destination", e.target.value)} />
            </label>
            <label className="form-field">
              <span className="lbl">Dispatch Date</span>
              <DateInput value={draft.dispatch_date} onChange={(e) => set("dispatch_date", e.target.value)} />
            </label>
          </div>
        </div>
      )}
    </>
  );
}

/** "After loading: 294 of 800 boxes … 37%" — fill is fractional against each
    line's PALLET capacity (boxFill), so the absolute total only shows when
    every line shares one capacity. */
function AfterLoadingBar({ box, lines, adding }: { box: LoadBox; lines: PalPlanLine[]; adding: number }) {
  const loaded = lines.reduce((s, l) => s + l.boxes, 0);
  const cap = sharedCapacity(lines);
  const after = loaded + adding;
  // The incoming boxes ride the same capacity as the box's existing lines.
  const frac = boxFill(lines) + (cap > 0 ? adding / cap : 0);
  const pct = Math.round(frac * 100);
  const colorByDesign = new Map<string, string>();
  lines.forEach((l) => {
    if (!colorByDesign.has(l.designId)) colorByDesign.set(l.designId, DESIGN_PALETTE[colorByDesign.size % DESIGN_PALETTE.length]);
  });
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", marginBottom: 12,
      }}
    >
      <span className="dim" style={{ fontSize: "var(--t-sm)" }}>After loading:</span>
      <span className="mono" style={{ fontWeight: 600 }}>{fmt(after)}</span>
      {cap > 0 && <span className="dim" style={{ fontSize: "var(--t-sm)" }}>of {fmt(cap)} boxes</span>}
      <span
        style={{ flex: 1, minWidth: 120, display: "flex", height: 10, borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)", background: "var(--panel-2)" }}
        title={`${fmt(after)} boxes · ${pct}% of a full container`}
      >
        {lines.map((l) => (
          <span key={l.id} style={{ width: `${lineFrac(l) * 100}%`, background: colorByDesign.get(l.designId) }} />
        ))}
        {adding > 0 && cap > 0 && (
          <span style={{ width: `${(adding / cap) * 100}%`, background: "var(--accent)", opacity: 0.75 }} title={`Adding ${fmt(adding)} boxes`} />
        )}
      </span>
      <span className="mono" style={{ fontWeight: 600, color: pct > 100 ? "var(--c-red)" : "var(--c-green)" }}>{pct}%</span>
      {box.destination && <span className="dim" style={{ fontSize: "var(--t-sm)", width: "100%" }}>Destination: {box.destination}</span>}
    </div>
  );
}

/* ---- The modal ---- */

/** An order item loaded straight from production (send-to-loading path). */
interface ProdPick {
  salesOrderId: string;
  soNumber: string;
  orderItemId: string;
  label: string;
  customer: string;
  boxes: number;
  remaining: number;
}

const remainingOf = (o: Order) => Math.max(0, o.orderQty - o.palletizedQty);

export function LoadContainerModal({
  lines = [],
  availableLines = [],
  boxes,
  linesOfBox,
  busy,
  planHint,
  onConfirm,
  onClose,
}: {
  /** The pallets being loaded. Empty for container-only mode ("New Loading"). */
  lines?: PalPlanLine[];
  /** Every Ready (unboxed) line on the board — the "Add item" pallet pool. */
  availableLines?: PalPlanLine[];
  boxes: LoadBox[]; // Open boxes only
  linesOfBox: (boxId: string) => Array<{ p: PalPlan; l: PalPlanLine }>;
  busy: boolean;
  /** The SO/quote container plan's next target for this design (guide + warn only). */
  planHint?: { docNo: string; containerNo: number; boxes: number; palletName: string };
  /** boxId = load into that container; details = mint a new one first. Entries
      carry `boxes` only for a partial load (below the line's total).
      `prodEntries` are order items loaded straight from production — the
      caller sends them via /send-to-loading with the box. */
  onConfirm: (
    target: { boxId: string } | { details: { vehicle?: string; dispatch_date?: string } & LoadingCapture },
    entries: Array<{ lineId: string; boxes?: number }>,
    prodEntries: Array<{ salesOrderId: string; orderItemId: string; boxes: number }>,
  ) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  // Loading pallets defaults to the first open container; "New Loading"
  // (no lines) always starts a fresh container.
  const [sel, setSel] = useState<string>(lines.length ? (boxes[0]?.id ?? NEW_CONTAINER) : NEW_CONTAINER);
  const [draft, setDraft] = useState<ContainerDraft>(newContainerDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [partial, setPartial] = useState(false);
  // The load list is editable: ✕ drops a supplied line, the Add-item picker
  // pulls in more Ready pallets or order items straight from production.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [extraLines, setExtraLines] = useState<PalPlanLine[]>([]);
  const [prodPicks, setProdPicks] = useState<ProdPick[]>([]);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const effLines = lines.filter((l) => !removed.has(l.id)).concat(extraLines);
  const single = effLines.length === 1 && prodPicks.length === 0 ? effLines[0] : undefined;
  const [count, setCount] = useState(single?.boxes ?? 0);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void listVehicles().then((r) => r.ok && setVehicles(r.vehicles));
    void listOrders().then((r) => r.ok && setOrders(r.orders));
  }, []);

  const selBox = boxes.find((b) => b.id === sel);
  // Greedy 100% cap, line by line in selection order: each line loads what
  // still fits (in ITS pallet's boxes-per-container), the rest stays Ready.
  // Every clamp is shown in the table below — nothing is dropped silently.
  let runningFill = selBox ? boxFill(linesOfBox(selBox.id).map(({ l }) => l)) : 0;
  const fits = effLines.map((l) => {
    const fit = l.palletCapacity > 0 ? Math.floor(Math.max(0, 1 - runningFill) * l.palletCapacity) : l.boxes;
    const n = Math.max(0, Math.min(l.boxes, fit));
    if (l.palletCapacity > 0) runningFill += n / l.palletCapacity;
    return { l, n };
  });
  const maxLoad = single ? fits[0].n : 0;
  const effCount = single ? (partial ? Math.min(count, maxLoad) : maxLoad) : 0;
  const entries: Array<{ lineId: string; boxes?: number }> = single
    ? effCount > 0
      ? [{ lineId: single.id, ...(effCount < single.boxes ? { boxes: effCount } : {}) }]
      : []
    : fits.filter(({ n }) => n > 0).map(({ l, n }) => ({ lineId: l.id, ...(n < l.boxes ? { boxes: n } : {}) }));
  // ponytail: prod picks skip the greedy fit clamp (no client-side capacity
  // before palletisation — same as capacity-0 lines) and the mixed-batch
  // warning: the server splits them across batches FIFO, invisible here.
  const prodEntries = prodPicks.map((p) => ({ salesOrderId: p.salesOrderId, orderItemId: p.orderItemId, boxes: p.boxes }));
  const prodTotal = prodPicks.reduce((s, p) => s + p.boxes, 0);
  const adding = (single ? effCount : fits.reduce((s, { n }) => s + n, 0)) + prodTotal;
  const totalItems = effLines.length + prodPicks.length;
  const totalBoxes = effLines.reduce((s, l) => s + l.boxes, 0) + prodPicks.reduce((s, p) => s + p.remaining, 0);
  // Warn-only batch rule: flag when this load would make one order item span
  // batches inside the selected container.
  const wouldMixBatches = !!selBox && effLines.length > 0 && mixedBatchOrderItems([...linesOfBox(selBox.id).map(({ l }) => l), ...effLines]);

  const newContainer = !selBox;
  const invalid = newContainer && draftMissing(draft);
  const blocked =
    busy || saving || invalid || ((lines.length > 0 || totalItems > 0) && entries.length === 0 && prodEntries.length === 0);

  const submit = async () => {
    if (busy || saving) return;
    if (invalid) {
      setShowErrors(true);
      return;
    }
    if (selBox) {
      onConfirm({ boxId: selBox.id }, entries, prodEntries);
      return;
    }
    setSaving(true);
    const details = await draftToCreateInput(draft, vehicles);
    setSaving(false);
    if (!details) {
      setShowErrors(true);
      return;
    }
    onConfirm({ details }, entries, prodEntries);
  };

  // "Add item" pool: Ready pallets not already on the list (a ✕'d supplied
  // line comes back via un-remove), then order items with boxes left to send.
  const effIds = new Set(effLines.map((l) => l.id));
  const palOpts = availableLines
    .filter((l) => !effIds.has(l.id))
    .map((l) => ({
      value: `pal:${l.id}`,
      label: `${l.itemCode} · ${l.designLabel}`,
      hint: [l.customerName, l.soNumber].filter(Boolean).join(" · "),
      badge: `${fmt(l.boxes)} boxes`,
    }));
  const oiOpts = orders
    .filter(
      (o) =>
        o.salesOrderId &&
        remainingOf(o) > 0 &&
        !["Draft", "PendingApproval", "Cancelled", "Rejected"].includes(o.status || "") &&
        !prodPicks.some((p) => p.orderItemId === o.id),
    )
    .map((o) => ({
      value: `oi:${o.id}`,
      label: o.design,
      hint: ["From production", o.party, o.orderNumber].filter(Boolean).join(" · "),
      badge: `${fmt(remainingOf(o))} left`,
    }));
  const addItem = (v: string) => {
    if (v.startsWith("pal:")) {
      const id = v.slice(4);
      if (removed.has(id)) {
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        const l = availableLines.find((x) => x.id === id);
        if (l) setExtraLines((prev) => [...prev, l]);
      }
    } else if (v.startsWith("oi:")) {
      const o = orders.find((x) => x.id === v.slice(3));
      const so = o?.salesOrderId;
      if (o && so)
        setProdPicks((prev) => [
          ...prev,
          {
            salesOrderId: so,
            soNumber: o.orderNumber || "",
            orderItemId: o.id,
            label: o.design,
            customer: o.party || "",
            boxes: remainingOf(o),
            remaining: remainingOf(o),
          },
        ]);
    }
  };
  const removeLine = (id: string) =>
    extraLines.some((l) => l.id === id)
      ? setExtraLines((prev) => prev.filter((l) => l.id !== id))
      : setRemoved((prev) => new Set(prev).add(id));

  const target = selBox ? (selBox.containerNumber || boxLabel(selBox)) : draft.container_number.trim() || "the new container";
  const hint = invalid
    ? "Fill container no., vehicle no., driver, e-seal"
    : totalItems
      ? `Loading into ${target}`
      : `Creating ${target}`;

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: !single && totalItems > 0 ? 760 : 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>
              {single ? "Load pallet" : totalItems ? `Load ${totalItems} item${totalItems === 1 ? "" : "s"}` : "New Loading"}
            </div>
            {single ? (
              <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                <span className="mono">{single.itemCode}</span> · {single.designLabel} · {fmt(single.boxes)} boxes ready
              </div>
            ) : totalItems > 0 ? (
              <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                {totalItems} items · {fmt(totalBoxes)} boxes ready
              </div>
            ) : null}
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <ContainerPicker
            boxes={boxes}
            linesOfBox={linesOfBox}
            selected={sel}
            onSelect={setSel}
            draft={draft}
            onDraft={setDraft}
            showErrors={showErrors}
            adding={adding}
            onlyNew={lines.length === 0}
          />

          {!single && totalItems > 0 && (
            <table className="tbl" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Batch</th>
                  <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                  <th style={{ minWidth: 180 }}>Loads</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {fits.map(({ l, n }) => (
                  <tr key={l.id}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{l.itemCode}</span>
                      <div className="design-name">{l.designLabel}</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {[l.customerName, l.soNumber, l.sizeCode].filter(Boolean).join("  ·  ") || "—"}
                      </div>
                    </td>
                    <td>
                      {l.batchNumber ? (
                        <span className="chip mono" style={{ fontSize: 13 }}>Batch {l.batchNumber}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="num mono">{fmt(l.boxes)}</td>
                    <td style={{ fontSize: "var(--t-sm)" }}>
                      {n === l.boxes ? (
                        <span style={{ color: "var(--c-green)", fontWeight: 600 }}>All {fmt(n)}</span>
                      ) : n > 0 ? (
                        <span style={{ color: "var(--c-amber)", fontWeight: 600 }}>
                          {fmt(n)} of {fmt(l.boxes)} — rest stays in Ready
                        </span>
                      ) : (
                        <span style={{ color: "var(--c-red)", fontWeight: 600 }}>Won't fit — stays in Ready</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn ord-rm" tabIndex={-1} title="Remove from this load" onClick={() => removeLine(l.id)}>✕</button>
                    </td>
                  </tr>
                ))}
                {prodPicks.map((p) => (
                  <tr key={p.orderItemId}>
                    <td>
                      <div className="design-name">{p.label}</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {[p.customer, p.soNumber, "From production"].filter(Boolean).join("  ·  ")}
                      </div>
                    </td>
                    <td><span className="dim">—</span></td>
                    <td className="num">
                      <input
                        type="number"
                        min={1}
                        max={p.remaining}
                        value={p.boxes}
                        onChange={(e) =>
                          setProdPicks((prev) =>
                            prev.map((x) =>
                              x.orderItemId === p.orderItemId
                                ? { ...x, boxes: Math.max(1, Math.min(p.remaining, Math.floor(Number(e.target.value)) || 1)) }
                                : x,
                            ),
                          )
                        }
                        style={{ width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ fontSize: "var(--t-sm)" }}>
                      <span style={{ color: "var(--c-green)", fontWeight: 600 }}>Direct — {fmt(p.boxes)}</span>
                    </td>
                    <td>
                      <button type="button" className="btn ord-rm" tabIndex={-1} title="Remove from this load" onClick={() => setProdPicks((prev) => prev.filter((x) => x.orderItemId !== p.orderItemId))}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {single && (() => { const line = single; return (
            <>
              <div className="form-section-title" style={{ marginTop: 4 }}>Quantity</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className={partial ? "btn" : "hbtn primary"}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setPartial(false)}
                >
                  Whole pallet · {fmt(Math.min(line.boxes, maxLoad || line.boxes))} boxes
                </button>
                <button
                  type="button"
                  className={partial ? "hbtn primary" : "btn"}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => {
                    setPartial(true);
                    setCount(Math.min(count || line.boxes, maxLoad || line.boxes));
                  }}
                >
                  Partial…
                </button>
              </div>
              {partial && (
                <label className="form-field" style={{ marginTop: 10 }}>
                  <span className="lbl">Boxes to load</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={maxLoad}
                      value={effCount}
                      onChange={(e) => setCount(Math.max(1, Math.min(line.boxes, Math.floor(Number(e.target.value)) || 1)))}
                      style={{ width: 100, textAlign: "right" }}
                    />
                    <span className="dim" style={{ fontSize: "var(--t-sm)" }}>of {fmt(line.boxes)}</span>
                  </span>
                </label>
              )}
              {/* 100% cap hint — different pallet sizes fill a container at different rates. */}
              {selBox && line.palletCapacity > 0 && maxLoad < line.boxes && (
                <div style={{ fontSize: "var(--t-sm)", marginTop: 8, color: "var(--c-amber)", fontWeight: 600 }}>
                  Only {fmt(maxLoad)} of {fmt(line.boxes)} boxes fit here — the rest stay in Ready for Loading
                </div>
              )}
              {effCount < line.boxes && maxLoad >= line.boxes && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
                  The other {fmt(line.boxes - effCount)} stay in Ready for Loading
                </div>
              )}
              {wouldMixBatches && (
                <div style={{ fontSize: "var(--t-sm)", marginTop: 8, color: "var(--c-amber)", fontWeight: 600 }}>
                  This order item already rides in {selBox!.containerNumber || boxLabel(selBox!)} from another batch — tile texture may vary
                </div>
              )}
              {planHint && (
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
                  Plan {planHint.docNo}: C{planHint.containerNo} — {fmt(planHint.boxes)} boxes of this design on {planHint.palletName}
                </div>
              )}
              {planHint && effCount > planHint.boxes && (
                <div style={{ fontSize: "var(--t-sm)", marginTop: 4, color: "var(--c-amber)", fontWeight: 600 }}>
                  The plan calls for {fmt(planHint.boxes)} boxes in C{planHint.containerNo} — loading {fmt(effCount)}
                </div>
              )}
            </>
          ); })()}

          {(palOpts.length > 0 || oiOpts.length > 0) && (
            <label className="form-field" style={{ marginTop: single ? 10 : 0, marginBottom: 4 }}>
              <span className="lbl">Add item</span>
              <Combobox
                value=""
                options={[...palOpts, ...oiOpts]}
                onChange={addItem}
                placeholder="Add a Ready pallet or an order item from production…"
                ariaLabel="Add item"
              />
            </label>
          )}

          {!single && wouldMixBatches && (
            <div style={{ fontSize: "var(--t-sm)", marginTop: 8, color: "var(--c-amber)", fontWeight: 600 }}>
              An order item would ride in {selBox!.containerNumber || boxLabel(selBox!)} from more than one batch — tile texture may vary
            </div>
          )}
        </div>

        <div className="df-foot">
          <span style={{ flex: 1, fontSize: "var(--t-sm)", color: invalid ? "var(--c-amber)" : "var(--dim)" }}>{hint}</span>
          <button className="btn" onClick={onClose} disabled={busy || saving}>Cancel</button>
          <button className="hbtn primary" disabled={blocked} onClick={() => void submit()}>
            <Icon name="check" size={13} />
            {busy || saving
              ? "Saving…"
              : totalItems
                ? `Load ${fmt(adding)} boxes`
                : "Create container"}
          </button>
        </div>
      </div>
    </div>
  );
}
