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
   Skin = the df-modal / BoffoLoader house pattern. A row loads only when
   materialReadiness says Ready (CR-381 — the server 409 mirrors it; CR-403):
   a panel's pieces or a loose cut piece once BOOKED, an MDF board once the
   vinyl is pasted on it. Pieces, boards or both go on any trip.
   Not-ready rows sit at 0, disabled, with the missing list as the title.
   CR-402: the Actions tab also carries each panel's MDF · Vinyl · Pasted
   marks (Combobox per panel, spanning its Pieces + MDF rows); CR-401 the
   vinyl print waits for MDF Ready, CR-366 pasting waits for both.
   CR-485: SampleActionsTab = the same Actions tab for a sample order (one
   row per line, always Ready); the sample header lost its Record Load.
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { InfoTag } from "@/ui/InfoCard";
import { Chip } from "@/ui/Chip";
import { Combobox } from "@/ui/Combobox";
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
import { RequirementsCard } from "./RequirementsCard";
import { mdfLabel, type PanelRow } from "./panelsApi";
import { cachedMdfs } from "./mdfApi";
import { checkpointTone, LOADING_TONE } from "./pcBits";
import { deleteLoad, saveLoad, type LoadPick } from "./panelLoadsApi";
import {
  CHECKPOINT_LABEL,
  CHECKPOINT_STATUSES,
  LINE_CHECKPOINT_KEYS,
  lineCheckpoint,
  lineCheckpointMark,
  loadingStatus,
  loadProgress,
  MATERIAL_LABEL,
  materialReadiness,
  PANEL_ORDER_OPEN,
  pastedAllowed,
  pendingNeedLines,
  pendingText,
  requirementsFor,
  rowKey,
  pieceLabel,
  rowLabel,
  setCheckpoint,
  withLineMark,
  lineWeightSplit,
  type LineCheckpointKey,
  type LoadRow,
  type Material,
  type PanelOrderRow,
  type ProgressRow,
  type Requirement,
} from "./panelOrdersApi";
import { remaining, SAMPLE_PIECE_LABEL, type SampleOrderRow } from "./sampleOrdersApi";

/** CR-402: short column heads for the per-panel marks (the full names stay in CHECKPOINT_LABEL). */
const LINE_CHECKPOINT_HEAD: Record<LineCheckpointKey, string> = { mdf: "MDF", vinyl: "Vinyl", pasted: "Pasted" };

/** The two order types the loads serve — the discriminator the Orders grid uses too (CR-345). */
export type LoadableOrder = (PanelOrderRow & { type: "Panel" }) | (SampleOrderRow & { type: "Sample" });

/** Progress rows of either order type (a sample line's "loaded" = its supplied qty).
    CR-405: a panel order's rows are per piece kind + board, so the panel master is needed. */
export function progressOf(o: LoadableOrder, panelsById: Map<string, PanelRow> = new Map()): ProgressRow[] {
  if (o.type === "Panel") return loadProgress(o.lines, o.loads, panelsById);
  return o.lines.map((l) => ({ lineId: l.id, material: "Item" as const, designId: "", cutSizeId: "", designName: "", cutSizeName: "", ordered: l.qty, loaded: l.suppliedQty, pending: remaining(l) }));
}
export const isOpen = (o: LoadableOrder) => (o.type === "Panel" ? PANEL_ORDER_OPEN.has(o.status) : o.status !== "Supplied" && o.status !== "Cancelled"); // CR-368
export const loadStatusOf = (o: LoadableOrder, panelsById?: Map<string, PanelRow>) => loadingStatus(progressOf(o, panelsById), o.status);
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

/** The Line cell: short label + (i). The details open in the house InfoTag card (user 2026-10-22: card, not an inline row).
    CR-377: exported — the Items card on the detail uses it too. */
export function LineCell({ label, o, lineId, panelsById }: { label: ReactNode; o: LoadableOrder; lineId: string; panelsById?: Map<string, PanelRow> }) {
  const d = lineDetails(o, lineId, panelsById);
  return (
    <InfoTag label={label} title="Line details" width={d.designs.length ? 420 : 300}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px" }}>
        {d.meta.map(([k, v]) => (
          <span key={k} style={{ display: "contents" }}><span className="muted">{k}</span><span className="mono">{v}</span></span>
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
    </InfoTag>
  );
}

/** Material rows grouped per line (Panel + MDF rows of one line stay together). */
function groupByLine<T extends ProgressRow>(rows: T[]): T[][] {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.lineId, [...(m.get(r.lineId) ?? []), r]);
  return [...m.values()];
}
/** CR-415: Material cell text inside one line's group — cut size only; two piece kinds that share a cut size
    fall back to the full "design · size" so they still read apart. ponytail: a per-group scan, groups are ≤ a handful of rows. */
function rowLabelIn(group: ProgressRow[], r: ProgressRow): string {
  const twin = r.material === "Item" && group.some((x) => x !== r && x.material === "Item" && x.cutSizeName === r.cutSizeName);
  return twin ? pieceLabel(r) : rowLabel(r);
}
const kg = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100) / 100} kg`);
const unitWord = (m: Material, n: number) => (m === "Mdf" ? "MDF" : m === "Panel" ? `panel${n === 1 ? "" : "s"}` : "pcs");
/** CR-405: "4 pcs · PANEL-005 (Grey · 300x300)" / "2 MDF · PANEL-005" / "20 pcs · Grey · 300x300" for the Loads table + PDF. */
export function loadLineText(o: LoadableOrder, l: LoadRow["lines"][number]): string {
  const onPanel = o.type === "Panel" && !!o.lines.find((x) => x.id === l.lineId)?.panelId;
  const piece = onPanel && l.material === "Item" && l.designName ? ` (${pieceLabel(l)})` : "";
  return `${fmt(l.qty)} ${unitWord(l.material, l.qty)} · ${lineLabel(o, l.lineId)}${piece}`;
}
/** CR-351/433: the Load Copy of ONE trip — only what left on that vehicle; earlier trips keep their own. On demand only (house rule). */
const loadCopy = (o: LoadableOrder, ld: LoadRow) => void import("./panelLoadCopyPdf").then((m) => m.downloadPanelLoadCopyPdf(o, ld));

/** This order's requirements with its booking (the detail page passes the same thing to the Actions tab). */
function reqsOf(o: LoadableOrder, panelsById: Map<string, PanelRow> | undefined, stock: Map<string, number> | undefined): Requirement[] {
  if (o.type !== "Panel" || !panelsById || !stock) return [];
  return requirementsFor(pendingNeedLines(o.lines, o.loads, panelsById), panelsById, stock, { allocation: o.allocation });
}
/** CR-381: readiness of one row — sample rows have no marks and are always loadable. */
export function readinessOf(o: LoadableOrder, r: ProgressRow, reqs: Requirement[]): { ready: boolean; missing: string[] } {
  if (o.type !== "Panel") return { ready: true, missing: [] };
  return materialReadiness(r, o.lines.find((l) => l.id === r.lineId) ?? {}, o.checkpoints, reqs);
}
/** Booking gate text for a panel order's picks (the server refuses the same way). */
function bookingWarning(reqs: Requirement[]): string {
  const short = reqs.reduce((s, r) => s + Math.max(0, r.need - r.allocated), 0);
  return short > 0 ? `Book ${fmt(short)} more pcs first.` : "";
}
type ReadyRow = ProgressRow & { rd: { ready: boolean; missing: string[] } };
/** The "+" item that loads ONE row alone — greyed with the reason, never hidden (CR-382). Shared by both Actions tabs (CR-485). */
function loadRowItem(r: ReadyRow, open: boolean, canEdit: boolean, pick: () => void, label = "Load…") {
  return {
    label,
    disabled: !open || !canEdit || r.pending === 0 || !r.rd.ready,
    title: !open ? "Order is closed" : r.pending === 0 ? "Nothing pending on this row" : r.rd.ready ? "Record a vehicle load for this row only" : r.rd.missing.join(" · "),
    onClick: pick,
  };
}
/** Status cell shared by the Actions tab and Record Load: Loaded · Ready · the missing list. */
function StatusCell({ pending, rd }: { pending: number; rd: { ready: boolean; missing: string[] } }) {
  if (pending === 0) return <Chip tone="green" label="Loaded" />;
  if (rd.ready) return <Chip tone="green" label="Ready" />;
  return <span style={{ color: "var(--c-amber)", fontWeight: 600, whiteSpace: "nowrap" }} title={rd.missing.join(" · ")}>{rd.missing.join(" · ")}</span>;
}

/* ---------------- Record Load modal ---------------- */
export function RecordLoadModal({
  orders,
  panelsById,
  stock,
  initialQty,
  onDone,
  onClose,
}: {
  orders: LoadableOrder[];
  panelsById?: Map<string, PanelRow>;
  stock?: Map<string, number>;
  /** CR-365: quantities typed on the Actions tab, keyed `${orderId}|${rowKey(row)}`; rows not listed keep the full pending default. */
  initialQty?: Record<string, number>;
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
  const [photos, setPhotos] = useState<DesignImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Pending rows per order; a READY row defaults to its whole pending amount, a blocked one to 0 (CR-381).
  const sections = useMemo(
    () =>
      orders.map((o) => {
        const reqs = reqsOf(o, panelsById, stock);
        return { o, rows: progressOf(o, panelsById).filter((r) => r.pending > 0).map((r) => ({ ...r, rd: readinessOf(o, r, reqs) })), warn: bookingWarning(reqs) };
      }),
    [orders, panelsById, stock],
  );
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      sections.flatMap((s) =>
        s.rows.map((r) => {
          const k = `${s.o.id}|${rowKey(r)}`;
          const seed = initialQty?.[k];
          const cap = r.rd.ready ? r.pending : 0;
          return [k, seed == null ? cap : Math.max(0, Math.min(cap, Math.floor(seed) || 0))];
        }),
      ),
    ),
  );
  const keyOf = (oid: string, r: ProgressRow) => `${oid}|${rowKey(r)}`;
  const set = (k: string, cap: number, v: number) => setQty((prev) => ({ ...prev, [k]: Math.max(0, Math.min(cap, Math.floor(v) || 0)) }));
  const setAll = (s: (typeof sections)[number], all: boolean) => setQty((prev) => ({ ...prev, ...Object.fromEntries(s.rows.map((r) => [keyOf(s.o.id, r), all && r.rd.ready ? r.pending : 0])) }));
  const totals = useMemo(() => {
    const t: Record<Material, number> = { Panel: 0, Mdf: 0, Item: 0 };
    for (const s of sections) for (const r of s.rows) t[r.material] += qty[keyOf(s.o.id, r)] ?? 0;
    return t;
  }, [sections, qty]);
  const total = totals.Panel + totals.Mdf + totals.Item;
  const pcs = totals.Item + totals.Panel;
  const summary = [pcs > 0 && `${fmt(pcs)} pcs`, totals.Mdf > 0 && `${fmt(totals.Mdf)} MDF`].filter(Boolean).join(" · ");

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
        .map((s) => ({
          order_type: s.o.type,
          order: s.o.id,
          // CR-405: an Item pick names its piece kind (the server matches the pending row on it).
          lines: s.rows.map((r): LoadPick => ({ line: r.lineId, material: r.material, qty: qty[keyOf(s.o.id, r)] ?? 0, ...(r.material === "Item" && r.designId ? { design: r.designId, cut_piece_size: r.cutSizeId } : {}) })).filter((p) => p.qty > 0),
        }))
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
                <button type="button" className="linkish" style={{ background: "none", border: 0, cursor: "pointer", fontSize: "var(--t-sm)" }} onClick={() => setAll(s, true)}>Load all ready</button>
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
                      <th>Status</th>
                      <th className="num" style={{ textAlign: "right", width: 120 }}>Load Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupByLine(s.rows).map((group) => {
                      return [
                        ...group.map((r) => {
                          const k = keyOf(s.o.id, r);
                          return (
                            <tr key={k}>
                              <td><LineCell label={lineLabel(s.o, r.lineId)} o={s.o} lineId={r.lineId} panelsById={panelsById} /></td>
                              <td className="mono">{rowLabelIn(group, r)}</td>
                              <td className="num mono">{fmt(r.ordered)}</td>
                              <td className="num mono">{fmt(r.loaded)}</td>
                              <td className="num mono">{fmt(r.pending)}</td>
                              <td><StatusCell pending={r.pending} rd={r.rd} /></td>
                              <td className="num">
                                <NumberInput min={0} value={qty[k] ?? 0} onChange={(e) => set(k, r.pending, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${rowLabel(r)} loading now`} disabled={saving || !r.rd.ready} title={r.rd.ready ? undefined : r.rd.missing.join(" · ")} />
                              </td>
                            </tr>
                          );
                        }),
                      ];
                    })}
                    {s.rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 12 }}>Nothing pending on this order.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {/* Notes sit UNDER the content they explain — never above a table (house rule). */}
              {s.warn && <Note tone="warn" style={{ marginBottom: 0 }}>{s.warn}</Note>}
            </div>
          ))}
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

/* ---------------- Actions tab (CR-365) ---------------- */
/** What is ready, what is missing, per line × material — and the quantities going on the next
    vehicle. "Dispatch" opens Record Load with those quantities (vehicle, driver, photos live there).
    CR-402: each panel's MDF · Vinyl · Pasted marks sit here too, one cell set spanning its rows.
    CR-405/407: rows = one per cut-piece kind of the panel + its MDF board (CR-406: always); the first
    row's "+" offers Load whole panel; Allocate Stock sits in the card head. */
export function PanelActionsTab({
  order,
  panelsById,
  stock,
  reqs,
  onChanged,
}: {
  order: PanelOrderRow;
  panelsById: Map<string, PanelRow>;
  stock: Map<string, number>;
  /** requirementsFor(pendingNeedLines(…)) with this order's allocation — the detail page already has it. */
  reqs: Requirement[];
  onChanged: () => void;
}) {
  // CR-432: marks live in local state so a change shows at once; the save lands in the background and the
  // server copy (who · when) replaces it when it answers. Readiness, gates and rows all read this copy.
  const [cp, setCp] = useState(order.checkpoints);
  useEffect(() => setCp(order.checkpoints), [order.checkpoints]);
  const o: LoadableOrder = { ...order, type: "Panel", checkpoints: cp };
  const rows = progressOf(o, panelsById).map((r) => ({ ...r, rd: readinessOf(o, r, reqs) }));
  const open = isOpen(o);
  const canEdit = can("panel_craft", "edit");
  const keyOf = (r: ProgressRow) => `${order.id}|${rowKey(r)}`;
  const [qty, setQty] = useState<Record<string, number>>({});
  /** CR-382/407: `only` = the rows the "+" menu picked (one row, or a whole panel); everything else goes to the modal at 0. */
  const [recording, setRecording] = useState<false | { only?: Set<string> }>(false);
  const [busy, setBusy] = useState(false);
  // CR-313/376: one per-panel mark; the server stamps who / when and mirrors it on the source sale.
  const mark = async (key: LineCheckpointKey, status: string, panelId: string) => {
    if (status === lineCheckpoint(cp, panelId, key)) return;
    const before = cp;
    setCp(withLineMark(cp, panelId, key, status)); // CR-432: instant
    const res = await setCheckpoint(order.id, key, status, panelId);
    if (!res.ok) {
      setCp(before);
      toast.error(res.error || "Could not save the checkpoint");
      return;
    }
    if (res.data) setCp(res.data.checkpoints);
    onChanged();
  };
  // CR-402: Combobox while editable + open, chip otherwise; "—" on a cut-piece line. Title = spec · who·when · gate.
  const markCell = (line: PanelOrderRow["lines"][number] | undefined, k: LineCheckpointKey) => {
    if (!line?.panelId) return <span className="dim">—</span>;
    const st = lineCheckpoint(cp, line.panelId, k);
    const m = lineCheckpointMark(cp, line.panelId, k);
    const spec = k === "mdf" ? mdfLabel(cachedMdfs().find((x) => x.id === line.mdfId)) || "No MDF picked" : panelsById.get(line.panelId)?.vinylSize || "No vinyl size";
    // CR-431: MDF and Vinyl are independent; only Pasted waits for both (CR-366).
    const gate = k === "pasted" && !pastedAllowed(cp, line.panelId) ? "Mark MDF and Vinyl Printing Ready first" : "";
    const title = [spec, m ? `${m.by} · ${m.at.slice(0, 16)}` : "", gate].filter(Boolean).join(" — ");
    return canEdit && open ? (
      <span title={title}>
        <Combobox
          value={st}
          options={CHECKPOINT_STATUSES[k].map((v) => ({ value: v, label: v }))}
          onChange={(v) => void mark(k, v, line.panelId)}
          ariaLabel={`${line.panelCode} ${CHECKPOINT_LABEL[k]} status`}
          disabled={busy || !!gate}
          clearable={false}
        />
      </span>
    ) : (
      <span title={title}><Chip tone={checkpointTone(st)} label={st} /></span>
    );
  };
  const val = (r: (typeof rows)[number]) => qty[keyOf(r)] ?? (r.rd.ready ? r.pending : 0); // CR-381: blocked rows sit at 0
  const set = (r: ProgressRow, v: number) => setQty((p) => ({ ...p, [keyOf(r)]: Math.max(0, Math.min(r.pending, Math.floor(v) || 0)) }));
  const total = rows.reduce((s, r) => s + val(r), 0);
  const readyRows = rows.filter((r) => r.pending > 0 && r.rd.ready).length;
  const pendingRows = rows.filter((r) => r.pending > 0).length;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // CR-419: master–detail. Card 1 = one row per order line (panel + its marks + its MDF board); card 2 = the
  // cut pieces of the SELECTED line. `qty` is keyed by row, so counts typed on one panel survive switching and
  // Dispatch still sends everything typed. Default selection = first line with something pending.
  const groups = groupByLine(rows);
  const [selLine, setSelLine] = useState<string | null>(null);
  const selected = groups.find((g) => g[0].lineId === selLine) ?? groups.find((g) => g.some((r) => r.pending > 0)) ?? groups[0];
  const selPieces = selected?.filter((r) => r.material !== "Mdf") ?? [];
  const amber = { color: "var(--c-amber)", fontWeight: 600 } as const;
  /** "3 of 9" amber while pending, "Loaded" once nothing is, "—" when the line has no such rows. */
  const countCell = (list: (typeof rows)[number][]) => {
    if (list.length === 0) return <span className="dim">—</span>;
    const pending = list.reduce((n, r) => n + r.pending, 0);
    const ordered = list.reduce((n, r) => n + r.ordered, 0);
    return pending > 0 ? <span className="mono"><span style={amber}>{fmt(pending)}</span> <span className="dim">of {fmt(ordered)}</span></span> : <Chip tone="green" label="Loaded" />;
  };
  const rowItem = (r: ReadyRow, label?: string) => loadRowItem(r, open, canEdit, () => setRecording({ only: new Set([keyOf(r)]) }), label);
  const loadNow = (r: (typeof rows)[number], width: number) => (
    <NumberInput min={0} value={val(r)} onChange={(e) => set(r, Number(e.target.value))} placeholder="0" style={{ width, textAlign: "right" }} aria-label={`${rowLabel(r)} loading now`} disabled={!open || !canEdit || r.pending === 0 || !r.rd.ready} title={r.rd.ready ? undefined : r.rd.missing.join(" · ")} />
  );
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <span style={{ fontWeight: 600 }}>Ready to Dispatch</span>
          {pendingRows > 0 && <Chip tone={readyRows === pendingRows ? "green" : readyRows ? "amber" : "slate"} label={`${readyRows} of ${pendingRows} ready`} />}
          <span style={{ flex: 1 }} />
          {/* CR-433: one Load Copy per trip, newest first — each PDF carries only what left on THAT vehicle (MoreMenu renders nothing before the first load). */}
          <MoreMenu
            label="Load Copy"
            title="Download the Load Copy of one trip — only what left on that vehicle"
            items={[...order.loads].reverse().map((ld) => ({
              label: `${ld.loadNumber || "Load"} · ${ld.vehicle || "—"}`,
              title: [ld.date, ld.driverName].filter(Boolean).join(" · "),
              onClick: () => loadCopy(o, ld),
            }))}
          />
          {canEdit && (
            <button className="hbtn primary" disabled={!open || total === 0} onClick={() => setRecording({})} title={!open ? "Order is closed" : total === 0 ? (pendingRows > 0 && readyRows === 0 ? "No line is ready to load yet" : "Type a quantity to dispatch") : "Record the vehicle load for these quantities"}>
              <Icon name="truck" size={13} /> Dispatch
            </button>
          )}
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Panel</th>
                <th className="num" style={{ textAlign: "right" }}>Pieces</th>
                {LINE_CHECKPOINT_KEYS.map((k) => (
                  <th key={k} style={{ minWidth: 150 }}>{LINE_CHECKPOINT_HEAD[k]}</th>
                ))}
                <th className="num" style={{ textAlign: "right" }}>Board</th>
                <th className="num" style={{ textAlign: "right", width: 100 }}>Load board</th>
                <th>Status</th>
                {canEdit && <th style={{ width: 44 }} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const lineId = group[0].lineId;
                const line = order.lines.find((l) => l.id === lineId);
                const pieces = group.filter((r) => r.material !== "Mdf");
                const board = group.find((r) => r.material === "Mdf");
                const pend = group.filter((r) => r.pending > 0);
                const lineRd = { ready: pend.every((r) => r.rd.ready), missing: [...new Set(pend.filter((r) => !r.rd.ready).flatMap((r) => r.rd.missing))] };
                // CR-407: the whole panel = every ready row of this line still pending (its board rides along once pasted).
                const wholeKeys = group.filter((r) => r.pending > 0 && r.rd.ready).map(keyOf);
                const isSel = selected?.[0].lineId === lineId;
                return (
                  <tr key={lineId} className={isSel ? "sel" : undefined} onClick={() => setSelLine(lineId)} style={{ cursor: "pointer" }} aria-selected={isSel}>
                    <td style={{ whiteSpace: "nowrap" }}><LineCell label={lineLabel(o, lineId)} o={o} lineId={lineId} panelsById={panelsById} /></td>
                    <td className="num">{countCell(pieces)}</td>
                    {LINE_CHECKPOINT_KEYS.map((k) => (
                      <td key={k} onClick={stop} onKeyDown={stop}>{markCell(line, k)}</td>
                    ))}
                    <td className="num">{countCell(board ? [board] : [])}</td>
                    <td className="num" onClick={stop} onKeyDown={stop}>{board ? loadNow(board, 84) : null}</td>
                    <td style={{ whiteSpace: "nowrap" }}><StatusCell pending={pend.reduce((n, r) => n + r.pending, 0)} rd={lineRd} /></td>
                    {canEdit && (
                      <td onClick={stop} onKeyDown={stop}>
                        <MoreMenu
                          kebab
                          icon="plus"
                          title="Loading actions"
                          items={[
                            ...(line?.panelId
                              ? [{
                                  label: "Load whole panel",
                                  disabled: !open || !canEdit || wholeKeys.length === 0,
                                  title: !open ? "Order is closed" : wholeKeys.length === 0 ? "Nothing on this panel is ready to load" : wholeKeys.length < pend.length ? "Loads the ready rows of this panel — the rest stay back" : "Every piece of this panel and its MDF board on one vehicle",
                                  onClick: () => setRecording({ only: new Set(wholeKeys) }),
                                }]
                              : pieces.map((r) => rowItem(r))),
                            ...(board ? [rowItem(board, "Load board…")] : []),
                          ]}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 9 : 8} className="muted" style={{ textAlign: "center", padding: 18 }}>No lines on this order.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {selected && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-head">
            <span style={{ fontWeight: 600 }}>Cut pieces · {lineLabel(o, selected[0].lineId)}</span>
            {selPieces.some((r) => r.pending > 0) && (
              <Chip
                tone={selPieces.filter((r) => r.pending > 0).every((r) => r.rd.ready) ? "green" : selPieces.some((r) => r.pending > 0 && r.rd.ready) ? "amber" : "slate"}
                label={`${selPieces.filter((r) => r.pending > 0 && r.rd.ready).length} of ${selPieces.filter((r) => r.pending > 0).length} ready`}
              />
            )}
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cut piece</th>
                  <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                  <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                  <th className="num" style={{ textAlign: "right" }}>Pending</th>
                  <th>Status</th>
                  <th className="num" style={{ textAlign: "right", width: 120 }}>Load Now</th>
                  {canEdit && <th style={{ width: 44 }} aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {selPieces.map((r) => (
                  <tr key={keyOf(r)}>
                    <td className="mono">{rowLabelIn(selected, r)}</td>
                    <td className="num mono">{fmt(r.ordered)}</td>
                    <td className="num mono">{fmt(r.loaded)}</td>
                    <td className="num mono" style={r.pending > 0 ? amber : undefined}>{fmt(r.pending)}</td>
                    <td style={{ whiteSpace: "nowrap" }}><StatusCell pending={r.pending} rd={r.rd} /></td>
                    <td className="num">{loadNow(r, 100)}</td>
                    {canEdit && (
                      <td>
                        <MoreMenu kebab icon="plus" title="Loading actions" items={[rowItem(r)]} />
                      </td>
                    )}
                  </tr>
                ))}
                {selPieces.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 7 : 6} className="muted" style={{ textAlign: "center", padding: 18 }}>No cut pieces on this panel.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {recording && (
        <RecordLoadModal
          orders={[o]}
          panelsById={panelsById}
          stock={stock}
          initialQty={Object.fromEntries(rows.map((r) => [keyOf(r), recording.only ? (recording.only.has(keyOf(r)) ? val(r) || r.pending : 0) : val(r)]))}
          onDone={onChanged}
          onClose={() => setRecording(false)}
        />
      )}
      {/* CR-450: the Requirements card (need · in stock · allocated · short · Available tick · Allocate Stock) lives here, not on Details. */}
      <RequirementsCard order={order} reqs={reqs} onChanged={onChanged} />
    </div>
  );
}

/* ---------------- Actions tab — sample orders (CR-485) ---------------- */
/** The panel tab's shape for a sample order: one row per sample line (always Ready — no marks, no booking),
    Load Now + "+" Load… per row, Load Copy per trip and Dispatch in the card head. One card — no pieces
    card, no Requirements. The header Record Load button is gone; the Dispatch tab keeps its own. */
export function SampleActionsTab({ order, onChanged }: { order: SampleOrderRow; onChanged: () => void }) {
  const o: LoadableOrder = { ...order, type: "Sample" };
  const rows: ReadyRow[] = progressOf(o).map((r) => ({ ...r, rd: readinessOf(o, r, []) }));
  const open = isOpen(o);
  const canEdit = can("panel_craft", "edit");
  const keyOf = (r: ProgressRow) => `${order.id}|${rowKey(r)}`;
  const [qty, setQty] = useState<Record<string, number>>({});
  const [recording, setRecording] = useState<false | { only?: Set<string> }>(false);
  const val = (r: ReadyRow) => qty[keyOf(r)] ?? r.pending;
  const set = (r: ProgressRow, v: number) => setQty((p) => ({ ...p, [keyOf(r)]: Math.max(0, Math.min(r.pending, Math.floor(v) || 0)) }));
  const total = rows.reduce((s, r) => s + val(r), 0);
  const pendingRows = rows.filter((r) => r.pending > 0).length;
  const lineOf = (id: string) => order.lines.find((l) => l.id === id);
  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-head">
          <span style={{ fontWeight: 600 }}>Ready to Dispatch</span>
          {pendingRows > 0 && <Chip tone="green" label={`${pendingRows} of ${pendingRows} ready`} />}
          <span style={{ flex: 1 }} />
          <MoreMenu
            label="Load Copy"
            title="Download the Load Copy of one trip — only what left on that vehicle"
            items={[...order.loads].reverse().map((ld) => ({
              label: `${ld.loadNumber || "Load"} · ${ld.vehicle || "—"}`,
              title: [ld.date, ld.driverName].filter(Boolean).join(" · "),
              onClick: () => loadCopy(o, ld),
            }))}
          />
          {canEdit && (
            <button className="hbtn primary" disabled={!open || total === 0} onClick={() => setRecording({})} title={!open ? "Order is closed" : total === 0 ? "Type a quantity to dispatch" : "Record the vehicle load for these quantities"}>
              <Icon name="truck" size={13} /> Dispatch
            </button>
          )}
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Piece</th>
                <th className="num" style={{ textAlign: "right" }}>Requested</th>
                <th className="num" style={{ textAlign: "right" }}>Supplied</th>
                <th className="num" style={{ textAlign: "right" }}>Pending</th>
                <th>Status</th>
                <th className="num" style={{ textAlign: "right", width: 120 }}>Load Now</th>
                {canEdit && <th style={{ width: 44 }} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const l = lineOf(r.lineId);
                return (
                  <tr key={keyOf(r)}>
                    <td style={{ whiteSpace: "nowrap" }}><LineCell label={l?.designName || "—"} o={o} lineId={r.lineId} /></td>
                    <td className="mono">{!l ? "—" : l.pieceKind === "Cut" ? `${SAMPLE_PIECE_LABEL.Cut} · ${l.cutSizeName || "—"}` : SAMPLE_PIECE_LABEL.Full}</td>
                    <td className="num mono">{fmt(r.ordered)}</td>
                    <td className="num mono">{fmt(r.loaded)}</td>
                    <td className="num mono" style={r.pending > 0 ? { color: "var(--c-amber)", fontWeight: 600 } : undefined}>{fmt(r.pending)}</td>
                    <td style={{ whiteSpace: "nowrap" }}><StatusCell pending={r.pending} rd={r.rd} /></td>
                    <td className="num">
                      <NumberInput min={0} value={val(r)} onChange={(e) => set(r, Number(e.target.value))} placeholder="0" style={{ width: 100, textAlign: "right" }} aria-label={`${l?.designName || "line"} loading now`} disabled={!open || !canEdit || r.pending === 0} />
                    </td>
                    {canEdit && (
                      <td>
                        <MoreMenu kebab icon="plus" title="Loading actions" items={[loadRowItem(r, open, canEdit, () => setRecording({ only: new Set([keyOf(r)]) }))]} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 8 : 7} className="muted" style={{ textAlign: "center", padding: 18 }}>No samples on this order.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {recording && (
        <RecordLoadModal
          orders={[o]}
          initialQty={Object.fromEntries(rows.map((r) => [keyOf(r), recording.only ? (recording.only.has(keyOf(r)) ? val(r) || r.pending : 0) : val(r)]))}
          onDone={onChanged}
          onClose={() => setRecording(false)}
        />
      )}
    </div>
  );
}

/* ---------------- Dispatch tab ---------------- */
export function PanelLoadsTab({
  order,
  panelsById,
  stock,
  unitOf,
  onChanged,
}: {
  order: LoadableOrder;
  panelsById?: Map<string, PanelRow>;
  stock?: Map<string, number>;
  /** CR-349/405: live kg of ONE unit of a row (a piece of that kind, or a board); omit to hide the Weight column. */
  unitOf?: (row: ProgressRow) => number | null;
  onChanged: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = progressOf(order, panelsById);
  const open = isOpen(order);
  const status = loadStatusOf(order, panelsById);
  const pending = pendingText(rows);
  const canEdit = can("panel_craft", "edit");
  const loads: LoadRow[] = order.loads;
  // Weight per LINE (pieces · board): shipped part = stamped kg on the loads (a legacy whole-panel load
  // line covers every piece kind at once, so pieces are one figure per line); pending part = live unit × pending.
  const lineKg = (lineId: string) => (unitOf ? lineWeightSplit(lineId, loads, rows, unitOf) : { pieces: null, mdf: null });
  const lineIds = [...new Set(rows.map((r) => r.lineId))];
  const splits = lineIds.map(lineKg);
  const hasMdf = (lineId: string) => rows.some((r) => r.lineId === lineId && r.material === "Mdf");
  const totalKg = unitOf && splits.every((s, i) => s.pieces != null && (!hasMdf(lineIds[i]) || s.mdf != null)) ? splits.reduce((t, s) => t + (s.pieces ?? 0) + (s.mdf ?? 0), 0) : null;
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
        <div className="card-head">
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
                {unitOf && <th className="num" style={{ textAlign: "right" }}>Weight</th>}
              </tr>
            </thead>
            <tbody>
              {groupByLine(rows).map((group) => {
                const split = lineKg(group[0].lineId);
                const pieceRows = group.filter((r) => r.material !== "Mdf").length;
                return [
                  ...group.map((r, i) => (
                    <tr key={rowKey(r)}>
                      {i === 0 && <td rowSpan={group.length} style={{ verticalAlign: "middle" }}><LineCell label={lineLabel(order, r.lineId)} o={order} lineId={r.lineId} panelsById={panelsById} /></td>}
                      <td className="mono">{rowLabelIn(group, r)}</td>
                      <td className="num mono">{fmt(r.ordered)}</td>
                      <td className="num mono">{fmt(r.loaded)}</td>
                      <td className="num mono" style={r.pending > 0 ? { color: "var(--c-amber)", fontWeight: 600 } : undefined}>{fmt(r.pending)}</td>
                      {/* CR-405: pieces kg once per line (spanning its piece rows), the board's on its own row */}
                      {unitOf && r.material === "Mdf" && <td className="num mono" title="Shipped kg are frozen on the load; pending kg follow the master">{kg(split.mdf)}</td>}
                      {unitOf && r.material !== "Mdf" && i === 0 && <td className="num mono" rowSpan={pieceRows} style={{ verticalAlign: "middle" }} title="All of this line's pieces — shipped kg are frozen on the load; pending kg follow the master">{kg(split.pieces)}</td>}
                    </tr>
                  )),
                ];
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={unitOf ? 6 : 5} className="muted" style={{ textAlign: "center", padding: 18 }}>No lines on this order.</td>
                </tr>
              )}
            </tbody>
            {unitOf && rows.length > 0 && (
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
        <div className="card-head">
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
                  <td>{ld.lines.map((l) => loadLineText(order, l)).join("; ") || "—"}</td>
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
                        { label: "Load Copy", title: "Download the Load Copy PDF", onClick: () => loadCopy(order, ld) },
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
      </div>

      {recording && <RecordLoadModal orders={[order]} panelsById={panelsById} stock={stock} onDone={onChanged} onClose={() => setRecording(false)} />}
    </div>
  );
}
