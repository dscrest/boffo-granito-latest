/* ============================================================
   Customer ▸ Labels tab (CR-502): the customer's own barcode per item
   (Item Barcodes — add / edit / Excel import) and the sticker templates
   that print for them (Label Templates, with a live PDF preview).
   `LabelTemplatesMaster` reuses the templates half under Settings ▸
   Masters, where the house (all-customer) templates live.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { confirmDelete, confirmDiscard } from "@/ui/ConfirmDialog";
import { useModalA11y } from "@/ui/useModalA11y";
import { can } from "@/lib/auth";
import { barcodeProblem } from "@/lib/code128";
import { pdfBlobUrl } from "@/lib/pdf";
import { MoreMenu } from "@/features/common/DetailBits";
import { useMasters } from "@/features/masters/useMasters";
import { ItemSearchModal } from "@/features/masters/ItemSearchModal";
import type { DesignRow } from "@/features/masters/designsApi";
import { listItemCodes, listTemplates, removeItemCode, removeTemplate, saveItemCode, saveTemplate, type ItemCode, type LabelLayoutKey, type LabelTemplate } from "./labelsApi";
import { buildLabelDoc, defaultTexts, LAYOUTS, layoutOf, PLACEHOLDERS, type LabelRow } from "./labelLayouts";
import { PrintLabelsModal, type PrintLabelInput } from "./PrintLabelsModal";

const canEdit = () => can("customers", "edit");

/* ---------------- Item Barcodes ---------------- */

function ItemCodeModal({ customerId, existing, taken, onSaved, onClose }: {
  customerId: string;
  existing?: ItemCode;
  /** This customer's other rows — client-side duplicate check (the server repeats it). */
  taken: ItemCode[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const { designRows } = useMasters();
  const [designId, setDesignId] = useState(existing?.designId || "");
  const [barcode, setBarcode] = useState(existing?.barcode || "");
  const [name, setName] = useState(existing?.customerItemName || "");
  const [search, setSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = designId !== (existing?.designId || "") || barcode !== (existing?.barcode || "") || name !== (existing?.customerItemName || "");
  const close = async () => {
    if (dirty && !(await confirmDiscard())) return;
    onClose();
  };
  const panelRef = useModalA11y(() => void close());
  const options = useMemo(() => designRows.filter((d) => d.status === "Active").map((d) => ({ value: d.id, label: d.designName, hint: d.itemCode || d.sizeLabel })), [designRows]);
  const others = taken.filter((t) => t.id !== existing?.id);
  const problem = barcodeProblem(barcode) || (others.some((t) => t.barcode === barcode) ? "This barcode is already on another item" : "") || (others.some((t) => t.designId === designId) ? "This item already has a barcode" : "");
  const save = async () => {
    if (!designId || !barcode || problem) return;
    setSaving(true);
    const res = await saveItemCode({ customerId, designId, barcode, customerItemName: name }, existing?.id);
    setSaving(false);
    if (!res.ok) { toast.error(res.error || "Could not save"); return; }
    toast.success("Barcode saved");
    onSaved();
    onClose();
  };
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="qr" size={18} /></div>
          <div style={{ flex: 1 }}><div className="ttl">{existing ? "Edit Item Barcode" : "New Item Barcode"}</div></div>
          <button className="btn x" onClick={() => void close()} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div className="form-rows">
            <label className="form-field span2">
              <span className="lbl">Item<span className="req"> *</span></span>
              <div className="ctl-row">
                <Combobox value={designId} options={options} onChange={setDesignId} placeholder="Search items…" ariaLabel="Item" invalid={!designId} />
                <button type="button" className="btn" aria-label="Search items" title="Search items" onClick={() => setSearch(true)}><Icon name="search" size={13} /></button>
              </div>
            </label>
            <label className="form-field">
              <span className="lbl">Barcode<span className="req"> *</span></span>
              <input value={barcode} className={`mono${problem ? " error" : ""}`} placeholder="As the customer gives it" onChange={(e) => setBarcode(e.target.value.trim())} aria-label="Barcode" />
            </label>
            <label className="form-field">
              <span className="lbl">Customer Item Name</span>
              <input value={name} placeholder="Blank = our design name" onChange={(e) => setName(e.target.value)} aria-label="Customer item name" />
            </label>
          </div>
          {problem && <div style={{ color: "var(--c-red)", fontSize: "var(--t-sm)", marginTop: 8 }}>{problem}</div>}
        </div>
        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={() => void close()}>Cancel</button>
          <button className="hbtn primary" disabled={saving || !designId || !barcode || !!problem} onClick={() => void save()}>
            <Icon name="check" size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {search && <ItemSearchModal onPick={(d: DesignRow) => setDesignId(d.id)} onClose={() => setSearch(false)} />}
    </div>
  );
}

/* Excel import: Item Code / Item Name · EAN-13 · Customer Item Name → preview → Save. */
function ImportCodesModal({ customerId, taken, onSaved, onClose }: { customerId: string; taken: ItemCode[]; onSaved: () => void; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const { designRows } = useMasters();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ item: string; barcode: string; name: string; design?: DesignRow; existing?: ItemCode; error: string }[] | null>(null);
  const [busy, setBusy] = useState(false);

  const parse = async (f: File) => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer());
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      const data = aoa.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
      const heads = data[0]?.map((h) => String(h ?? "").trim().toLowerCase()) ?? [];
      const col = (...keys: string[]) => heads.findIndex((h) => keys.some((k) => h.includes(k)));
      const ci = col("item", "design", "name"), cb = col("ean", "barcode", "gtin"), cn = col("customer item", "customer name", "their");
      if (ci < 0 || cb < 0) throw new Error("Need an Item column and an Barcode column in the header row.");
      const seen = new Set<string>();
      const byKey = new Map<string, DesignRow>();
      for (const d of designRows) for (const k of [d.itemCode, d.designName, d.uniqueName, d.sku]) if (k) byKey.set(k.trim().toLowerCase(), d);
      setRows(data.slice(1).map((r) => {
        const item = String(r[ci] ?? "").trim();
        const barcode = String(r[cb] ?? "").trim();
        const name = cn >= 0 && cn !== ci ? String(r[cn] ?? "").trim() : "";
        const design = byKey.get(item.toLowerCase());
        const existing = design && taken.find((t) => t.designId === design.id);
        const dupInFile = seen.has(barcode);
        seen.add(barcode);
        const error = !design ? `Item not found: ${item}` : !barcode ? "Barcode is blank" : barcodeProblem(barcode) || (dupInFile ? "Barcode repeats in the file" : "") || (taken.some((t) => t.barcode === barcode && t.designId !== design.id) ? "Barcode already on another item" : "");
        return { item, barcode, name, design, existing, error };
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setBusy(false);
    }
  };
  const good = (rows || []).filter((r) => !r.error);
  const save = async () => {
    setBusy(true);
    let n = 0;
    for (const r of good) {
      const res = await saveItemCode({ customerId, designId: r.design!.id, barcode: r.barcode, customerItemName: r.name || r.existing?.customerItemName || "" }, r.existing?.id);
      if (!res.ok) { toast.error(`${r.item}: ${res.error || "failed"}`); break; }
      n++;
    }
    setBusy(false);
    if (n) toast.success(`${n} barcode${n === 1 ? "" : "s"} saved`);
    onSaved();
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="upload" size={18} /></div>
          <div style={{ flex: 1 }}><div className="ttl">Import Item Barcodes</div></div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          {rows === null ? (
            <>
              <button className="hbtn" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" size={13} /> Choose Excel / CSV</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void parse(f); e.target.value = ""; }} />
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 10 }}>Columns: Item (code or name) · Barcode · Customer Item Name (optional). The header row names them.</div>
            </>
          ) : (
            <div style={{ maxHeight: "55vh", overflow: "auto" }}>
              <table className="tbl">
                <thead><tr><th>Item</th><th>Barcode</th><th>Customer Item Name</th><th>Result</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.design?.designName || r.item}</td>
                      <td className="mono">{r.barcode}</td>
                      <td>{r.name || <span className="dim">—</span>}</td>
                      <td style={{ color: r.error ? "var(--c-red)" : undefined }}>{r.error || (r.existing ? "Update" : "New")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="df-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          {rows !== null && (
            <button className="hbtn primary" disabled={busy || !good.length} onClick={() => void save()}>
              <Icon name="check" size={13} /> {busy ? "Saving…" : `Save ${good.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemBarcodes({ customerId }: { customerId: string }) {
  const { designRows } = useMasters();
  const [rows, setRows] = useState<ItemCode[] | null>(null);
  const [editing, setEditing] = useState<ItemCode | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  // Item-wise printing straight from the list (user 2026-10-30) — no production / order needed.
  const [printing, setPrinting] = useState<PrintLabelInput[] | null>(null);
  const load = () => void listItemCodes(customerId).then((r) => setRows(r.rows));
  useEffect(load, [customerId]);
  const design = (id: string) => designRows.find((d) => d.id === id);
  const del = async (r: ItemCode) => {
    const reason = await confirmDelete({ message: `Are you sure you want to delete the barcode ${r.barcode} for "${design(r.designId)?.designName || "this item"}"?` });
    if (reason == null) return;
    const res = await removeItemCode(r.id, reason);
    if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
    toast.success("Barcode deleted");
    load();
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="form-section-title" style={{ margin: 0, flex: 1 }}>Item Barcodes</div>
        {!!rows?.length && (
          <button className="hbtn sm" onClick={() => setPrinting(rows.map((r) => ({ designId: r.designId, boxes: 1 })))}><Icon name="printer" size={12} /> Print Labels</button>
        )}
        {canEdit() && (
          <>
            <button className="hbtn sm" onClick={() => setImporting(true)}><Icon name="upload" size={12} /> Import</button>
            <button className="hbtn sm primary" onClick={() => setEditing("new")}><Icon name="plus" size={12} /> New</button>
          </>
        )}
      </div>
      <table className="tbl">
        <thead><tr><th>Item</th><th>Customer Item Name</th><th>Barcode</th><th /></tr></thead>
        <tbody>
          {rows === null ? (
            <tr><td colSpan={4} className="dim">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={4} className="dim">No barcodes yet — the customer's own code per item goes here.</td></tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} style={{ cursor: canEdit() ? "pointer" : undefined }} onClick={() => canEdit() && setEditing(r)}>
                <td style={{ fontWeight: 600 }}>{design(r.designId)?.designName || "—"}<span className="dim" style={{ fontSize: "var(--t-sm)" }}> {design(r.designId)?.sizeLabel}</span></td>
                <td>{r.customerItemName || <span className="dim">—</span>}</td>
                <td className="mono">{r.barcode}</td>
                <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                  <MoreMenu kebab items={[
                    { label: "Print Labels", onClick: () => setPrinting([{ designId: r.designId, boxes: 1 }]) },
                    ...(canEdit() ? [{ label: "Edit", onClick: () => setEditing(r) }, { label: "Delete", danger: true, onClick: () => void del(r) }] : []),
                  ]} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {editing && <ItemCodeModal customerId={customerId} existing={editing === "new" ? undefined : editing} taken={rows || []} onSaved={load} onClose={() => setEditing(null)} />}
      {importing && <ImportCodesModal customerId={customerId} taken={rows || []} onSaved={load} onClose={() => setImporting(false)} />}
      {printing && <PrintLabelsModal customerId={customerId} inputs={printing} onClose={() => setPrinting(null)} />}
    </>
  );
}

/* ---------------- Label Templates ---------------- */

const SAMPLE: LabelRow = { item: "Lemurian Gunmetal", customerItem: "", barcode: "4778005614206", widthMm: 600, lengthMm: 1200, thicknessMm: 8.8, finish: "H.G.", batch: "251202", mfgDate: "2025-12-02" };

function TemplateModal({ customerId, lockCustomer, existing, onSaved, onClose }: {
  /** Preset customer ("" = all customers). */
  customerId: string;
  /** Customer tab: the template belongs to this customer, no picker. */
  lockCustomer: boolean;
  existing?: LabelTemplate;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { customers } = useMasters();
  const [t, setT] = useState<Omit<LabelTemplate, "id">>(() =>
    existing
      ? { name: existing.name, customerId: existing.customerId, layout: existing.layout, widthMm: existing.widthMm, heightMm: existing.heightMm, texts: { ...existing.texts }, active: existing.active }
      : { name: "", customerId, layout: "barcode-strip", widthMm: 75, heightMm: 20, texts: defaultTexts(layoutOf("barcode-strip")), active: true },
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState("");
  const close = async () => {
    if (dirty && !(await confirmDiscard())) return;
    onClose();
  };
  const panelRef = useModalA11y(() => void close());
  const layout = layoutOf(t.layout);
  const patch = (p: Partial<typeof t>) => { setT((x) => ({ ...x, ...p })); setDirty(true); };
  const setLayout = (key: string) => {
    const l = layoutOf(key);
    patch({ layout: l.key, widthMm: l.defaultSize[0], heightMm: l.defaultSize[1], texts: defaultTexts(l) });
  };

  // Live preview, debounced — the sample row stands in for a real box.
  useEffect(() => {
    const h = setTimeout(() => {
      void pdfBlobUrl(buildLabelDoc({ id: "", ...t }, [{ row: SAMPLE, copies: 1 }])).then((u) => setPreview((old) => { if (old) URL.revokeObjectURL(old); return u; })).catch(() => setPreview(""));
    }, 400);
    return () => clearTimeout(h);
  }, [t]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const save = async () => {
    if (!t.name.trim()) return;
    setSaving(true);
    const res = await saveTemplate(t, existing?.id);
    setSaving(false);
    if (!res.ok) { toast.error(res.error || "Could not save"); return; }
    toast.success("Template saved");
    onSaved();
    onClose();
  };
  const customerOptions = [{ value: "", label: "All customers", hint: "house sticker" }, ...customers.map((c) => ({ value: c.id, label: c.name, hint: c.code }))];
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="printer" size={18} /></div>
          <div style={{ flex: 1 }}><div className="ttl">{existing ? "Edit Label Template" : "New Label Template"}</div></div>
          <button className="btn x" onClick={() => void close()} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16 }}>
          <div>
            <div className="form-rows">
              <label className="form-field">
                <span className="lbl">Name<span className="req"> *</span></span>
                <input value={t.name} className={t.name.trim() ? "" : "error"} onChange={(e) => patch({ name: e.target.value })} aria-label="Template name" />
              </label>
              <label className="form-field">
                <span className="lbl">For</span>
                {lockCustomer ? <input value={customers.find((c) => c.id === customerId)?.name || "This customer"} readOnly tabIndex={-1} /> : <Combobox value={t.customerId} options={customerOptions} onChange={(v) => patch({ customerId: v })} ariaLabel="For customer" clearable={false} />}
              </label>
              <label className="form-field">
                <span className="lbl">Layout<span className="req"> *</span></span>
                <Combobox value={t.layout} options={LAYOUTS.map((l) => ({ value: l.key, label: l.label, hint: `${l.defaultSize[0]}×${l.defaultSize[1]} mm` }))} onChange={setLayout} ariaLabel="Layout" clearable={false} />
              </label>
              <label className="form-field">
                <span className="lbl">Size (mm)</span>
                <div className="ctl-row">
                  <NumberInput value={String(t.widthMm || "")} maxDecimals={1} onChange={(e) => patch({ widthMm: Number(e.target.value) || 0 })} aria-label="Width mm" style={{ width: 80 }} />
                  <span className="dim">×</span>
                  <NumberInput value={String(t.heightMm || "")} maxDecimals={1} onChange={(e) => patch({ heightMm: Number(e.target.value) || 0 })} aria-label="Height mm" style={{ width: 80 }} />
                </div>
              </label>
              <label className="form-field">
                <span className="lbl">Status</span>
                <Combobox value={t.active ? "1" : "0"} options={[{ value: "1", label: "Active" }, { value: "0", label: "Inactive" }]} onChange={(v) => patch({ active: v === "1" })} ariaLabel="Status" clearable={false} />
              </label>
            </div>
            <div className="form-divider" />
            <div className="form-rows one">
              {layout.fields.map((f) => (
                <label key={f.key} className="form-field">
                  <span className="lbl">{f.label}</span>
                  {f.multiline ? (
                    <textarea value={t.texts[f.key] ?? ""} onChange={(e) => patch({ texts: { ...t.texts, [f.key]: e.target.value } })} aria-label={f.label} />
                  ) : (
                    <input value={t.texts[f.key] ?? ""} onChange={(e) => patch({ texts: { ...t.texts, [f.key]: e.target.value } })} aria-label={f.label} />
                  )}
                </label>
              ))}
            </div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 10 }}>Placeholders: <span className="mono">{PLACEHOLDERS}</span></div>
          </div>
          <div>
            <div className="form-section-title" style={{ marginBottom: 6 }}>Preview</div>
            {preview ? (
              <iframe title="Label preview" src={`${preview}#toolbar=0&view=Fit`} style={{ width: "100%", height: 320, border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }} />
            ) : (
              <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Rendering…</div>
            )}
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>Sample item: {SAMPLE.item}, batch {SAMPLE.batch}.</div>
          </div>
        </div>
        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={() => void close()}>Cancel</button>
          <button className="hbtn primary" disabled={saving || !t.name.trim()} onClick={() => void save()}>
            <Icon name="check" size={13} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LabelTemplates({ customerId, title = "Label Templates" }: { customerId?: string; title?: string }) {
  const { customers } = useMasters();
  const [rows, setRows] = useState<LabelTemplate[] | null>(null);
  const [editing, setEditing] = useState<{ t?: LabelTemplate; clone?: boolean } | null>(null);
  const load = () => void listTemplates().then((r) => setRows(r.rows));
  useEffect(load, []);
  // Customer tab: theirs + the house ones; Masters: everything.
  const shown = (rows || []).filter((t) => customerId === undefined || !t.customerId || t.customerId === customerId);
  const del = async (t: LabelTemplate) => {
    const reason = await confirmDelete({ message: `Are you sure you want to delete the template "${t.name}"?` });
    if (reason == null) return;
    const res = await removeTemplate(t.id, reason);
    if (!res.ok) { toast.error(res.error || "Could not delete"); return; }
    toast.success("Template deleted");
    load();
  };
  const forLabel = (t: LabelTemplate) => (t.customerId ? customers.find((c) => c.id === t.customerId)?.name || "Customer" : "All customers");
  const clone = (t: LabelTemplate): LabelTemplate => ({ ...t, id: "", name: `${t.name} (copy)` });
  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <div className="form-section-title" style={{ margin: 0, flex: 1 }}>{title}</div>
        {canEdit() && <button className="hbtn sm primary" onClick={() => setEditing({})}><Icon name="plus" size={12} /> New</button>}
      </div>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Layout</th><th>Size</th><th>For</th><th /></tr></thead>
        <tbody>
          {rows === null ? (
            <tr><td colSpan={5} className="dim">Loading…</td></tr>
          ) : shown.length === 0 ? (
            <tr><td colSpan={5} className="dim">No templates yet — one per sticker the customer needs.</td></tr>
          ) : (
            shown.map((t) => (
              <tr key={t.id} style={{ cursor: canEdit() ? "pointer" : undefined, opacity: t.active ? 1 : 0.6 }} onClick={() => canEdit() && setEditing({ t })}>
                <td style={{ fontWeight: 600 }}>{t.name}{!t.active && <span className="dim"> · Inactive</span>}</td>
                <td>{layoutOf(t.layout).label}</td>
                <td className="mono">{t.widthMm}×{t.heightMm} mm</td>
                <td>{forLabel(t)}</td>
                <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                  {canEdit() && <MoreMenu kebab items={[{ label: "Edit", onClick: () => setEditing({ t }) }, { label: "Clone", onClick: () => setEditing({ t: clone(t), clone: true }) }, { label: "Delete", danger: true, onClick: () => void del(t) }]} />}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {editing && (
        <TemplateModal
          customerId={editing.t ? editing.t.customerId : customerId || ""}
          lockCustomer={customerId !== undefined && (!editing.t || editing.t.customerId === customerId)}
          existing={editing.t}
          onSaved={load}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function CustomerLabels({ customerId }: { customerId: string }) {
  return (
    <div style={{ display: "grid", gap: 22 }}>
      <div><ItemBarcodes customerId={customerId} /></div>
      <div><LabelTemplates customerId={customerId} /></div>
    </div>
  );
}

/** Settings ▸ Masters ▸ Export ▸ Label Templates — every template, house ones included. */
export const LabelTemplatesMaster = () => <LabelTemplates />;

export type { LabelLayoutKey };
