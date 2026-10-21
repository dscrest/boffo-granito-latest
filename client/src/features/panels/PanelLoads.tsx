/* ============================================================
   CR-347: loading entries for Panel + Sample orders — the one UI for
   "what is still pending to load" and "what left on which vehicle".
     PanelLoadsTab   the Dispatch tab on /panel-orders/:id and
                     /sample-orders/:id: progress per line × material,
                     the trips (date · LD no · vehicle · materials · kg ·
                     photos · by · remove), Record Load.
     RecordLoadModal ONE trip for one or SEVERAL orders (the Loading page
                     multi-select): date · vehicle (free text, CR-185) ·
                     note · photos (File Store, raster-only) · per order a
                     section of line × material rows with Load now
                     (default = pending). One Save = ONE /panel-load-save.
   Skin = the df-modal / BoffoLoader house pattern. A panel order's
   pieces must be BOOKED before its Panel / cut-piece rows can load (the
   Note says so — the server 409 mirrors it); MDF boards load any time.
   ============================================================ */
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Chip } from "@/ui/Chip";
import { toast } from "@/ui/Toast";
import { Note } from "@/ui/States";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { useModalA11y } from "@/ui/useModalA11y";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { uploadDesignImage } from "@/lib/api";
import type { DesignImage } from "@/features/masters/designsApi";
import { formatVehicleNumber } from "@/features/masters/vehiclesApi";
import { MoreMenu } from "@/features/common/DetailBits";
import { ImageThumb } from "@/features/common/ImageLightbox";
import type { PanelRow } from "./panelsApi";
import { cachedMdfs } from "./mdfApi";
import { LOADING_TONE } from "./pcBits";
import { deleteLoad, saveLoad, type LoadPick } from "./panelLoadsApi";
import {
  loadingStatus,
  loadProgress,
  MATERIAL_LABEL,
  PANEL_ORDER_OPEN,
  pendingNeedLines,
  pendingText,
  requirementsFor,
  type LoadRow,
  type Material,
  type PanelOrderRow,
  type ProgressRow,
} from "./panelOrdersApi";
import { remaining, type SampleOrderRow } from "./sampleOrdersApi";

/** The two order types the loads serve — the discriminator the Orders grid uses too (CR-345). */
export type LoadableOrder = (PanelOrderRow & { type: "Panel" }) | (SampleOrderRow & { type: "Sample" });

/** Progress rows of either order type (a sample line's "loaded" = its supplied qty). */
export function progressOf(o: LoadableOrder): ProgressRow[] {
  if (o.type === "Panel") return loadProgress(o.lines, o.loads);
  return o.lines.map((l) => ({ lineId: l.id, material: "Item" as const, ordered: l.qty, loaded: l.suppliedQty, pending: remaining(l) }));
}
export const isOpen = (o: LoadableOrder) => (o.type === "Panel" ? PANEL_ORDER_OPEN.has(o.status) : o.status !== "Supplied");
export const loadStatusOf = (o: LoadableOrder) => loadingStatus(progressOf(o), o.status);
/** CR-355: the designs on an order for the grids' Design cell — panel lines by panel code, cut-piece and sample lines by design name. */
export const lineCodeList = (o: LoadableOrder): string[] =>
  o.type === "Panel" ? o.lines.map((l) => (l.panelId ? l.panelCode : l.designName)) : o.lines.map((l) => l.designName);
export const lineCodes = (o: LoadableOrder) => lineCodeList(o).join(", ");

/** CR-352: SHORT — "PANEL-003" / "640 Grey · 300x300" / "640 Grey · Full tile"; the rest is behind the (i). */
export function lineLabel(o: LoadableOrder, lineId: string): string {
  if (o.type === "Panel") {
    const l = o.lines.find((x) => x.id === lineId);
    if (!l) return "—";
    if (!l.panelId) return [l.designName, l.cutSizeName].filter(Boolean).join(" · ") || "Cut piece";
    return l.panelCode;
  }
  const l = o.lines.find((x) => x.id === lineId);
  return l ? `${l.designName} · ${l.pieceKind === "Cut" ? l.cutSizeName || "Cut piece" : "Full tile"}` : "—";
}

/** CR-352: what the (i) card shows for one line — meta pairs + the panel's design rows. */
export function lineDetails(o: LoadableOrder, lineId: string, panelsById?: Map<string, PanelRow>): { meta: [string, string][]; designs: { name: string; size: string; cutSize: string; qty: number }[] } {
  const none = { meta: [] as [string, string][], designs: [] };
  if (o.type === "Panel") {
    const l = o.lines.find((x) => x.id === lineId);
    if (!l) return none;
    if (!l.panelId) return { meta: [["Design", l.designName || "—"], ["Cut size", l.cutSizeName || "—"], ["Ordered", `${fmt(l.qty)} pcs`]], designs: [] };
    const p = panelsById?.get(l.panelId);
    const mdf = l.mdfId ? cachedMdfs().find((m) => m.id === l.mdfId)?.label || p?.mdfSize || "Picked" : "No MDF";
    return {
      meta: [["Panel size", p?.panelSize || "—"], ["Vinyl size", p?.vinylSize || "—"], ["MDF", mdf], ["Ordered", `${fmt(l.qty)} panel${l.qty === 1 ? "" : "s"}`]],
      designs: (p?.lines ?? []).map((x) => ({ name: x.designName, size: x.sizeLabel, cutSize: x.cutSizeName, qty: x.qty })),
    };
  }
  const l = o.lines.find((x) => x.id === lineId);
  if (!l) return none;
  return { meta: [["Design", l.designName], ["Piece", l.pieceKind === "Cut" ? l.cutSizeName || "Cut piece" : "Full tile"], ["Ordered", `${fmt(l.qty)} pcs`], ...(l.note ? [["Note", l.note] as [string, string]] : [])], designs: [] };
}

/** The Line cell: short label + (i) toggle. */
function LineCell({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>{label}</span>
      <button type="button" className="btn x" style={{ width: 22, height: 22, padding: 0 }} title={open ? "Hide line details" : "Line details"} aria-expanded={open} onClick={onToggle}>
        <Icon name="info" size={13} />
      </button>
    </span>
  );
}

/** The details card — rendered as a full-width row under the line's material rows (no popover: nothing to clip). */
function LineInfoRow({ o, lineId, panelsById, colSpan }: { o: LoadableOrder; lineId: string; panelsById?: Map<string, PanelRow>; colSpan: number }) {
  const d = lineDetails(o, lineId, panelsById);
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "0 10px 10px" }}>
        <div className="card" style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: "var(--t-sm)" }}>
            {d.meta.map(([k, v]) => (
              <span key={k}><span className="muted">{k}: </span><span className="mono">{v}</span></span>
            ))}
          </div>
          {d.designs.length > 0 && (
            <table className="tbl" style={{ fontSize: "var(--t-sm)" }}>
              <thead>
                <tr><th>Design</th><th>Size</th><th>Cut size</th><th className="num" style={{ textAlign: "right" }}>Pcs / panel</th></tr>
              </thead>
              <tbody>
                {d.designs.map((x, i) => (
                  <tr key={i}><td>{x.name}</td><td className="mono">{x.size || "—"}</td><td className="mono">{x.cutSize || "—"}</td><td className="num mono">{fmt(x.qty)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Material rows grouped per line so the (i) card sits under ALL of a line's rows (Panel + MDF). */
function groupByLine(rows: ProgressRow[]): ProgressRow[][] {
  const m = new Map<string, ProgressRow[]>();
  for (const r of rows) m.set(r.lineId, [...(m.get(r.lineId) ?? []), r]);
  return [...m.values()];
}
function useInfo() {
  const [info, setInfo] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) => setInfo((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return { info, toggle };
}

const kg = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100) / 100} kg`);
const unitWord = (m: Material, n: number) => (m === "Mdf" ? "MDF" : m === "Panel" ? `panel${n === 1 ? "" : "s"}` : "pcs");

/** Booking gate text for a panel order's picks (the server refuses the same way). */
function bookingWarning(o: LoadableOrder, panelsById: Map<string, PanelRow> | undefined, stock: Map<string, number> | undefined): string {
  if (o.type !== "Panel" || !panelsById || !stock) return "";
  const reqs = requirementsFor(pendingNeedLines(o.lines, o.loads), panelsById, stock, { allocation: o.allocation });
  const short = reqs.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  return short > 0 ? `Book ${fmt(short)} more pcs on the Requirements card before loading panels or cut pieces — MDF boards can go now.` : "";
}

/* ---------------- Record Load modal ---------------- */
export function RecordLoadModal({
  orders,
  panelsById,
  stock,
  onDone,
  onClose,
}: {
  orders: LoadableOrder[];
  panelsById?: Map<string, PanelRow>;
  stock?: Map<string, number>;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const fileRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(todayISO());
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState(""); // CR-351
  const [mobile, setMobile] = useState("");
  const [note, setNote] = useState("");
  const { info, toggle } = useInfo(); // CR-352: open (i) cards, keyed order|line
  const [photos, setPhotos] = useState<DesignImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Pending rows per order; qty defaults to the whole pending amount.
  const sections = useMemo(() => orders.map((o) => ({ o, rows: progressOf(o).filter((r) => r.pending > 0), warn: bookingWarning(o, panelsById, stock) })), [orders, panelsById, stock]);
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(sections.flatMap((s) => s.rows.map((r) => [`${s.o.id}|${r.lineId}|${r.material}`, r.pending]))),
  );
  const keyOf = (oid: string, r: ProgressRow) => `${oid}|${r.lineId}|${r.material}`;
  const set = (k: string, cap: number, v: number) => setQty((prev) => ({ ...prev, [k]: Math.max(0, Math.min(cap, Math.floor(v) || 0)) }));
  const setAll = (s: (typeof sections)[number], all: boolean) => setQty((prev) => ({ ...prev, ...Object.fromEntries(s.rows.map((r) => [keyOf(s.o.id, r), all ? r.pending : 0])) }));
  const totals = useMemo(() => {
    const t: Record<Material, number> = { Panel: 0, Mdf: 0, Item: 0 };
    for (const s of sections) for (const r of s.rows) t[r.material] += qty[keyOf(s.o.id, r)] ?? 0;
    return t;
  }, [sections, qty]);
  const total = totals.Panel + totals.Mdf + totals.Item;
  const summary = [totals.Panel > 0 && `${fmt(totals.Panel)} panel${totals.Panel === 1 ? "" : "s"}`, totals.Mdf > 0 && `${fmt(totals.Mdf)} MDF`, totals.Item > 0 && `${fmt(totals.Item)} pcs`].filter(Boolean).join(" · ");

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) {
          toast.error(`${f.name}: only images can be attached`);
          continue;
        }
        const up = await uploadDesignImage(f);
        setPhotos((p) => [...p, up]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (saving || uploading || total === 0 || !vehicle.trim()) return;
    setSaving(true);
    const res = await saveLoad({
      load_date: date,
      vehicle_number: vehicle.trim(),
      driver_name: driver.trim() || undefined,
      driver_mobile: mobile.trim() || undefined,
      note: note.trim() || undefined,
      photos,
      orders: sections
        .map((s) => ({ order_type: s.o.type, order: s.o.id, lines: s.rows.map((r): LoadPick => ({ line: r.lineId, material: r.material, qty: qty[keyOf(s.o.id, r)] ?? 0 })).filter((p) => p.qty > 0) }))
        .filter((s) => s.lines.length > 0),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not record the load");
      return;
    }
    const done = (res.data?.loads ?? []).filter((l) => l.status === "Dispatched" || l.status === "Supplied").length;
    toast.success(`${res.data?.order_number || "Load"} recorded · ${summary}${done ? ` · ${done} order${done === 1 ? "" : "s"} dispatched` : ""}`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="truck" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Record Load</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>
              {orders.length === 1 ? `${orders[0].orderNumber || "Order"} · ${orders[0].customerName}` : `${orders.length} orders · one vehicle`}
            </div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-rows" style={{ marginBottom: 10 }}>
            <label className="form-field">
              <span className="lbl">Load Date</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="form-field">
              <span className="lbl">Vehicle Number<span className="req"> *</span></span>
              <input value={vehicle} onChange={(e) => setVehicle(formatVehicleNumber(e.target.value))} placeholder="GJ-01-AB-1234" aria-invalid={!vehicle.trim() || undefined} />
            </label>
            <label className="form-field">
              <span className="lbl">Driver Name</span>
              <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Driver name" />
            </label>
            <label className="form-field">
              <span className="lbl">Driver Mobile</span>
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile number" inputMode="tel" />
            </label>
            <label className="form-field span2">
              <span className="lbl">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Transporter, LR no…" />
            </label>
            <div className="form-field span2">
              <span className="lbl">Photos</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {photos.map((p, i) => (
                  <span key={p.id} style={{ position: "relative", display: "inline-flex" }}>
                    <ImageThumb images={photos} index={i} size={44} alt={p.name} />
                    <button type="button" className="btn x" style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, padding: 0, fontSize: 10 }} title="Remove photo" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))}>✕</button>
                  </span>
                ))}
                <button type="button" className="btn" disabled={uploading || saving} onClick={() => fileRef.current?.click()} title="Attach loading photos">
                  {uploading ? <BoffoLoader size="sm" /> : <><Icon name="plus" size={12} /> Add photo</>}
                </button>
                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => void onPick(e.target.files)} />
              </div>
            </div>
          </div>

          {sections.map((s) => (
            <div key={`${s.o.type}|${s.o.id}`} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{s.o.orderNumber || (s.o.type === "Panel" ? "Panel Order" : "Sample Order")}</span>
                <span className="muted">{s.o.customerName}</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="linkish" style={{ background: "none", border: 0, cursor: "pointer", fontSize: "var(--t-sm)" }} onClick={() => setAll(s, true)}>Load all pending</button>
                <button type="button" className="linkish" style={{ background: "none", border: 0, cursor: "pointer", fontSize: "var(--t-sm)" }} onClick={() => setAll(s, false)}>Clear</button>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Material</th>
                      <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                      <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                      <th className="num" style={{ textAlign: "right" }}>Pending</th>
                      <th className="num" style={{ textAlign: "right", width: 120 }}>Load Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupByLine(s.rows).map((group) => {
                      const ik = `${s.o.id}|${group[0].lineId}`;
                      const open = info.has(ik);
                      return [
                        ...group.map((r) => {
                          const k = keyOf(s.o.id, r);
                          return (
                            <tr key={k}>
                              <td><LineCell label={lineLabel(s.o, r.lineId)} open={open} onToggle={() => toggle(ik)} /></td>
                              <td className="mono">{MATERIAL_LABEL[r.material]}</td>
                              <td className="num mono">{fmt(r.ordered)}</td>
                              <td className="num mono">{fmt(r.loaded)}</td>
                              <td className="num mono">{fmt(r.pending)}</td>
                              <td className="num">
                                <NumberInput min={0} value={qty[k] ?? 0} onChange={(e) => set(k, r.pending, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${MATERIAL_LABEL[r.material]} loading now`} disabled={saving} />
                              </td>
                            </tr>
                          );
                        }),
                        ...(open ? [<LineInfoRow key={`${ik}|info`} o={s.o} lineId={group[0].lineId} panelsById={panelsById} colSpan={6} />] : []),
                      ];
                    })}
                    {s.rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 12 }}>Nothing pending on this order.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Notes sit UNDER the content they explain — never above a table (house rule). */}
              {s.warn && <Note tone="warn" style={{ marginBottom: 0 }}>{s.warn}</Note>}
            </div>
          ))}
          <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
            Load Now is what goes on this vehicle — leave 0 on a Panel or MDF row that stays back. Panels and cut pieces leave cut stock with this load; MDF boards are not stock. The order dispatches itself once every material is loaded.
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">{summary || "Nothing selected"}{summary ? " going out" : ""}</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving || uploading || total === 0 || !vehicle.trim()} onClick={() => void submit()} title={!vehicle.trim() ? "Enter the vehicle number" : total === 0 ? "Enter a quantity on at least one line" : "Record this load"}>
            {saving ? <BoffoLoader size="sm" /> : <><Icon name="check" size={13} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Dispatch tab ---------------- */
export function PanelLoadsTab({
  order,
  panelsById,
  stock,
  liveUnit,
  onChanged,
}: {
  order: LoadableOrder;
  panelsById?: Map<string, PanelRow>;
  stock?: Map<string, number>;
  /** CR-349: live per-unit kg of a line's materials (Panel / Item → pieces, Mdf → mdf); omit to hide the Weight column. */
  liveUnit?: (lineId: string) => { pieces: number | null; mdf: number | null };
  onChanged: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const { info, toggle } = useInfo(); // CR-352
  const rows = progressOf(order);
  const open = isOpen(order);
  const status = loadStatusOf(order);
  const pending = pendingText(rows);
  const canEdit = can("panel_craft", "edit");
  const loads: LoadRow[] = order.loads;
  // Weight per row: shipped part = stamped kg on the loads; pending part = live unit × pending.
  const rowKg = (r: ProgressRow): number | null => {
    if (!liveUnit) return null;
    const unit = r.material === "Mdf" ? liveUnit(r.lineId).mdf : liveUnit(r.lineId).pieces;
    let shipped = 0;
    for (const ld of loads)
      for (const l of ld.lines) {
        if (l.lineId !== r.lineId || l.material !== r.material) continue;
        if (l.weightKg == null) return null;
        shipped += l.weightKg;
      }
    if (r.pending > 0 && unit == null) return null;
    return Math.round((shipped + r.pending * (unit ?? 0)) * 1000) / 1000;
  };
  const kgs = rows.map(rowKg);
  const totalKg = liveUnit && kgs.every((k) => k != null) ? kgs.reduce((s, k) => s + (k ?? 0), 0) : null;
  const loadKg = (ld: LoadRow): number | null => (ld.lines.every((l) => l.weightKg != null) ? ld.lines.reduce((s, l) => s + (l.weightKg ?? 0), 0) : null);

  const remove = async (ld: LoadRow) => {
    const reason = await confirmDelete({ message: `Remove load ${ld.loadNumber} (${ld.vehicle}) from ${order.orderNumber}? Stock and bookings come back.` });
    if (reason == null) return;
    setBusy(true);
    const res = await deleteLoad(ld.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not remove the load");
      return;
    }
    toast.success(`Load ${ld.loadNumber} removed`);
    onChanged();
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600 }}>Pending to Load</span>
          <Chip tone={LOADING_TONE[status]} label={status} />
          {pending && <span className="muted" style={{ fontSize: 14 }}>{pending}</span>}
          <span style={{ flex: 1 }} />
          {canEdit && (
            <button className="hbtn primary" disabled={busy || !open || !pending} onClick={() => setRecording(true)} title={!open ? "Order is closed" : !pending ? "Nothing pending to load" : "Record a vehicle load"}>
              <Icon name="truck" size={13} /> Record Load
            </button>
          )}
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Line</th>
                <th>Material</th>
                <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                <th className="num" style={{ textAlign: "right" }}>Pending</th>
                {liveUnit && <th className="num" style={{ textAlign: "right" }}>Weight</th>}
              </tr>
            </thead>
            <tbody>
              {groupByLine(rows).map((group) => {
                const open = info.has(group[0].lineId);
                return [
                  ...group.map((r) => {
                    const i = rows.indexOf(r);
                    return (
                      <tr key={`${r.lineId}|${r.material}`}>
                        <td><LineCell label={lineLabel(order, r.lineId)} open={open} onToggle={() => toggle(r.lineId)} /></td>
                        <td className="mono">{MATERIAL_LABEL[r.material]}</td>
                        <td className="num mono">{fmt(r.ordered)}</td>
                        <td className="num mono">{fmt(r.loaded)}</td>
                        <td className="num mono" style={r.pending > 0 ? { color: "var(--c-amber)", fontWeight: 600 } : undefined}>{fmt(r.pending)}</td>
                        {liveUnit && <td className="num mono" title="Shipped kg are frozen on the load; pending kg follow the master">{kg(kgs[i])}</td>}
                      </tr>
                    );
                  }),
                  ...(open ? [<LineInfoRow key={`${group[0].lineId}|info`} o={order} lineId={group[0].lineId} panelsById={panelsById} colSpan={liveUnit ? 6 : 5} />] : []),
                ];
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={liveUnit ? 6 : 5} className="muted" style={{ textAlign: "center", padding: 18 }}>No lines on this order.</td>
                </tr>
              )}
            </tbody>
            {liveUnit && rows.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ fontWeight: 600 }}>Total</td>
                  <td className="num mono" style={{ fontWeight: 600 }}>{kg(totalKg)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {!open && status === "Loaded" && loads.length === 0 && (
          <div style={{ padding: "8px 14px" }}>
            <Note tone="info">Closed before loads were recorded — treated as fully loaded.</Note>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontWeight: 600 }}>Loads</span>
          <span className="muted" style={{ fontSize: 14 }}>{loads.length} trip{loads.length === 1 ? "" : "s"}</span>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Load No</th>
                <th>Vehicle</th>
                <th>Materials</th>
                <th className="num" style={{ textAlign: "right" }}>Weight</th>
                <th>Photos</th>
                <th>By</th>
                <th>Note</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {loads.map((ld) => (
                <tr key={ld.id}>
                  <td className="mono muted">{ld.date || "—"}</td>
                  <td className="mono">{ld.loadNumber || "—"}</td>
                  <td>
                    <div className="mono">{ld.vehicle || "—"}</div>
                    {(ld.driverName || ld.driverMobile) && <div className="muted" style={{ fontSize: "var(--t-sm)" }}>{[ld.driverName, ld.driverMobile].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td>{ld.lines.map((l) => `${fmt(l.qty)} ${unitWord(l.material, l.qty)} · ${lineLabel(order, l.lineId)}`).join("; ") || "—"}</td>
                  <td className="num mono" title="Stamped when it left — never changes">{kg(loadKg(ld))}</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 4 }}>
                      {ld.photos.map((p, i) => <ImageThumb key={p.id} images={ld.photos} index={i} size={28} alt={p.name} />)}
                      {ld.photos.length === 0 && <span className="dim">—</span>}
                    </span>
                  </td>
                  <td className="muted">{ld.by || "—"}</td>
                  <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ld.note}>{ld.note || <span className="dim">—</span>}</td>
                  <td>
                    <MoreMenu
                      kebab
                      title="Load actions"
                      items={[
                        // CR-351: printable Load Copy — on demand only (house rule for every print).
                        { label: "Load Copy", title: "Download the Load Copy PDF", onClick: () => void import("./panelLoadCopyPdf").then((m) => m.downloadPanelLoadCopyPdf(order, ld)) },
                        ...(can("panel_craft", "delete")
                          ? [{ label: "Remove load", danger: true, disabled: busy || !open, title: open ? "Stock and bookings come back" : "The order is closed — a final load cannot be removed", onClick: () => void remove(ld) }]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {loads.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 18 }}>No loads recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "8px 14px" }}>
          {order.type === "Panel" ? "Dispatched is derived from the loads — the order flips when every panel, board and piece has left." : "Supplied is derived from the loads — the order flips when every sample has left."}
        </div>
      </div>

      {recording && <RecordLoadModal orders={[order]} panelsById={panelsById} stock={stock} onDone={onChanged} onClose={() => setRecording(false)} />}
    </div>
  );
}
