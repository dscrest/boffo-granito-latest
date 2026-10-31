/* ============================================================
   Print Box Labels (CR-502) — ONE modal behind every entry point
   (production record · Sales Order · Palletization plan). Caller passes
   the box rows (item · batch · boxes); the modal resolves the customer's
   barcode + item name, the batch's mfg date and the sticker templates
   that apply, and prints ONE PDF per template (each sticker size is its
   own roll). Nothing is saved — footer is Cancel only.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { downloadPdf } from "@/lib/pdf";
import { fmtLocalDate } from "@/lib/format";
import { useMasters } from "@/features/masters/useMasters";
import { cachedSizes, listSizes, type SizeRow } from "@/features/masters/sizesApi";
import { listBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";
import { listItemCodes, listTemplates, templatesFor, type ItemCode, type LabelTemplate } from "./labelsApi";
import { buildLabelDoc, defaultTexts, LAYOUTS, layoutOf, type LabelRow } from "./labelLayouts";

/* No saved template yet → the three built-in stickers print as they come (user 2026-10-30: a
   print modal with no Print button is a dead end). Saving a template only customises the texts. */
const builtIn = (): LabelTemplate[] => LAYOUTS.map((l) => ({ id: `builtin-${l.key}`, name: `${l.label} (built-in)`, customerId: "", layout: l.key, widthMm: l.defaultSize[0], heightMm: l.defaultSize[1], texts: defaultTexts(l), active: true }));

export interface PrintLabelInput {
  designId: string;
  batch?: string;
  boxes: number;
}

interface Row extends PrintLabelInput {
  copies: string;
}

export function PrintLabelsModal({
  customerId: initialCustomerId = "",
  customerName = "",
  inputs,
  onClose,
}: {
  customerId?: string;
  /** Fallback when the caller only knows the name (production groups). */
  customerName?: string;
  inputs: PrintLabelInput[];
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const { customers, designRows } = useMasters();
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [rows, setRows] = useState<Row[]>(() => inputs.map((i) => ({ ...i, batch: i.batch || "", copies: String(Math.max(1, i.boxes || 1)) })));
  const [sizes, setSizes] = useState<SizeRow[]>(() => cachedSizes() ?? []);
  const [stock, setStock] = useState<BatchStockRow[]>([]);
  const [codes, setCodes] = useState<ItemCode[]>([]);
  const [templates, setTemplates] = useState<LabelTemplate[] | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void listSizes().then((r) => r.ok && setSizes(r.sizes));
    void listBatchStock().then((r) => r.ok && setStock(r.rows));
    void listItemCodes().then((r) => setCodes(r.rows));
    void listTemplates().then((r) => {
      if (!r.ok) toast.error(r.error || "Could not load the label templates");
      setTemplates(r.rows);
    });
  }, []);
  // Name → id when the caller had only the name.
  useEffect(() => {
    if (!customerId && customerName && customers.length) {
      const c = customers.find((x) => x.name === customerName);
      if (c) setCustomerId(c.id);
    }
  }, [customerId, customerName, customers]);

  const customerOptions = useMemo(() => customers.map((c) => ({ value: c.id, label: c.name, hint: c.code })), [customers]);
  const batchesOf = (designId: string) => stock.filter((s) => s.designId === designId && s.batchNumber);

  // Auto-pick the batch when the item has exactly one.
  useEffect(() => {
    if (!stock.length) return;
    setRows((rs) => rs.map((r) => (r.batch ? r : batchesOf(r.designId).length === 1 ? { ...r, batch: batchesOf(r.designId)[0].batchNumber } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock]);

  const resolved = rows.map((r) => {
    const d = designRows.find((x) => x.id === r.designId);
    const size = sizes.find((s) => s.id === d?.sizeId);
    const code = codes.find((c) => c.customerId === customerId && c.designId === r.designId);
    const b = stock.find((s) => s.designId === r.designId && s.batchNumber === r.batch);
    const label: LabelRow = {
      item: d?.designName || "",
      customerItem: code?.customerItemName || "",
      barcode: code?.barcode || "",
      widthMm: d?.widthMm || size?.widthMm || 0,
      lengthMm: d?.lengthMm || size?.lengthMm || 0,
      thicknessMm: size?.thicknessMm || 0,
      finish: d?.finishLabel || "",
      batch: r.batch || "",
      mfgDate: b?.mfgDate || "",
    };
    return { r, d, label, copies: Math.max(0, Number(r.copies) || 0) };
  });

  const saved = templates ? templatesFor(templates, customerId) : [];
  const applicable = saved.length ? saved : builtIn();

  const print = async (tpl: LabelTemplate) => {
    const layout = layoutOf(tpl.layout);
    const pages = resolved.filter(({ label, copies }) => copies > 0 && (!layout.needsBarcode || label.barcode)).map(({ label, copies }) => ({ row: label, copies }));
    if (!pages.length) return;
    setBusy(tpl.id);
    try {
      await downloadPdf(buildLabelDoc(tpl, pages), `${tpl.name.replace(/[^\w-]+/g, "-")}-labels.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not build the PDF");
    } finally {
      setBusy("");
    }
  };

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const customer = customers.find((c) => c.id === customerId);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="printer" size={18} /></div>
          <div style={{ flex: 1 }}><div className="ttl">Print Box Labels</div></div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          <div className="form-rows one" style={{ maxWidth: 520, marginBottom: 12 }}>
            <label className="form-field">
              <span className="lbl">Customer</span>
              <Combobox value={customerId} options={customerOptions} onChange={setCustomerId} placeholder="Whose stickers…" ariaLabel="Customer" clearable={false} />
            </label>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Customer Item / Barcode</th>
                <th>Batch</th>
                <th>Mfg Date</th>
                <th className="num" style={{ textAlign: "right" }}>Copies</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map(({ r, d, label }, i) => {
                const opts = batchesOf(r.designId).map((b) => ({ value: b.batchNumber, label: b.batchNumber, hint: `${b.current} on hand` }));
                return (
                  <tr key={`${r.designId}-${i}`}>
                    <td style={{ fontWeight: 600 }}>{d?.designName || "—"}<div className="dim" style={{ fontSize: "var(--t-sm)" }}>{d?.sizeLabel}</div></td>
                    <td>
                      {label.barcode ? (
                        <>{label.customerItem || <span className="dim">{label.item}</span>}<div className="mono dim" style={{ fontSize: "var(--t-sm)" }}>{label.barcode}</div></>
                      ) : (
                        <span style={{ color: "var(--c-red)", fontSize: "var(--t-sm)" }}>No barcode for this item — add it on {customer ? `${customer.name} ▸ Labels` : "the customer's Labels tab"}</span>
                      )}
                    </td>
                    <td style={{ minWidth: 150 }}>
                      <Combobox value={r.batch || ""} options={opts} onChange={(v) => set(i, { batch: v })} placeholder="Batch…" ariaLabel="Batch" emptyText="No batch stock for this item" />
                    </td>
                    <td className="dim">{label.mfgDate ? fmtLocalDate(label.mfgDate) : "—"}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <NumberInput value={r.copies} maxDecimals={0} onChange={(e) => set(i, { copies: e.target.value })} style={{ width: 70, textAlign: "right" }} aria-label="Copies" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="form-section-title" style={{ margin: "14px 0 6px" }}>Stickers</div>
          {templates === null ? (
            <span className="dim">Loading…</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {!saved.length && <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Built-in stickers — to change the wording, size or language, save a template on the customer's Labels tab.</div>}
              {applicable.map((t) => {
                const layout = layoutOf(t.layout);
                const printable = resolved.filter(({ label, copies }) => copies > 0 && (!layout.needsBarcode || label.barcode));
                const pages = printable.reduce((n, x) => n + x.copies, 0);
                const skipped = resolved.length - printable.length;
                return (
                  <div key={t.id} className="row" style={{ gap: 10, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontWeight: 600 }}>{t.name}</span>
                      <span className="dim" style={{ fontSize: "var(--t-sm)" }}> · {layout.label} · {t.widthMm}×{t.heightMm} mm{!t.customerId && " · all customers"}</span>
                      {skipped > 0 && <div style={{ color: "var(--c-red)", fontSize: "var(--t-sm)" }}>{skipped} item{skipped === 1 ? "" : "s"} skipped — no barcode</div>}
                    </div>
                    <button className="hbtn primary" disabled={!pages || !!busy} onClick={() => void print(t)}>
                      <Icon name="printer" size={13} /> {busy === t.id ? "Building…" : `Print ${pages} label${pages === 1 ? "" : "s"}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="df-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
