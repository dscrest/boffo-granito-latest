/* ============================================================
   Panel Order form (CR-302) — the Sales Order shape: a customer order
   whose line items are showcase Panels × qty. A full FormPage (CR-290,
   .form-rows label-left), hosted by PanelOrderFormPage at
   /panel-orders/new · /:id/edit · /:id/clone. One Save = ONE
   /panel-order-save call (header + lines); the server mints PNL/FY/NNN.
   "Request Panels" from a Quote / SO (CR-286) opens it with the customer
   locked and the panels carrying that sale's designs preselected; the
   header carries the source id (every order is born New, CR-294).
   Sales Person defaults to the logged-in user; Order Date to today. The
   cut-piece requirement across ALL lines is shown vs on-hand. Panels
   enter ONLY via the multi-select tile picker (CR-304); no blank rows.
   CR-309: each line picks the MDF it is mounted on (default = the MDF whose
   size matches the panel size); Weight = Σ cut-piece weight × pieces + MDF,
   × qty — read-only ƒx, "—" until every cut piece has a weight.
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
import { cachedCutStock, cachedCutWeights, listCutStock, requirementsFor, type PanelOrderInput } from "./panelOrdersApi";
import { panelWeight } from "./panelOrderNeeds";
import { cachedMdfs, listMdfs, type MdfRow } from "./mdfApi";
import { PanelPickerModal } from "./PanelPickerModal";

type Line = { panelId: string; qty: number; mdfId: string };
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;

export function PanelOrderForm({
  initial,
  orderNumber,
  isEdit,
  presetCustomerId,
  presetDesignIds,
  source,
  onSave,
  onClose,
}: {
  /** Edit / clone prefill (panelOrderToInput). */
  initial?: PanelOrderInput;
  /** Shown read-only on edit; blank on create ("Auto-assigned on save"). */
  orderNumber?: string;
  isEdit?: boolean;
  /** "Request Panels" (CR-286): the sale's customer — shown read-only. */
  presetCustomerId?: string;
  /** Designs on the source sale — panels carrying any of them start as lines. */
  presetDesignIds?: string[];
  /** Source identity for the page sub-title, e.g. "From Sales Order SO/2026-27/012". */
  source?: { label: string };
  onSave: (input: PanelOrderInput) => void | Promise<void>;
  onClose: () => void;
}) {
  const form = useFormSave(onClose);
  const [customers, setCustomers] = useState<CustomerRow[]>(() => cachedCustomers() ?? []);
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [weights, setWeights] = useState<Map<string, number | null>>(() => cachedCutWeights() ?? new Map());
  const [mdfs, setMdfs] = useState<MdfRow[]>(() => cachedMdfs());
  const [salesperson, setSalesperson] = useState(() => initial?.salesperson || currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState(initial?.customer ?? presetCustomerId ?? "");
  const [custSearch, setCustSearch] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => initial?.lines.map((l) => ({ panelId: l.panel, qty: l.qty, mdfId: l.mdf || "" })) ?? []);
  const [preselected, setPreselected] = useState(!!initial);
  const [orderDate, setOrderDate] = useState(initial?.order_date || todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    void listCustomers().then((r) => r.ok && setCustomers(r.customers));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
    void listCutStock().then((r) => {
      if (r.ok) {
        setStock(r.stock);
        setWeights(r.weights);
      }
    });
    void listMdfs().then((r) => r.ok && setMdfs(r.rows));
    void listSalesPersons().then((r) => r.ok && setSalesperson((s) => s || currentSalespersonName(r.salesPersons)));
  }, []);

  // Preselect once the panels are known: every panel carrying a design from the source sale.
  useEffect(() => {
    if (preselected || !presetDesignIds?.length || panels.length === 0) return;
    const want = new Set(presetDesignIds);
    setLines(panels.filter((p) => p.lines.some((l) => want.has(l.designId))).map((p) => ({ panelId: p.id, qty: 1, mdfId: defaultMdf(p.id) })));
    setPreselected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, presetDesignIds, preselected]);

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers],
  );
  const customerName = customers.find((c) => c.id === customer)?.name ?? "";
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  const mdfById = useMemo(() => new Map(mdfs.map((m) => [m.id, m])), [mdfs]);
  const mdfOptions = useMemo(() => mdfs.map((m) => ({ value: m.id, label: m.label, hint: m.weightKg != null ? `${m.weightKg} kg` : undefined })), [mdfs]);
  // CR-309: the MDF whose size equals the panel size is the natural default.
  const defaultMdf = (panelId: string) => {
    const size = panelById.get(panelId)?.panelSize.trim().toLowerCase();
    return (size && mdfs.find((m) => m.size.trim().toLowerCase() === size)?.id) || "";
  };
  const lineWeight = (l: Line): number | null => {
    const p = panelById.get(l.panelId);
    if (!p) return null;
    const w = panelWeight(p, weights, mdfById.get(l.mdfId)?.weightKg ?? null);
    return w == null ? null : w * (l.qty || 0);
  };
  const panelOptions = useMemo(
    () => panels.map((p) => ({ value: p.id, label: p.panelCode, hint: p.lines.map((l) => l.designName).join(", ") || undefined })),
    [panels],
  );

  const setLine = (i: number, patch: Partial<Line>) => {
    form.touch();
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const removeLine = (i: number) => {
    form.touch();
    setLines((ls) => ls.filter((_, j) => j !== i));
  };
  // Picker tiles toggle a line per panel (CR-193 multi-pick, now as lines).
  const togglePick = (id: string) => {
    form.touch();
    setLines((ls) => (ls.some((l) => l.panelId === id) ? ls.filter((l) => l.panelId !== id) : [...ls, { panelId: id, qty: 1, mdfId: defaultMdf(id) }]));
  };

  const dupIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of lines) {
      if (!l.panelId) continue;
      if (seen.has(l.panelId)) dup.add(l.panelId);
      seen.add(l.panelId);
    }
    return dup;
  }, [lines]);
  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const filled = lines.filter((l) => l.panelId);
  const lineWeights = filled.map(lineWeight);
  const totalWeight = lineWeights.every((w) => w != null) ? lineWeights.reduce((s, w) => s + (w ?? 0), 0) : null;

  // Requirement preview across every line — all lines draw from the same stock.
  const preview = useMemo(() => requirementsFor(filled, panelById, stock), [filled, panelById, stock]);
  const covered = preview.length > 0 && preview.every((p) => !p.short);

  const canSave = !!customer && lines.length > 0 && lines.every((l) => l.panelId && l.qty > 0) && dupIds.size === 0;

  const submit = () => {
    if (!canSave) return;
    void form.run(() => onSave({ customer, salesperson, order_date: orderDate, lines: lines.map((l) => ({ panel: l.panelId, qty: l.qty, mdf: l.mdfId || undefined })) }));
  };

  return (
    <FormPage
      title={isEdit ? "Edit Panel Order" : source ? "Request Panels" : "New Panel Order"}
      sub={isEdit ? orderNumber || "" : (source?.label ?? "")}
      busy={form.busy}
      saveDisabled={!canSave}
      onCancel={() => void form.cancel()}
      onSave={submit}
      note="* Indicates a mandatory field"
    >
      <div className="form-section">
        <div className="form-section-title">Order Details</div>
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
            <span className="lbl">Order No</span>
            <input value={orderNumber || ""} readOnly tabIndex={-1} className="calc" placeholder="Auto-assigned on save" title="PNL number assigned by the system" />
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

      {/* SO-style line items: one row per showcase panel. */}
      <div className="form-section">
        <div className="form-section-title">Panels</div>
        <div className="ord-lines">
          <div className="ord-line ord-line-head pnl-line">
            <span>
              Panel<span className="req"> *</span>
            </span>
            <span>Details</span>
            <span>MDF</span>
            <span>Weight</span>
            <span>
              Qty<span className="req"> *</span>
            </span>
            <span />
          </div>
          {lines.map((l, i) => {
            const p = panelById.get(l.panelId);
            const dup = !!l.panelId && dupIds.has(l.panelId);
            const meta = p
              ? [p.panelSize && `Panel: ${p.panelSize}`, p.vinylSize && `Vinyl: ${p.vinylSize}`, p.lines.map((x) => x.designName).join(", ")].filter(Boolean).join("  ·  ")
              : "";
            return (
              <div className="ord-line pnl-line" key={i}>
                <div className="form-field" style={{ gap: 2 }}>
                  <Combobox value={l.panelId} onChange={(v) => setLine(i, { panelId: v })} placeholder="Search panel…" options={panelOptions} invalid={dup} ariaLabel="Panel" />
                  {dup && <span className="field-err">Already on this order — change its quantity instead</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <ImageThumb images={p?.images ?? []} size={28} alt={p?.panelCode ?? ""} />
                  <span className="dim" style={{ fontSize: "var(--t-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={meta}>
                    {meta || "—"}
                  </span>
                </div>
                {/* CR-309: MDF per panel line; the weight is ƒx (cut pieces × pieces + MDF) × qty. */}
                <Combobox value={l.mdfId} onChange={(v) => setLine(i, { mdfId: v })} options={mdfOptions} placeholder="MDF…" ariaLabel="MDF" />
                {(() => {
                  const w = lineWeight(l);
                  return (
                    <input
                      value={w == null ? "" : kg(w)}
                      readOnly
                      tabIndex={-1}
                      className="calc"
                      placeholder={p ? "—" : ""}
                      title={w == null ? "ƒx needs a weight on every cut piece — set it on Panel Items" : "ƒx Σ cut-piece weight × pieces + MDF, × qty"}
                      aria-label="Weight"
                    />
                  );
                })()}
                <NumberInput min={1} value={l.qty || ""} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} placeholder="1" aria-label="Quantity" />
                <button type="button" className="btn ord-rm" onClick={() => removeLine(i)} title="Remove panel" aria-label="Remove panel" tabIndex={-1}>
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {/* CR-192: the e-commerce tile grid — pick several panels at once by photo.
              CR-304: the only way in — the blank-row "Add panel" is gone (no image to pick by). */}
          <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
            <Icon name="search" size={12} /> Pick from showcase
          </button>
        </div>
        <div className="qt-totals">
          <div className="row total">
            <span>Total</span>
            <span className="mono">
              {filled.length} panel{filled.length === 1 ? "" : "s"} · {fmt(totalQty)} pcs · {totalWeight == null ? <span className="dim" title="Set a weight on every cut piece (Panel Items) to total it">— kg</span> : kg(totalWeight)}
            </span>
          </div>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="form-section">
          <div className="form-section-title">Cut Piece Stock Check</div>
          {preview.map((p) => (
            <div key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: "var(--t-md)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.short ? "var(--c-red)" : "var(--c-green)", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.designName} · {p.cutSizeName}
                <span className="dim mono"> — {p.panels.map((x) => `${x.panelCode} ×${x.qty}`).join(" · ")}</span>
              </span>
              <span className="mono dim">
                {fmt(p.have)} of {fmt(p.need)} pcs
              </span>
            </div>
          ))}
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4 }}>
            {covered ? "Stock covers this order — it can dispatch directly." : "Short on cut pieces — this order will need a cutting job."}
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
        <PanelPickerModal panels={panels} selectedIds={filled.map((l) => l.panelId)} onToggle={togglePick} onClose={() => setPickerOpen(false)} stock={stock} />
      )}
    </FormPage>
  );
}
