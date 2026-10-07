/* ============================================================
   Panel Order form — a customer orders showcase Panels × qty. A full
   FormPage (CR-290, .form-rows label-left), hosted by PanelOrderFormPage
   at /panel-orders/new. Multi-pick (CR-193): one Save = one PanelOrder
   row per picked panel, sharing customer / date / sales person, so each
   panel still dispatches on its own against cut-piece stock.
   "Request Panels" from a Quote / SO (CR-286) opens it with the customer
   locked and the panels carrying that sale's designs preselected; those
   rows are born New Request (the caller passes the source id).
   Sales Person defaults to the logged-in user; Order Date to today. The
   cut-piece requirement across ALL picked panels is shown vs on-hand.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { FormPage, useFormSave } from "@/ui/FormPage";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { cachedCustomers, listCustomers, type CustomerRow } from "@/features/masters/customersApi";
import { CustomerSearchModal } from "@/features/masters/CustomerSearchModal";
import { cachedSalesPersons, currentSalespersonName, listSalesPersons } from "@/features/masters/salespersonApi";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { cachedCutStock, listCutStock, stockKey, type PanelOrderInput } from "./panelOrdersApi";
import { PanelPickerModal } from "./PanelPickerModal";

type Pick = { panelId: string; qty: number };

export function PanelOrderForm({
  presetCustomerId,
  presetDesignIds,
  source,
  onSave,
  onClose,
}: {
  /** "Request Panels" (CR-286): the sale's customer — shown read-only. */
  presetCustomerId?: string;
  /** Designs on the source sale — panels carrying any of them start picked. */
  presetDesignIds?: string[];
  /** Source identity for the page sub-title, e.g. "From Sales Order SO/2026-27/012". */
  source?: { label: string };
  /** One input per picked panel — the caller creates one order row each. */
  onSave: (inputs: PanelOrderInput[]) => void | Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [salesperson, setSalesperson] = useState(() => currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState(presetCustomerId ?? "");
  const [custSearch, setCustSearch] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [preselected, setPreselected] = useState(false);
  const [orderDate, setOrderDate] = useState(todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void listCustomers().then((r) => r.ok && setCustomers(r.customers));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
    void listCutStock().then((r) => r.ok && setStock(r.stock));
    void listSalesPersons().then((r) => r.ok && setSalesperson((s) => s || currentSalespersonName(r.salesPersons)));
  }, []);

  // Preselect once the panels are known: every panel carrying a design from the source sale.
  useEffect(() => {
    if (preselected || !presetDesignIds?.length || panels.length === 0) return;
    const want = new Set(presetDesignIds);
    setPicks(panels.filter((p) => p.lines.some((l) => want.has(l.designId))).map((p) => ({ panelId: p.id, qty: 1 })));
    setPreselected(true);
  }, [panels, presetDesignIds, preselected]);

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers],
  );
  const customerName = customers.find((c) => c.id === customer)?.name ?? "";
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);

  const togglePick = (id: string) => {
    form.touch();
    setPicks((p) => (p.some((x) => x.panelId === id) ? p.filter((x) => x.panelId !== id) : [...p, { panelId: id, qty: 1 }]));
  };
  const setQty = (id: string, qty: number) => {
    form.touch();
    setPicks((p) => p.map((x) => (x.panelId === id ? { ...x, qty } : x)));
  };

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

  const submit = () => {
    if (!canSave) return;
    void form.run(() => onSave(picks.map((p) => ({ panel: p.panelId, customer, qty: p.qty, salesperson, order_date: orderDate }))));
  };

  return (
    <FormPage
      title={source ? "Request Panels" : "New Panel Order"}
      sub={source?.label ?? ""}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note="* Indicates a mandatory field"
    >
      <div className="form-section">
        <div className="form-section-title">Order</div>
        <div className="form-rows">
          <div className="form-field span2">
            <span className="lbl">
              Customer<span className="req"> *</span>
            </span>
            {presetCustomerId ? (
              <input value={customerName} readOnly tabIndex={-1} className="calc" title="From the source sale" />
            ) : (
              <div className="ctl-row">
                <Combobox
                  className="grow"
                  value={customer}
                  options={customerOptions}
                  onChange={(v) => {
                    form.touch();
                    setCustomer(v);
                  }}
                  placeholder="Search customer…"
                  ariaLabel="Customer"
                />
                {/* CR-276: the bigger search surface — a modal with a customer table. */}
                <button type="button" className="btn" aria-label="Search customers" title="Search customers" onClick={() => setCustSearch(true)}>
                  <Icon name="search" size={13} />
                </button>
              </div>
            )}
          </div>
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
            <DateInput
              value={orderDate}
              onChange={(e) => {
                form.touch();
                setOrderDate(e.target.value);
              }}
            />
          </label>
          <label className="form-field">
            <span className="lbl">Sales Person</span>
            <input value={salesperson} readOnly tabIndex={-1} className="calc" placeholder="From your sign-in" title="Auto-filled from your sign-in" />
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

      {custSearch && (
        <CustomerSearchModal
          onPick={(c) => {
            form.touch();
            setCustomer(c.id);
          }}
          onClose={() => setCustSearch(false)}
        />
      )}
      {pickerOpen && (
        <PanelPickerModal panels={panels} selectedIds={picks.map((p) => p.panelId)} onToggle={togglePick} onClose={() => setPickerOpen(false)} />
      )}
    </FormPage>
  );
}
