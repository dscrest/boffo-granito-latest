/* ============================================================
   Panel Order form page (CR-290) — PanelOrderForm as a full page, the
   PalPlanFormPage shape:
     /panel-orders/new                   New Panel Order (born Received)
     /panel-orders/new?fromOrder=<soId>  "Request Panels" from a Sales Order
     /panel-orders/new?fromQuote=<id>    "Request Panels" from a Quote
   The request forms (CR-286) lock the customer, preselect the panels that
   carry the sale's designs and stamp the source id, so every row saved is
   born New Request and shows on the source record's Panel Orders tab.
   One Save = one PanelOrder row per picked panel (CR-193), written one
   after another — the Dev org shares function concurrency.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { cachedCustomers, listCustomers } from "@/features/masters/customersApi";
import { cachedDesigns, listDesigns } from "@/features/masters/designsApi";
import type { Order, Quote } from "@/data";
import type { CustomerRow } from "@/features/masters/customersApi";
import type { DesignRow } from "@/features/masters/designsApi";
import { PanelOrderForm } from "./PanelOrderForm";
import { cachedPanels, listPanels, type PanelRow } from "./panelsApi";
import { createPanelOrder, type PanelOrderInput } from "./panelOrdersApi";

/** Resolved source sale: who it is for and which designs it carries. */
type Source = { label: string; customerId: string; designIds: string[]; sales_order?: string; quote?: string };

export function PanelOrderFormPage() {
  const [params] = useSearchParams();
  const fromOrder = params.get("fromOrder") || "";
  const fromQuote = params.get("fromQuote") || "";
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[] | null>(() => (fromOrder ? cachedOrders() : []));
  const [quotes, setQuotes] = useState<Quote[] | null>(() => (fromQuote ? cachedQuotes() : []));
  const [customers, setCustomers] = useState<CustomerRow[] | null>(() => (fromQuote ? cachedCustomers() : []));
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => (fromOrder || fromQuote ? cachedDesigns() : []));
  const [panels, setPanels] = useState<PanelRow[]>(() => cachedPanels() ?? []);
  useEffect(() => {
    if (fromOrder) void listOrders().then((r) => setOrders(r.ok ? r.orders : []));
    if (fromQuote) void listQuotes().then((r) => setQuotes(r.ok ? r.quotes : []));
    if (fromQuote) void listCustomers().then((r) => setCustomers(r.ok ? r.customers : []));
    if (fromOrder || fromQuote) void listDesigns().then((r) => setDesigns(r.ok ? r.designs : []));
    void listPanels().then((r) => r.ok && setPanels(r.panels));
  }, [fromOrder, fromQuote]);

  // Design names on the sale → Design ROWIDs (lines store names; see data.ts).
  const source = useMemo((): Source | null | undefined => {
    if (!fromOrder && !fromQuote) return null;
    if (!orders || !quotes || !customers || !designs) return undefined; // loading
    const idByName = new Map<string, string>();
    for (const d of designs) {
      idByName.set(d.uniqueName, d.id);
      idByName.set(d.designName, d.id);
    }
    const ids = (names: string[]) => [...new Set(names.map((n) => idByName.get(n)).filter((x): x is string => !!x))];
    if (fromOrder) {
      const rows = orders.filter((o) => o.salesOrderId === fromOrder);
      if (!rows.length) return null;
      const h = rows[0];
      return { label: `From Sales Order ${h.orderNumber || h.poNumber || ""}`.trim(), customerId: h.customerId || "", designIds: ids(rows.flatMap((o) => [o.design, o.designName])), sales_order: fromOrder };
    }
    const q = quotes.find((x) => x.id === fromQuote);
    if (!q) return null;
    const cust = customers.find((c) => c.code === q.partyCode || c.name === q.customer);
    return { label: `From Quote ${q.quoteNo}`, customerId: cust?.id || "", designIds: ids(q.lines.map((l) => l.item)), quote: fromQuote };
  }, [fromOrder, fromQuote, orders, quotes, customers, designs]);

  if (!can("panel_craft", "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (source === undefined) return <div className="dim">Loading…</div>;
  if ((fromOrder || fromQuote) && source === null) return <EmptyState title="Source record not found" hint="Open the Quote or Sales Order again and retry Request Panels" />;

  const panelCode = (id: string) => panels.find((p) => p.id === id)?.panelCode || "a panel";

  // One row per picked panel, sequentially; the source id rides on every row (→ New Request).
  const onSave = async (inputs: PanelOrderInput[]) => {
    const stamped = inputs.map((i) => ({ ...i, sales_order: source?.sales_order, quote: source?.quote }));
    let done = 0;
    let firstId = "";
    let firstError = "";
    const failed: string[] = [];
    for (const input of stamped) {
      const res = await createPanelOrder(input);
      if (res.ok) {
        done++;
        firstId ||= String(res.rowid || "");
      } else {
        firstError ||= res.error || "Save failed";
        failed.push(panelCode(input.panel));
      }
    }
    if (done === 0) {
      toast.error(firstError);
      return;
    }
    if (firstError) toast.error(`${done} of ${inputs.length} orders saved — not saved: ${failed.join(", ")} (${firstError})`);
    else toast.success(done === 1 ? (source ? "Panel request raised" : "Panel order saved") : `${done} panel ${source ? "requests raised" : "orders saved"}`);
    // Land on the record when there is exactly one; several → the board. Replace so Back never returns to a spent form.
    navigate(done === 1 && firstId ? `/panel-orders/${encodeURIComponent(firstId)}` : "/panel-orders", { replace: true });
  };

  return (
    <PanelOrderForm
      key={`${fromOrder}|${fromQuote}`}
      presetCustomerId={source?.customerId || undefined}
      presetDesignIds={source?.designIds}
      source={source ? { label: source.label } : undefined}
      onSave={onSave}
      onClose={() => navigate(fromOrder ? `/orders/${encodeURIComponent(fromOrder)}` : fromQuote ? `/quotes/${encodeURIComponent(fromQuote)}` : "/panel-orders")}
    />
  );
}
