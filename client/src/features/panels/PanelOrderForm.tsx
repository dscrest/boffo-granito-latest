/* ============================================================
   Panel Order form — a customer orders one showcase Panel × qty.
   Sales Person defaults to the logged-in user (grey, auto); Order
   Date defaults to today. After picking Panel + Qty the form shows
   the cut-piece requirement vs on-hand, so the operator already
   knows whether it will dispatch directly or needs a cutting job.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { cachedCustomers, listCustomers, type CustomerRow } from "@/features/masters/customersApi";
import { cachedSalesPersons, currentSalespersonName, listSalesPersons } from "@/features/masters/salespersonApi";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedCutStock, listCutStock, stockKey, type PanelOrderInput } from "./panelOrdersApi";
import { PanelPickerModal } from "./PanelPickerModal";

export function PanelOrderForm({
  presetPanelId,
  onSave,
  onClose,
}: {
  /** Pre-select a panel (e.g. New Order from a panel detail page). */
  presetPanelId?: string;
  onSave: (input: PanelOrderInput) => void;
  onClose: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [salesperson, setSalesperson] = useState(() => currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState("");
  const [panelId, setPanelId] = useState(presetPanelId ?? "");
  const [qty, setQty] = useState(1);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void listCustomers().then((r) => r.ok && setCustomers(r.customers));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
    void listCutStock().then((r) => r.ok && setStock(r.stock));
    void listSalesPersons().then((r) => r.ok && setSalesperson((s) => s || currentSalespersonName(r.salesPersons)));
  }, []);

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers],
  );
  const panel = panels.find((p) => p.id === panelId);
  // Requirement preview: need = line qty × order qty, against current on-hand.
  const preview = useMemo(
    () =>
      (panel?.lines ?? []).map((l) => {
        const need = l.qty * qty;
        const have = stock.get(stockKey(l.designId, l.cutSizeId)) ?? 0;
        return { key: l.id, label: `${l.designName} · ${l.cutSizeName}`, need, have, short: need > have };
      }),
    [panel, qty, stock],
  );
  const covered = preview.length > 0 && preview.every((p) => !p.short);

  const canSave = !!customer && !!panelId && qty > 0;

  const submit = () => {
    if (!canSave) return;
    onSave({ panel: panelId, customer, qty, salesperson, order_date: orderDate });
  };

  // With the picker stacked on top, both modals' document-level Esc handlers
  // fire — route this one to close the picker so one Esc closes only it.
  const panelRef = useModalA11y(pickerOpen ? () => setPickerOpen(false) : onClose);

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="orders" size={18} />
          </div>
          <div>
            <div className="ttl">New Panel Order</div>
            <div className="sub2">Panel Craft</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Order</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Customer<span className="req"> *</span>
                </span>
                <Combobox value={customer} options={customerOptions} onChange={setCustomer} placeholder="Select customer…" ariaLabel="Customer" />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Panel<span className="req"> *</span>
                </span>
                <button type="button" className="picker-trigger" onClick={() => setPickerOpen(true)} aria-label="Panel" aria-haspopup="dialog">
                  {panel ? <span className="val">{panel.panelCode}</span> : <span className="ph">Select panel…</span>}
                  <Icon name="search" size={13} />
                </button>
              </label>
              <label className="form-field">
                <span className="lbl">
                  Qty (panels)<span className="req"> *</span>
                </span>
                <NumberInput min={1} value={qty || ""} onChange={(e) => setQty(Number(e.target.value) || 0)} placeholder="e.g. 1" />
              </label>
              <label className="form-field">
                <span className="lbl">Order Date</span>
                <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </label>
              <label className="form-field">
                <span className="lbl">Sales Person</span>
                <input
                  value={salesperson}
                  readOnly
                  tabIndex={-1}
                  placeholder="From your sign-in"
                  title="Auto-filled from your sign-in"
                />
              </label>
            </div>
          </div>

          {preview.length > 0 && (
            <div className="form-section">
              <div className="form-section-title">Cut Piece Stock Check</div>
              {preview.map((p) => (
                <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: "var(--t-md)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.short ? "var(--c-red)" : "var(--c-green)", flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
                  <span className="mono dim">
                    {fmt(p.have)} of {fmt(p.need)} pcs
                  </span>
                </div>
              ))}
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
                {covered ? "Stock covers this order — it can dispatch directly." : "Short on cut pieces — the order will need a cutting job."}
              </div>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={submit} disabled={!canSave}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>

        {pickerOpen && (
          <PanelPickerModal panels={panels} selectedId={panelId} onSelect={setPanelId} onClose={() => setPickerOpen(false)} />
        )}
      </div>
    </div>
  );
}
