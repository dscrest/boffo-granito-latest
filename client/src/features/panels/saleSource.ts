/* "Request Panels" / "Request Samples" from a Quote or Sales Order (CR-286,
   CR-317): resolve the source sale once — who it is for and which designs it
   carries — so both form pages lock the customer and preselect the items.
   Returns undefined while loading, null when there is no / an unknown
   source, else the resolved source. Lifted from PanelOrderFormPage. */
import { useEffect, useMemo, useState } from "react";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { cachedQuotes, listQuotes } from "@/features/quotes/quotesApi";
import { cachedCustomers, listCustomers, type CustomerRow } from "@/features/masters/customersApi";
import { cachedDesigns, listDesigns, type DesignRow } from "@/features/masters/designsApi";
import type { Order, Quote } from "@/data";

export type SaleSource = { label: string; customerId: string; designIds: string[]; sales_order?: string; quote?: string };

export function useSaleSource(fromOrder: string, fromQuote: string): SaleSource | null | undefined {
  const [orders, setOrders] = useState<Order[] | null>(() => (fromOrder ? cachedOrders() : []));
  const [quotes, setQuotes] = useState<Quote[] | null>(() => (fromQuote ? cachedQuotes() : []));
  const [customers, setCustomers] = useState<CustomerRow[] | null>(() => (fromQuote ? cachedCustomers() : []));
  const [designs, setDesigns] = useState<DesignRow[] | null>(() => (fromOrder || fromQuote ? cachedDesigns() : []));
  useEffect(() => {
    if (fromOrder) void listOrders().then((r) => setOrders(r.ok ? r.orders : []));
    if (fromQuote) void listQuotes().then((r) => setQuotes(r.ok ? r.quotes : []));
    if (fromQuote) void listCustomers().then((r) => setCustomers(r.ok ? r.customers : []));
    if (fromOrder || fromQuote) void listDesigns().then((r) => setDesigns(r.ok ? r.designs : []));
  }, [fromOrder, fromQuote]);

  // Design names on the sale → Design ROWIDs (lines store names; see data.ts).
  return useMemo((): SaleSource | null | undefined => {
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
}
