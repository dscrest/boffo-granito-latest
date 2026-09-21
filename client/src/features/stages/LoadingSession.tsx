/* ============================================================
   Loading Session — ONE scrolling page for New Loading AND the loading
   detail's Edit (no steps since 2026-09-21; CR-203's stepper is gone):
   laid out like a Sales Order form (CR-247):
     Customer          Combobox on top — an optional FILTER (CR-252): blank = every customer's
                       stock, a container may mix customers
     Item Table        palletized Ready-for-Loading stock only: ONE row per item (CR-256) — its
                       batches combined; the Batches cell opens the batch picker (boxes per batch), Boxes typed
                       on the row drain the chosen batches oldest first;
                       Add New Row + Add Items in Bulk; (edit) loaded items are its first rows
     Totals row        under the Boxes / Pallets columns + container fill % (CR-253)
     Plan hint         per order: next planned container + Fill from plan (CR-255)
     Tabs              Loading Details | Vehicle Details, below the items (CR-254)
   One Save runs it all in order: vehicle → (mint the LoadBox) → unload /
   shrink → add pallets → load details. It stops at the first
   failure; what already saved stays saved and the page reloads for a retry.
   A dispatched loading shows the details section only (the server keeps
   those editable; its lines are immutable).
   Routes: /loading/new[?so=<id>] and /loading/:id/session.
   The ruled Loading Sheet lives on /loading/:id, not here.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
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
import { LoadDetailsFields, captureOf, useLoadDetails } from "./LoadDetailsFields";
import { BulkLoadItemsModal } from "./BulkLoadItemsModal";
import { bandLabel, batchLabel, batchSummary, itemOptions, openLines, spreadQty, type DesignRow } from "./newLoadingRows";
import { useSessionPick } from "./SessionItemsStep";
import { UNLOAD, resolveLoadSheetEdit, type LoadSheetDraft } from "./loadSheetEdit";
import { duplicateSeals } from "./sealChecks";
import {
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
  invalidatePalPlans,
  listPalPlans,
  setLineBox,
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
const sumPallets = (parts: { l: PalPlanLine; n: number }[]) => parts.reduce((s, x) => s + (x.l.boxesPerPallet > 0 && x.n > 0 ? Math.ceil(x.n / x.l.boxesPerPallet) : 0), 0);
const palletNames = (ls: PalPlanLine[]) => [...new Set(ls.map((l) => l.palletName).filter(Boolean))].join(" / ");

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
  const pick = useSessionPick({ plans, boxes, box, presetSalesOrderId, anyCustomer: true, onSaved: () => undefined });
  const details = useLoadDetails(box, box ? captureOf(box) : undefined);
  // Loaded lines: typed qty per line id ("0" = remove).
  const [loadedDraft, setLoadedDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Item Table rows. The boxes live in pick.qty (the ONE selection state, per line); a row only names its item.
  const [rows, setRows] = useState<ItemRow[]>([{ key: 0, ...BLANK }]);
  /** The batch picker: "all" = Add Items in Bulk, else the DesignRow.key of the row whose batches it edits. */
  const [picker, setPicker] = useState("");
  const [tab, setTab] = useState<"details" | "vehicle">("details");

  const loaded = pick.boxLines;
  // Rows resolve over EVERY band — the Customer filter only narrows the pick lists (CR-252).
  const designRows = useMemo(() => new Map(pick.allBands.flatMap((b) => b.designs).map((r) => [r.key, r])), [pick.allBands]);
  const taken = new Set(rows.map((r) => r.rowKey).filter(Boolean));
  const nextKey = () => rows.reduce((m, r) => Math.max(m, r.key), 0) + 1;
  const patchRow = (key: number, p: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const rowQty = (dr: DesignRow) => openLines(dr).reduce((s, l) => s + (pick.qty.get(l.id) || 0), 0);
  const release = (r: ItemRow) => {
    const dr = designRows.get(r.rowKey);
    if (dr) pick.setDesign(dr, 0);
  };
  /** Picking an item prefills everything it has ready. */
  const setItem = (r: ItemRow, rowKey: string) => {
    release(r);
    const dr = rowKey && !taken.has(rowKey) ? designRows.get(rowKey) : undefined;
    if (dr) pick.setDesign(dr, dr.ready);
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
    const uniq = [...new Set(keys)];
    setRows((rs) => [
      ...rs.filter((r) => r.rowKey).map((r) => (uniq.includes(r.rowKey) ? { ...r, off: offOf(r.rowKey) } : r)),
      ...uniq.filter((rowKey) => !taken.has(rowKey)).map((rowKey) => ({ key: k++, rowKey, off: offOf(rowKey) })),
    ]);
  };
  /** The picker's Apply: its WHOLE scope is rewritten — a batch left out goes back to 0. */
  const applyPicks = (scope: DesignRow[], picks: { rowKey: string; lineId: string; boxes: number }[]) => {
    const want = new Map(picks.map((p) => [p.lineId, p.boxes]));
    for (const dr of scope) for (const l of openLines(dr)) pick.setLine(l, want.get(l.id) || 0);
    // A one-item scope re-derives that row even when everything was deselected.
    addRows([...picks.map((p) => p.rowKey), ...(scope.length === 1 ? [scope[0].key] : [])], (id) => want.get(id) || 0);
    setPicker("");
  };
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
  const setGroupQty = (ls: PalPlanLine[], v: number) =>
    setLoadedDraft((p) => ({ ...p, ...Object.fromEntries([...spreadQty(ls, v)].map(([id, n]) => [id, String(n)])) }));

  const dups = duplicateSeals(
    [
      ...boxes.map((b) => ({ id: b.id, label: boxLabel(b), containerNumber: b.containerNumber, electronicSeal: b.electronicSeal, lineSeal: b.lineSeal })),
      ...(box ? [] : [{ id: NEW, label: "New loading", containerNumber: "", electronicSeal: "", lineSeal: "" }]),
    ],
    { [box?.id || NEW]: details.capture },
    [box?.id || NEW],
  );

  const detailUrl = (bid: string) => `/loading/${encodeURIComponent(bid)}`;
  const back = () => navigate(box ? detailUrl(box.id) : "/loading");

  /** Runs the whole Save in order. Returns [error, boxId reached]. */
  const run = async (): Promise<[string, string]> => {
    if (loadedError) return [loadedError, box?.id || ""];
    const veh = await resolveVehicle(details.vehicle);
    if (!veh.ok) return [veh.error || "Could not save the vehicle", box?.id || ""];

    let bid = box?.id || "";
    if (!box) {
      const typed = Object.fromEntries(Object.entries(details.capture).filter(([, v]) => (v || "").trim())) as LoadingCapture;
      const created = await createLoadBox({ load_plan: pick.loadPlan(), ...(veh.rowid ? { vehicle: veh.rowid } : {}), ...typed });
      if (!created.ok || !created.data?.ROWID) return [created.error || "Could not create the loading", ""];
      bid = String(created.data.ROWID);
    }

    if (open) {
      for (const { l, ops } of loadedOps) {
        if (!ops.unload && !ops.move) continue;
        const r = ops.unload ? await setLineBox(l.id, "") : await setLineBox(l.id, bid, ops.move!.boxes);
        if (!r.ok) return [r.error || "Could not change a loaded item", bid];
      }
      setLoadedDraft({});

      const addErr = await pick.saveAdds(bid);
      if (addErr) return [addErr, bid];

    }

    if (box) {
      const cur = captureOf(box);
      const patch: LoadingCapture & { vehicle?: string } = {};
      for (const k of Object.keys(cur) as (keyof LoadingCapture)[])
        if ((details.capture[k] || "") !== (cur[k] || "")) patch[k] = details.capture[k] || "";
      if (veh.rowid && veh.rowid !== box.vehicleId) patch.vehicle = veh.rowid;
      if (Object.keys(patch).length) {
        const r = await updateLoadBox(box.id, patch);
        if (!r.ok) return [r.error || "Could not save loading details", bid];
      }
    }
    return ["", bid];
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const [err, bid] = await run();
    invalidatePalPlans();
    if (!err) {
      toast.success(box ? "Loading saved" : "Loading created");
      navigate(detailUrl(bid), { replace: !box });
      return;
    }
    toast.error(err);
    await reload().catch(() => undefined);
    setBusy(false);
    // A new loading that got minted before the failure: carry on editing IT — a retry here would mint a second.
    if (!box && bid) navigate(`${detailUrl(bid)}/session`, { replace: true });
  };

  const customerLocked = !pick.showRail || !open;
  const customerOptions = [
    ...pick.customers.map((c) => ({ value: c.id, label: c.name, hint: `${fmt(c.ready)} boxes ready` })),
    // A locked customer with nothing left to load is not in the ready list — still name them.
    ...(pick.customerId && !pick.customers.some((c) => c.id === pick.customerId)
      ? [{ value: pick.customerId, label: loaded[0]?.customerName || pick.customerId }]
      : []),
  ];

  // Totals row: loaded lines after their typed edits + the new picks.
  const kept = loaded.map((l) => ({ l, n: keptOf(l) })).filter((x) => x.n > 0);
  // "lines" counts item rows, the way the table shows them.
  const totalLines = new Set([...kept.map((x) => x.l), ...pick.picked].map((l) => `${l.salesOrderId}|${l.designId}`)).size;
  const totalBoxes = kept.reduce((s, x) => s + x.n, 0) + pick.totalBoxes;
  const totalPallets = sumPallets(kept) + pick.totalPallets;
  const planHints = pick.bands.flatMap((band) => {
    const next = pick.planNext(band);
    return next ? [{ band, next, boxes: next.lines.reduce((s, ln) => s + ln.boxes, 0) }] : [];
  });

  const nothingNew = !box && pick.totalBoxes === 0;
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
        <div className="form-grid">
          <label className="form-field">
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

      {open && (
        <div className="form-section">
          <div className="form-section-title">Item Table</div>
          <div className="ord-lines">
            <div className="ord-line ord-line-head qt-line load-line">
              <span>Item Details</span>
              <span>Batches</span>
              <span style={{ textAlign: "right" }}>Boxes</span>
              <span style={{ textAlign: "right" }}>Pallets</span>
              <span>Pallet</span>
              <span>Box Brand</span>
              <span />
            </div>

            {/* Already loaded (edit), one row per item: fewer boxes sends the rest (newest batch first) back to Ready for Loading; ✕ / 0 unloads. */}
            {loadedGroups.map((ls) => {
              const l0 = ls[0];
              const total = ls.reduce((n, l) => n + l.boxes, 0);
              const keptN = ls.reduce((n, l) => n + keptOf(l), 0);
              const touched = ls.some((l) => (loadedDraft[l.id] ?? "").trim() !== "");
              const removed = touched && keptN === 0;
              const error = loadedOps.find((o) => o.error && ls.includes(o.l))?.error;
              const batches = ls.map((l) => `${batchLabel(l)} · ${fmt(l.boxes)}`);
              return (
                <div key={l0.id} className="ord-line qt-line load-line" style={removed ? { opacity: 0.5 } : undefined}>
                  <div className="form-field"><input readOnly tabIndex={-1} value={`${l0.designLabel} · ${l0.soNumber || "—"}`} /></div>
                  <div className="form-field"><input readOnly tabIndex={-1} title={batches.join("\n")} value={ls.length === 1 ? l0.batchNumber || "—" : `${ls.length} batches`} /></div>
                  <div className="form-field" title={error || undefined}>
                    <NumberInput
                      maxDecimals={0}
                      value={touched ? String(keptN) : String(total)}
                      aria-label={`Boxes loaded, ${l0.designLabel}`}
                      aria-invalid={!!error}
                      onChange={(e) => setGroupQty(ls, Math.min(total, Number(e.target.value) || 0))}
                      style={{ textAlign: "right", ...(error ? { borderColor: "var(--c-red)" } : {}) }}
                    />
                  </div>
                  <div className="form-field"><input readOnly tabIndex={-1} style={{ textAlign: "right" }} value={fmt(sumPallets(ls.map((l) => ({ l, n: keptOf(l) })))) || ""} /></div>
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
            })}

            {rows.map((r) => {
              const dr = designRows.get(r.rowKey);
              const skip = new Set(r.off);
              const v = dr ? rowQty(dr) : 0;
              const max = dr ? openLines(dr).reduce((n, l) => n + (skip.has(l.id) ? 0 : l.boxes), 0) : 0;
              const used = dr ? openLines(dr).filter((l) => (pick.qty.get(l.id) || 0) > 0) : [];
              return (
                <div key={r.key} className="ord-line qt-line load-line">
                  <Combobox
                    value={r.rowKey}
                    options={itemOptions(pick.bands, new Set([...taken].filter((k) => k !== r.rowKey)))}
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
                      title={dr ? "Choose batches and boxes" : undefined}
                      value={dr ? batchSummary(openLines(dr), v ? new Set(openLines(dr).filter((l) => !pick.qty.get(l.id)).map((l) => l.id)) : skip) : ""}
                      placeholder="—"
                      style={{ cursor: dr ? "pointer" : undefined }}
                      onClick={() => setPicker(r.rowKey)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPicker(r.rowKey)}
                    />
                  </div>
                  <div className="form-field" title={dr ? `${fmt(max)} boxes ready` : undefined}>
                    <NumberInput
                      maxDecimals={0}
                      value={dr ? v || "" : ""}
                      placeholder="0"
                      disabled={!dr}
                      aria-label="Boxes"
                      onChange={(e) => dr && pick.setDesign(dr, Number(e.target.value) || 0, skip)}
                      style={{ textAlign: "right" }}
                    />
                  </div>
                  <div className="form-field"><input readOnly tabIndex={-1} style={{ textAlign: "right" }} value={dr && v ? fmt(sumPallets(used.map((l) => ({ l, n: pick.qty.get(l.id)! })))) : ""} /></div>
                  <div className="form-field"><input readOnly tabIndex={-1} value={dr ? palletNames(used.length ? used : openLines(dr)) : ""} /></div>
                  <div className="form-field"><input readOnly tabIndex={-1} value={dr ? pick.brandName(dr.brandId) : ""} /></div>
                  <button className="btn ord-rm" title="Remove row" onClick={() => removeRow(r)}><Icon name="x" size={13} /></button>
                </div>
              );
            })}

            {/* Totals sit under their columns (same grid as the rows) — loaded (after edits) + picked. */}
            <div className="ord-line qt-line load-line" style={{ fontWeight: 700, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <span>Total <span className="dim" style={{ fontWeight: 400 }}>· {fmt(totalLines)} lines</span></span>
              <span />
              <span className="mono" style={{ textAlign: "right", paddingRight: 10 }}>{fmt(totalBoxes)}</span>
              <span className="mono" style={{ textAlign: "right", paddingRight: 10 }}>{fmt(totalPallets)}</span>
              <span className="mono nw" style={{ fontWeight: 400, color: pick.over ? "var(--c-amber)" : "var(--muted)" }} title="Share of one container">
                {pick.fill > 0 ? `${Math.round(pick.fill * 100)}% of a container` : ""}
              </span>
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

            {/* Container Planning (CR-255): the order's next unsent planned container — a helper, never a gate. */}
            {planHints.map(({ band, next, boxes: planned }) => (
              <div key={band.salesOrderId} className="dim" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, fontSize: "var(--t-sm)", flexWrap: "wrap" }}>
                <Icon name="package" size={13} />
                <span>
                  <span className="mono">{bandLabel(band)}</span> · container plan: Container {next.ci + 1} of {next.of} · <span className="mono">{fmt(planned)}</span> boxes
                </span>
                <button className="btn" onClick={() => addRows(pick.fillFromPlan(band).map((f) => f.rowKey))}>Fill from plan</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="form-section" style={{ marginTop: 18 }}>
        <div className="row" role="tablist" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <button role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")} style={tabStyle(tab === "details")}>Loading Details</button>
          <button role="tab" aria-selected={tab === "vehicle"} onClick={() => setTab("vehicle")} style={tabStyle(tab === "vehicle")}>Vehicle Details</button>
        </div>
        {/* Both stay mounted — one Save reads the same `details` state either way. */}
        <div className="form-grid" style={tab === "details" ? undefined : { display: "none" }}>
          <label className="form-field">
            <span className="lbl">Loading No.</span>
            <input readOnly tabIndex={-1} value={box ? boxLabel(box) : "Auto"} />
          </label>
          <LoadDetailsFields {...details} part="details" />
        </div>
        <div className="form-grid" style={tab === "vehicle" ? undefined : { display: "none" }}>
          <LoadDetailsFields {...details} part="vehicle" />
        </div>
      </div>
      {dups.map((d) => (
        <div key={d.field} className="card" role="alert" style={{ marginTop: 10, padding: "9px 12px", display: "flex", gap: 8, alignItems: "center", borderColor: "var(--c-amber)", color: "var(--c-amber)" }}>
          <Icon name="alert" size={14} />
          <span>{d.field} <span className="mono">{d.value}</span> is already recorded on <span className="mono">{d.otherLabel}</span>.</span>
        </div>
      ))}

      {picker && (() => {
        const one = picker === "all" ? undefined : designRows.get(picker);
        const bands = one ? pick.allBands.flatMap((b) => (b.designs.includes(one) ? [{ ...b, designs: [one] }] : [])) : pick.bands;
        return (
          <BulkLoadItemsModal
            bands={bands}
            initial={pick.qty}
            title={one ? `Batches · ${one.designLabel}` : undefined}
            onClose={() => setPicker("")}
            onAdd={(picks) => applyPicks(bands.flatMap((b) => b.designs), picks)}
          />
        );
      })()}

      <div className="session-foot">
        <span className="mono dim" style={{ flex: 1, fontSize: "var(--t-sm)", color: loadedError ? "var(--c-red)" : undefined }}>
          {loadedError}
        </span>
        <button className="btn" onClick={back} disabled={busy}>Cancel</button>
        <button className="hbtn primary" disabled={busy || nothingNew || !!loadedError} onClick={() => void save()}>
          <Icon name="check" size={13} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
