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
   CR-309/342: each line picks ONLY the MDF thickness, from the thicknesses
   configured on that panel (Panel master = MDF size + thickness options,
   each with its board weight); mandatory once the panel has any, auto when
   it has exactly one. Weight = Σ cut-piece weight × pieces + that board,
   × qty — read-only ƒx, "—" until every cut piece has a weight.
   CR-398: panel rows and cut-piece rows share ONE column set (Panel / Item ·
   ⓘ · Cut Size · MDF · Weight · Qty · ✕); the photo + details sit behind the
   ⓘ (hover = details, click = photo); the stock check is one verdict line.
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
import { useWarehouses } from "@/features/masters/useWarehouses";
import { Note } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import { cachedCutSizes, cachedPanels, listPanels, type CutSizeOption, type PanelRow } from "./panelsApi";
import { cachedMdfs, listMdfs, type MdfRow } from "./mdfApi";
import { cachedCutStock, cachedCutStockRows, cachedCutWeights, listCutStock, requirementsFor, stockKey, type NeedLine, type PanelOrderInput } from "./panelOrdersApi";
import { panelWeightSplit } from "./panelOrderNeeds";
import { panelPriceParts, piecePrice, round2, type PriceParts } from "./panelPrice";
import { moneyFor } from "@/features/quotes/quoteTemplate";
import { PanelPickerModal } from "./PanelPickerModal";
import { InfoDot } from "./pcBits";

/** CR-346: a line is a showcase PANEL (panelId [+ mdfId]) or a loose CUT PIECE (designId + cutSizeId).
    CR-504: vinyl / mdf / pieces = the ₹ parts of ONE panel (a cut line uses pieces = ₹/pc) as typed text;
    null = follow the masters (a new line, a clone, a pre-pricing order) — frozen on save. */
type Line = { kind: "panel" | "cut"; panelId: string; qty: number; mdfId: string; designId: string; cutSizeId: string; vinyl: string | null; mdf: string | null; pieces: string | null };
const kg = (n: number) => `${Math.round(n * 100) / 100} kg`;
const money = moneyFor("INR");
const unpriced = { vinyl: null, mdf: null, pieces: null };
const panelLine = (panelId: string, mdfId: string): Line => ({ kind: "panel", panelId, qty: 1, mdfId, designId: "", cutSizeId: "", ...unpriced });
const cutLine = (): Line => ({ kind: "cut", panelId: "", qty: 1, mdfId: "", designId: "", cutSizeId: "", ...unpriced });
const typed = (v: number | null | undefined) => (v == null ? null : String(v));
const ZERO: PriceParts = { vinyl: 0, mdf: 0, pieces: 0 };

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
  const [mdfs, setMdfs] = useState<MdfRow[]>(() => cachedMdfs()); // CR-344: size-keyed MDF master
  const [stock, setStock] = useState<Map<string, number>>(() => cachedCutStock() ?? new Map());
  const [weights, setWeights] = useState<Map<string, number | null>>(() => cachedCutWeights() ?? new Map());
  const [salesperson, setSalesperson] = useState(() => initial?.salesperson || currentSalespersonName(cachedSalesPersons() ?? []));

  const [customer, setCustomer] = useState(initial?.customer ?? presetCustomerId ?? "");
  const [custSearch, setCustSearch] = useState(false);
  const [lines, setLines] = useState<Line[]>(
    () =>
      initial?.lines.map((l) => ({
        ...(l.panel ? { ...panelLine(l.panel, l.mdf || ""), qty: l.qty } : { ...cutLine(), qty: l.qty, designId: l.design || "", cutSizeId: l.cut_piece_size || "" }),
        vinyl: typed(l.vinyl_price),
        mdf: typed(l.mdf_price),
        pieces: typed(l.pieces_price),
      })) ?? [],
  );
  const [designs, setDesigns] = useState<DesignRow[]>(() => cachedDesigns() ?? []);
  const [cutSizes, setCutSizes] = useState<CutSizeOption[]>(() => cachedCutSizes());
  const [preselected, setPreselected] = useState(!!initial);
  const [orderDate, setOrderDate] = useState(initial?.order_date || todayISO());
  const [pickerOpen, setPickerOpen] = useState(false);
  // CR-413: where the panels will sit — optional, no default (a new order has nothing on the floor yet).
  const { options: whOptions, enabled: whEnabled } = useWarehouses();
  const [warehouse, setWarehouse] = useState(initial?.warehouse || "");

  useEffect(() => {
    void listCustomers().then((r) => r.ok && setCustomers(r.customers));
    void listPanels().then((r) => {
      if (!r.ok) return;
      setPanels(r.panels);
      setCutSizes(r.cutSizes);
    });
    void listDesigns().then((r) => r.ok && setDesigns(r.designs));
    void listMdfs().then((r) => r.ok && setMdfs(r.rows));
    void listCutStock().then((r) => {
      if (r.ok) {
        setStock(r.stock);
        setWeights(r.weights);
      }
    });
    void listSalesPersons().then((r) => r.ok && setSalesperson((s) => s || currentSalespersonName(r.salesPersons)));
  }, []);

  // Preselect once the panels are known: every panel carrying a design from the source sale.
  useEffect(() => {
    if (preselected || !presetDesignIds?.length || panels.length === 0) return;
    const want = new Set(presetDesignIds);
    setLines(panels.filter((p) => p.lines.some((l) => want.has(l.designId))).map((p) => panelLine(p.id, defaultMdf(p.id))));
    setPreselected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, presetDesignIds, preselected]);

  const customerOptions = useMemo(
    () => customers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.code || undefined })),
    [customers],
  );
  const customerName = customers.find((c) => c.id === customer)?.name ?? "";
  const panelById = useMemo(() => new Map(panels.map((p) => [p.id, p])), [panels]);
  // CR-344: the pick list = MDF master rows whose size matches the panel's MDF size; one option picks itself.
  const mdfById = useMemo(() => new Map(mdfs.map((m) => [m.id, m])), [mdfs]);
  const norm = (s: string) => s.trim().toLowerCase();
  const sameSize = (p: PanelRow | undefined) => (p?.mdfSize.trim() ? mdfs.filter((m) => norm(m.size) === norm(p.mdfSize)) : []);
  const mdfOptions = (panelId: string) =>
    sameSize(panelById.get(panelId)).map((m) => ({ value: m.id, label: m.thickness || m.size, hint: m.weightKg != null ? `${m.weightKg} kg` : undefined }));
  const defaultMdf = (panelId: string) => {
    const v = sameSize(panelById.get(panelId));
    return v.length === 1 ? v[0].id : "";
  };
  // A line is missing its thickness when the panel's size has options and none of them is picked (server refuses too).
  const mdfMissing = (l: Line) => {
    const v = sameSize(panelById.get(l.panelId));
    return !!l.panelId && v.length > 0 && !v.some((m) => m.id === l.mdfId);
  };
  // CR-349: weight split per line — pieces vs board (a cut-piece line has no board); null until weighed.
  const lineSplit = (l: Line): { pieces: number | null; mdf: number | null } => {
    if (l.kind === "cut") {
      const c = effCut(l);
      const w = l.designId && c ? weights.get(stockKey(l.designId, c)) : null;
      return { pieces: w == null ? null : w * (l.qty || 0), mdf: null };
    }
    const p = panelById.get(l.panelId);
    if (!p) return { pieces: null, mdf: null };
    const s = panelWeightSplit(p, weights, mdfById.get(l.mdfId)?.weightKg ?? null);
    return { pieces: s.pieces == null ? null : s.pieces * (l.qty || 0), mdf: s.mdf == null ? null : s.mdf * (l.qty || 0) };
  };
  const lineWeight = (l: Line): number | null => {
    const s = lineSplit(l);
    if (s.pieces == null) return null;
    if (l.kind === "panel" && l.mdfId && s.mdf == null) return null;
    return s.pieces + (s.mdf ?? 0);
  };
  // CR-346: cut-piece rows pick a Panel Item (a design with a cut-piece row) and one of the cut sizes.
  const designById = useMemo(() => new Map(designs.map((d) => [d.id, d])), [designs]);
  // CR-357: a blank cut size = the design's full size (CR-289 rule; the server mints the CutPieceSize row named
  // after the Size code). Resolve it here only for weight / duplicate / requirement previews — "" when not minted yet.
  const effCut = (l: Line) => l.cutSizeId || (cutSizes.find((c) => c.label === designById.get(l.designId)?.sizeLabel)?.id ?? "");
  const itemIds = useMemo(() => new Set((cachedCutStockRows() ?? []).map((r) => r.designId)), [stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const designOptions = useMemo(
    () => designs.filter((d) => itemIds.has(d.id) || lines.some((l) => l.designId === d.id)).map((d) => ({ value: d.id, label: d.uniqueName || d.designName, hint: d.sizeLabel || undefined })),
    [designs, itemIds, lines],
  );
  const cutOptions = useMemo(() => cutSizes.map((c) => ({ value: c.id, label: c.label })), [cutSizes]);
  // CR-489 follow-up (user 2026-10-28): sizes are selected only — "Create …" removed; use Cut Piece Sizes.
  const panelOptions = useMemo(
    () => panels.map((p) => ({ value: p.id, label: p.panelCode, hint: p.lines.map((l) => l.designName).join(", ") || undefined })),
    [panels],
  );

  // CR-504: picking another panel / item / cut size re-prices the line from the masters; another MDF re-prices the board.
  const setLine = (i: number, patch: Partial<Line>) => {
    form.touch();
    const reprice: Partial<Line> = {
      ...("panelId" in patch || "designId" in patch || "cutSizeId" in patch ? unpriced : {}),
      ...("mdfId" in patch ? { mdf: null } : {}),
    };
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...reprice, ...patch } : l)));
  };
  // The masters' price of one panel / piece on this line, and what the line will save (typed override wins).
  const defaultsOf = (l: Line): PriceParts => {
    if (l.kind === "cut") return { ...ZERO, pieces: piecePrice(designById.get(l.designId), cutSizes.find((c) => c.id === l.cutSizeId)?.label || "") };
    const p = panelById.get(l.panelId);
    return p ? panelPriceParts(p, mdfById.get(l.mdfId), (id) => designById.get(id)) : ZERO;
  };
  const partsOf = (l: Line): PriceParts => {
    const d = defaultsOf(l);
    const v = (s: string | null, def: number) => (s == null ? def : round2(Number(s) || 0));
    return { vinyl: l.kind === "cut" ? 0 : v(l.vinyl, d.vinyl), mdf: l.kind === "cut" ? 0 : v(l.mdf, d.mdf), pieces: v(l.pieces, d.pieces) };
  };
  const rateOf = (l: Line) => {
    const x = partsOf(l);
    return round2(x.vinyl + x.mdf + x.pieces);
  };
  const partInput = (i: number, l: Line, k: "vinyl" | "mdf" | "pieces", label: string, hint: string) => (
    <label title={hint}>
      {label}
      <NumberInput value={l[k] ?? String(defaultsOf(l)[k])} maxDecimals={2} onChange={(e) => setLine(i, { [k]: e.target.value === "" ? null : e.target.value })} placeholder="0.00" aria-label={`${label} price`} />
    </label>
  );
  const removeLine = (i: number) => {
    form.touch();
    setLines((ls) => ls.filter((_, j) => j !== i));
  };
  // Picker tiles toggle a line per panel (CR-193 multi-pick, now as lines).
  const togglePick = (id: string) => {
    form.touch();
    setLines((ls) => (ls.some((l) => l.panelId === id) ? ls.filter((l) => l.panelId !== id) : [...ls, panelLine(id, defaultMdf(id))]));
  };

  const lineKey = (l: Line) => (l.kind === "panel" ? `p|${l.panelId}` : `c|${l.designId}|${effCut(l)}`);
  const dupIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of lines) {
      if (l.kind === "panel" ? !l.panelId : !l.designId) continue;
      const k = lineKey(l);
      if (seen.has(k)) dup.add(k);
      seen.add(k);
    }
    return dup;
  }, [lines]);
  const totalQty = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const filled = lines.filter((l) => (l.kind === "panel" ? l.panelId : l.designId));
  const panelsOn = filled.filter((l) => l.kind === "panel");
  const cutsOn = filled.filter((l) => l.kind === "cut");
  const lineWeights = filled.map(lineWeight);
  const totalWeight = lineWeights.every((w) => w != null) ? lineWeights.reduce((s, w) => s + (w ?? 0), 0) : null;
  const totalAmount = round2(filled.reduce((s, l) => s + rateOf(l) * (l.qty || 0), 0));

  // Requirement preview across every line — panels and loose cut pieces draw from the same stock.
  const needLines = useMemo(
    (): NeedLine[] =>
      filled.map((l) =>
        l.kind === "panel"
          ? { panelId: l.panelId, qty: l.qty }
          : { panelId: "", qty: l.qty, designId: l.designId, cutSizeId: effCut(l), designName: designById.get(l.designId)?.uniqueName || designById.get(l.designId)?.designName || "", cutSizeName: cutSizes.find((c) => c.id === effCut(l))?.label || designById.get(l.designId)?.sizeLabel || "" },
      ),
    [filled, designById, cutSizes],
  );
  const preview = useMemo(() => requirementsFor(needLines, panelById, stock), [needLines, panelById, stock]);
  const covered = preview.length > 0 && preview.every((p) => !p.short);

  const lineOk = (l: Line) => l.qty > 0 && (l.kind === "panel" ? !!l.panelId && !mdfMissing(l) : !!l.designId);
  const canSave = !!customer && lines.length > 0 && lines.every(lineOk) && dupIds.size === 0 && (!whEnabled || !!warehouse); // CR-453: Location mandatory

  const submit = () => {
    if (!canSave) return;
    void form.run(() =>
      onSave({
        customer,
        salesperson,
        order_date: orderDate,
        warehouse,
        lines: lines.map((l) => {
          const x = partsOf(l); // CR-504: frozen on the line
          return l.kind === "panel"
            ? { panel: l.panelId, qty: l.qty, mdf: l.mdfId || undefined, vinyl_price: x.vinyl, mdf_price: x.mdf, pieces_price: x.pieces }
            : { design: l.designId, cut_piece_size: l.cutSizeId || undefined, qty: l.qty, pieces_price: x.pieces };
        }),
      }),
    );
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
          {whEnabled && (
            <label className="form-field">
              <span className="lbl">Location<span className="req"> *</span></span>
              <Combobox
                value={warehouse}
                options={whOptions}
                maxVisible={120}
                placeholder="Where the panels will sit…"
                ariaLabel="Location"
                onChange={(v) => {
                  form.touch();
                  setWarehouse(v);
                }}
              />
            </label>
          )}
        </div>
      </div>

      {/* SO-style line items: one row per showcase panel. */}
      <div className="form-section">
        <div className="form-section-title">Panels &amp; Cut Pieces</div>
        <div className="ord-lines">
          <div className="ord-line ord-line-head pnl-line">
            <span>
              Panel / Item<span className="req"> *</span>
            </span>
            <span />
            <span>Cut Size</span>
            <span>MDF Thickness</span>
            <span>Weight</span>
            <span>
              Qty<span className="req"> *</span>
            </span>
            <span>Rate</span>
            <span>Amount</span>
            <span />
          </div>
          {lines.map((l, i) => {
            if (l.kind === "cut") {
              // CR-346/398: a loose cut-piece line — Item · ⓘ · Cut Piece Size · (no MDF) · Weight · Qty · ✕ on the same grid.
              const d = designById.get(l.designId);
              const dupC = !!l.designId && dupIds.has(lineKey(l));
              const w = lineWeight(l);
              return (
                <div className="ord-line pnl-line" key={i}>
                  <div className="form-field" style={{ gap: 2 }}>
                    <Combobox value={l.designId} onChange={(v) => setLine(i, { designId: v })} placeholder="Search item…" options={designOptions} invalid={dupC} ariaLabel="Item" emptyText="No Panel Items yet — add items on Panel Items first" />
                    {dupC && <span className="field-err">Already on this order — change its quantity instead</span>}
                  </div>
                  <InfoDot title={d ? [d.uniqueName || d.designName, d.sizeLabel].filter(Boolean).join("  ·  ") : ""} images={d?.images ?? []} alt={d?.uniqueName || "item"} />
                  <Combobox
                    value={l.cutSizeId}
                    options={cutOptions}
                    onChange={(v) => setLine(i, { cutSizeId: v })}
                    placeholder={d?.sizeLabel ? `Full size — ${d.sizeLabel}` : "Full size"}
                    ariaLabel="Cut piece size"
                  />
                  <span className="ord-dash" title="A loose cut piece has no board">—</span>
                  <input value={w == null ? "" : kg(w)} readOnly tabIndex={-1} className="calc" placeholder={l.designId ? "—" : ""} title={w == null ? "Needs a weight on this cut piece — set it on Panel Items" : "Weight = cut-piece weight × qty"} aria-label="Weight" />
                  <NumberInput min={1} value={l.qty || ""} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} placeholder="1" aria-label="Quantity" />
                  {/* CR-504: ₹/pc = cut-size sqft × the item's Rate/sqft — editable, frozen on save. */}
                  <NumberInput value={l.pieces ?? (l.designId ? String(defaultsOf(l).pieces) : "")} maxDecimals={2} onChange={(e) => setLine(i, { pieces: e.target.value === "" ? null : e.target.value })} placeholder="0.00" title="Cut size sqft × the item's Rate/sqft — type to override" aria-label="Rate" />
                  <input value={l.designId ? money(rateOf(l) * (l.qty || 0)) : ""} readOnly tabIndex={-1} className="calc" title="Rate × qty" aria-label="Amount" />
                  <button type="button" className="btn ord-rm" onClick={() => removeLine(i)} title="Remove cut piece" aria-label="Remove cut piece" tabIndex={-1}>
                    ✕
                  </button>
                </div>
              );
            }
            const p = panelById.get(l.panelId);
            const dup = !!l.panelId && dupIds.has(lineKey(l));
            const meta = p
              ? [p.panelSize && `Panel: ${p.panelSize}`, p.vinylSize && `Vinyl: ${p.vinylSize}`, p.lines.map((x) => x.designName).join(", ")].filter(Boolean).join("  ·  ")
              : "";
            return (
              <div className="ord-line pnl-line" key={i}>
                <div className="form-field" style={{ gap: 2 }}>
                  <Combobox value={l.panelId} onChange={(v) => setLine(i, { panelId: v, mdfId: v === l.panelId ? l.mdfId : defaultMdf(v) })} placeholder="Search panel…" options={panelOptions} invalid={dup} ariaLabel="Panel" />
                  {dup && <span className="field-err">Already on this order — change its quantity instead</span>}
                </div>
                <InfoDot title={meta} images={p?.images ?? []} alt={p?.panelCode || "panel"} />
                <span className="ord-dash" title="A showcase panel carries its own cut pieces">—</span>
                {/* CR-309/344: thickness from the MDF master rows of the panel's size; the weight is ƒx (cut pieces × pieces + that board) × qty. */}
                {p && sameSize(p).length === 0 ? (
                  <span className="dim" style={{ fontSize: "var(--t-sm)", alignSelf: "center" }} title={p.mdfSize ? `Add MDF rows of size ${p.mdfSize} in Settings ▸ MDF` : `Set an MDF size on ${p.panelCode} ▸ Edit`}>
                    {p.mdfSize ? `No MDF for size ${p.mdfSize}` : "No MDF size on panel"}
                  </span>
                ) : (
                  <div className="form-field" style={{ gap: 2 }}>
                    <Combobox value={l.mdfId} onChange={(v) => setLine(i, { mdfId: v })} options={mdfOptions(l.panelId)} placeholder={p ? "Thickness…" : ""} invalid={mdfMissing(l)} ariaLabel="MDF thickness" />
                    {mdfMissing(l) && <span className="field-err">Pick the MDF thickness</span>}
                  </div>
                )}
                {(() => {
                  const w = lineWeight(l);
                  const sp = lineSplit(l);
                  return (
                    <input
                      value={w == null ? "" : kg(w)}
                      readOnly
                      tabIndex={-1}
                      className="calc"
                      placeholder={p ? "—" : ""}
                      title={w == null ? "Needs a weight on every cut piece — set it on Panel Items" : `Weight = pieces ${kg(sp.pieces ?? 0)} + MDF ${sp.mdf == null ? "—" : kg(sp.mdf)} (× qty)`}
                      aria-label="Weight"
                    />
                  );
                })()}
                <NumberInput min={1} value={l.qty || ""} onChange={(e) => setLine(i, { qty: Number(e.target.value) || 0 })} placeholder="1" aria-label="Quantity" />
                <input value={p ? money(rateOf(l)) : ""} readOnly tabIndex={-1} className="calc" title="Price of one panel = Vinyl + MDF + Cut pieces" aria-label="Rate" />
                <input value={p ? money(rateOf(l) * (l.qty || 0)) : ""} readOnly tabIndex={-1} className="calc" title="Rate × qty" aria-label="Amount" />
                <button type="button" className="btn ord-rm" onClick={() => removeLine(i)} title="Remove panel" aria-label="Remove panel" tabIndex={-1}>
                  ✕
                </button>
                {/* CR-504: one panel's three parts, from the masters until typed over. */}
                {p && (
                  <div className="pnl-price">
                    {partInput(i, l, "vinyl", "Vinyl ₹", "Vinyl Size sqft × the panel's Vinyl Rate/sqft")}
                    {partInput(i, l, "mdf", "MDF ₹", "Board weight × the MDF Rate/kg")}
                    {partInput(i, l, "pieces", "Cut pieces ₹", "Σ cut-piece sqft × the item's Rate/sqft × pcs")}
                  </div>
                )}
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
          {/* CR-346: loose cut pieces on the same order ("10 panels + 20 cut pieces"). */}
          <button
            type="button"
            className="btn"
            onClick={() => {
              form.touch();
              setLines((ls) => [...ls, cutLine()]);
            }}
          >
            <Icon name="plus" size={12} /> Add cut piece
          </button>
        </div>
        {/* CR-398: the panel total string is longer than a quote's — grow past the 280px block instead of wrapping. */}
        <div className="qt-totals" style={{ width: "fit-content", minWidth: 280 }}>
          <div className="row total" style={{ gap: 16, whiteSpace: "nowrap" }}>
            <span>Total</span>
            <span className="mono">
              {panelsOn.length} panel{panelsOn.length === 1 ? "" : "s"}{cutsOn.length > 0 && ` · ${cutsOn.length} cut piece line${cutsOn.length === 1 ? "" : "s"}`} · {fmt(totalQty)} pcs · {totalWeight == null ? <span className="dim" title="Set a weight on every cut piece (Panel Items) to total it">— kg</span> : kg(totalWeight)} · {money(totalAmount)}
            </span>
          </div>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="form-section">
          <div className="form-section-title">Cut Piece Stock Check</div>
          {/* CR-398: the verdict only while creating — the per-piece breakdown lives on the saved order. */}
          <Note tone={covered ? "ok" : "warn"} style={{ margin: 0 }}>
            {covered ? "Stock covers this order — it can dispatch directly." : "Short on cut pieces — this order will need a cutting job."}
          </Note>
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
        <PanelPickerModal panels={panels} selectedIds={panelsOn.map((l) => l.panelId)} onToggle={togglePick} onClose={() => setPickerOpen(false)} stock={stock} />
      )}
    </FormPage>
  );
}
