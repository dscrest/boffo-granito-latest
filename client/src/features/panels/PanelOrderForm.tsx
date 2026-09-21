/* ============================================================
   Panel Order form — a customer orders showcase Panels × qty.
   Multi-pick (CR-193): one Save = one PanelOrder row per picked
   panel, sharing customer / date / sales person, so each panel
   still dispatches on its own against cut-piece stock.
   Sales Person defaults to the logged-in user (grey, auto); Order
   Date defaults to today. The cut-piece requirement across ALL
   picked panels is shown vs on-hand, so the operator already knows
   whether the sale dispatches directly or needs cutting jobs.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { cachedCustomers, listCustomers, type CustomerRow } from "@/features/masters/customersApi";
import { cachedSalesPersons, currentSalespersonName, listSalesPersons } from "@/features/masters/salespersonApi";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedCutStock, listCutStock, stockKey, type PanelOrderInput } from "./panelOrdersApi";
import { PanelPickerModal } from "./PanelPickerModal";

type Pick = { panelId: string; qty: number };

export function PanelOrderForm({
  onSave,
  onClose,
}: {
  /** One input per picked panel — the caller creates one order row each. */
  onSave: (inputs: PanelOrderInput[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [salesperson, setSalesperson] = useState(() => currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

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
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  const togglePick = (id: string) =>
    setPicks((p) => (p.some((x) => x.panelId === id) ? p.filter((x) => x.panelId !== id) : [...p, { panelId: id, qty: 1 }]));
  const setQty = (id: string, qty: number) => setPicks((p) => p.map((x) => (x.panelId === id ? { ...x, qty } : x)));

  // Requirement preview across every picked panel: need = Σ line qty × order
  // qty per (design, cut size), against current on-hand — all rows draw from
  // the same stock, so the aggregate is the honest check.
  const preview = useMemo(() => {
    const acc = new Map<string, { label: string; need: number }>();
    for (const { panelId, qty } of picks) {
      for (const l of panelById.get(panelId)?.lines ?? []) {
        const key = stockKey(l.designId, l.cutSizeId);
        const cur = acc.get(key) ?? { label: `${l.designName} · ${l.cutSizeName}`, need: 0 };
        cur.need += l.qty * qty;
        acc.set(key, cur);
      }
    }
    return [...acc].map(([key, v]) => {
      const have = stock.get(key) ?? 0;
      return { key, ...v, have, short: v.need > have };
    });
  }, [picks, panelById, stock]);
  const covered = preview.length > 0 && preview.every((p) => !p.short);

  const canSave = !!customer && picks.length > 0 && picks.every((p) => p.qty > 0);

  // The caller writes one row per panel, one after another — hold Save for
  // the whole run so a second click can't start a second set of orders.
  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave(picks.map((p) => ({ panel: p.panelId, customer, qty: p.qty, salesperson, order_date: orderDate })));
    } finally {
      setSaving(false);
    }
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
                  Panels<span className="req"> *</span>
                </span>
                <button type="button" className="picker-trigger" onClick={() => setPickerOpen(true)} aria-label="Panels" aria-haspopup="dialog">
                  {picks.length ? (
                    <span className="val">
                      {picks.length} panel{picks.length > 1 ? "s" : ""} selected
                    </span>
                  ) : (
                    <span className="ph">Select panels…</span>
                  )}
                  <Icon name="search" size={13} />
                </button>
              </label>
              <label className="form-field">
                <span className="lbl">Order Date</span>
                <DateInput value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
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

          {/* CR-192/193: the picked panels as the rep sees them in the showcase — thumb zooms over all images. */}
          {picks.length > 0 && (
            <div className="form-section">
              <div className="form-section-title">Panels</div>
              {picks.map(({ panelId, qty }) => {
                const p = panelById.get(panelId);
                if (!p) return null;
                const meta = [p.panelSize && `Panel: ${p.panelSize}`, p.vinylSize && `Vinyl: ${p.vinylSize}`, p.lines.map((l) => l.designName).join(", ")]
                  .filter(Boolean)
                  .join("  ·  ");
                return (
                  <div key={panelId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <ImageThumb images={p.images} size={56} alt={p.panelCode} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontWeight: 600 }}>{p.panelCode}</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={meta}>
                        {meta || "No details yet"}
                      </div>
                    </div>
                    <label className="form-field" style={{ width: 110, flex: "0 0 auto" }}>
                      <span className="lbl">
                        Qty<span className="req"> *</span>
                      </span>
                      <NumberInput min={1} value={qty || ""} onChange={(e) => setQty(panelId, Number(e.target.value) || 0)} placeholder="e.g. 1" />
                    </label>
                    <button type="button" className="btn x" title="Remove panel" aria-label={`Remove ${p.panelCode}`} onClick={() => togglePick(panelId)}>
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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
                {covered ? "Stock covers these panels — they can dispatch directly." : "Short on cut pieces — some panels will need a cutting job."}
              </div>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" onClick={() => void submit()} disabled={!canSave || saving}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>

        {pickerOpen && (
          <PanelPickerModal panels={panels} selectedIds={picks.map((p) => p.panelId)} onToggle={togglePick} onClose={() => setPickerOpen(false)} />
        )}
      </div>
    </div>
  );
}
