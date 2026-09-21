/* ============================================================
   Sales Order form page (CR-219) — the OrderForm as a full page,
   one component for every mode:
     /orders/new                 create
     /orders/new?quote=<id>      Convert-to-SO from an Accepted quote
     /orders/:id/edit            edit
     /orders/:id/clone           clone into a new order
   Loads the record, persists the draft, lands on the saved order's
   detail. A failed save stays here with everything typed.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import type { Order, Quote } from "@/data";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { draftToInput } from "./OrdersTable";
import { cachedOrders, createSalesOrder, invalidateOrders, listOrders, updateSalesOrderWithItems } from "./ordersApi";
import { convertible } from "@/features/quotes/QuotesTable";
import { cachedQuotes, convertQuote, invalidateQuotes, listQuotes } from "@/features/quotes/quotesApi";

export function OrderFormPage() {
  const { id = "" } = useParams();
  const orderId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const quoteId = orderId ? "" : params.get("quote") || "";
  const clone = useLocation().pathname.endsWith("/clone");
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [loading, setLoading] = useState(!!(orderId || quoteId));
  useEffect(() => {
    if (orderId) void listOrders().then((r) => { if (r.ok) setOrders(r.orders); setLoading(false); });
    else if (quoteId) void listQuotes().then((r) => { if (r.ok) setQuotes(r.quotes); setLoading(false); });
  }, [orderId, quoteId]);

  // Same resolution as OrderDetail: the id is an OrderItem or the SalesOrder itself.
  const items = useMemo(() => {
    const head = orders.find((o) => o.id === orderId) ?? orders.find((o) => o.salesOrderId === orderId);
    if (!head) return [];
    return head.salesOrderId ? orders.filter((o) => o.salesOrderId === head.salesOrderId) : [head];
  }, [orders, orderId]);
  const quote = quoteId ? quotes.find((x) => x.id === quoteId) : undefined;

  const detailUrl = (rowid: string) => `/orders/${encodeURIComponent(rowid)}`;
  const backTo = orderId ? detailUrl(orderId) : quoteId ? `/quotes/${encodeURIComponent(quoteId)}` : "/orders";

  if (!can("orders", orderId && !clone ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  // Wait for the fresh list — the form seeds its state once, so a stale cache must never be what gets edited.
  if (loading) return <div className="dim">Loading…</div>;
  if (orderId && !items.length) return <EmptyState title="Order not found" />;
  if (quoteId && !quote) return <EmptyState title="Quote not found" />;
  if (quote && !convertible(quote.status)) {
    return <EmptyState title={`${quote.quoteNo} can't be converted`} hint="Only an Accepted quote converts to a Sales Order" />;
  }

  const onSave = async (dr: OrderDraft) => {
    if (quote) return onConvert(quote, dr);
    const soId = items[0]?.salesOrderId;
    const editing = !!soId && !clone;
    const res = editing ? await updateSalesOrderWithItems(soId, draftToInput(dr)) : await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    const created = res.data as { order_number?: string } | undefined;
    toast.success(editing ? "Order updated" : `Order ${created?.order_number ?? ""} created`);
    // Land on the saved record; replace so Back never returns to a spent form.
    navigate(editing ? detailUrl(orderId) : res.rowid ? detailUrl(res.rowid) : "/orders", { replace: true });
  };

  // The server re-derives Full/Partial from what's actually left; mode here only tags the remarks.
  const onConvert = async (q: Quote, d: OrderDraft) => {
    const lines = d.lines.map((l) => ({
      item: l.design,
      qty: parseInt(l.ordered_qty_boxes, 10) || 0,
      rate: parseFloat(l.rate) || 0,
      pallet: l.pallet || "",
      discount: parseFloat(l.discount) || 0,
      description: l.description || "",
    }));
    const req = new Map<string, number>();
    for (const l of lines) req.set(l.item, (req.get(l.item) || 0) + l.qty);
    const isFull = q.lines.every((l) => {
      const rem = Math.max(0, (l.qty || 0) - (l.converted || 0));
      return rem === 0 || (req.get(l.item) || 0) >= rem;
    });
    const res = await convertQuote(q.id, isFull ? "Full" : "Partial", lines, {
      po_number: d.po_number,
      box_brand: d.box_brand,
      order_date: d.order_date,
      shipment_date: d.shipment_date,
      payment_term: d.payment_term,
      salesperson: d.salesperson,
      address: d.address,
      shipping_address: d.shipping_address,
      customer_notes: d.customer_notes,
      terms: d.terms,
      remarks: d.remarks,
      // #17: doc-level discount removed from SOs — never inherit the quote's.
      discount: 0,
      adjustment: Number(d.adjustment) || 0,
      tax_type: d.taxType,
      tax_pct: Number(d.taxPct) || 0,
    });
    if (!res.ok) {
      toast.error(res.error || "Convert failed");
      return;
    }
    toast.success(`Quote converted to ${res.data?.order_number || "Sales Order"}`);
    invalidateQuotes();
    invalidateOrders();
    navigate(res.rowid ? detailUrl(res.rowid) : "/orders", { replace: true });
  };

  return (
    <OrderForm
      key={`${orderId}|${quoteId}|${clone}`}
      initial={orderId ? items : undefined}
      clone={clone}
      convert={quote ? { quote } : undefined}
      onSave={onSave}
      onClose={() => navigate(backTo)}
    />
  );
}
