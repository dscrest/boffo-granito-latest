/* ============================================================
   Sample Order form page (CR-315/317) — SampleOrderForm as a full page,
   the PanelOrderFormPage shape:
     /sample-orders/new                   New Sample Order
     /sample-orders/new?fromOrder=<soId>  "Request Samples" from a Sales Order
     /sample-orders/new?fromQuote=<id>    "Request Samples" from a Quote
     /sample-orders/:id/edit              edit header + lines (New only)
     /sample-orders/:id/clone             clone customer + lines into a new order
   The request forms lock the customer, preselect the sale's designs and
   stamp the source id. One Save = ONE /sample-order-save call.
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { SampleOrderForm } from "./SampleOrderForm";
import { useSaleSource } from "./saleSource";
import {
  cachedSampleOrders,
  listSampleOrders,
  SAMPLE_ORDER_EDITABLE,
  SAMPLE_ORDER_LOCK_REASON,
  sampleOrderToInput,
  saveSampleOrder,
  type SampleOrderInput,
  type SampleOrderRow,
} from "./sampleOrdersApi";

const detailUrl = (rowid: string) => `/sample-orders/${encodeURIComponent(rowid)}`;

export function SampleOrderFormPage() {
  const [params] = useSearchParams();
  const fromOrder = params.get("fromOrder") || "";
  const fromQuote = params.get("fromQuote") || "";
  const { id = "" } = useParams();
  const orderId = decodeURIComponent(id);
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!orderId && !clone;
  const navigate = useNavigate();

  const [orders, setOrders] = useState<SampleOrderRow[] | null>(() => cachedSampleOrders());
  useEffect(() => {
    if (orderId) void listSampleOrders().then((r) => setOrders(r.ok ? r.orders : (cachedSampleOrders() ?? [])));
  }, [orderId]);
  const source = useSaleSource(fromOrder, fromQuote);

  if (!can("panel_craft", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (source === undefined) return <div className="dim">Loading…</div>;
  if ((fromOrder || fromQuote) && source === null) return <EmptyState title="Source record not found" hint="Open the Quote or Sales Order again and retry Request Samples" />;
  if (orderId && orders === null) return <div className="dim">Loading…</div>;
  const existing = orderId ? orders?.find((o) => o.id === orderId) : undefined;
  if (orderId && !existing) return <EmptyState title="Sample order not found" />;
  if (editing && existing && !SAMPLE_ORDER_EDITABLE.has(existing.status)) {
    return <EmptyState title="This order is locked" hint={SAMPLE_ORDER_LOCK_REASON} />;
  }

  // Clone never copies the identity or the source — the server assigns the next SMP number.
  const initial: SampleOrderInput | undefined = existing
    ? editing
      ? sampleOrderToInput(existing)
      : (() => {
          // CR-504: a clone prices from today's Item rates, never the source's frozen ones.
          const i = sampleOrderToInput(existing);
          return { ...i, order_date: todayISO(), sales_order: undefined, quote: undefined, lines: i.lines.map((l) => ({ ...l, price: null })) };
        })()
    : undefined;

  const onSave = async (input: SampleOrderInput) => {
    const res = await saveSampleOrder({ ...input, sales_order: source?.sales_order, quote: source?.quote }, editing ? orderId : undefined);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Sample order updated" : source ? "Sample request raised" : "Sample order saved");
    navigate(editing ? detailUrl(orderId) : res.rowid ? detailUrl(res.rowid) : "/panel-orders?type=Sample", { replace: true });
  };

  return (
    <SampleOrderForm
      key={`${fromOrder}|${fromQuote}|${orderId}|${clone}`}
      initial={initial}
      orderNumber={editing ? existing?.orderNumber : undefined}
      isEdit={editing}
      presetCustomerId={source?.customerId || undefined}
      presetDesignIds={source?.designIds}
      source={source ? { label: source.label } : undefined}
      onSave={onSave}
      onClose={() => navigate(orderId ? detailUrl(orderId) : fromOrder ? `/orders/${encodeURIComponent(fromOrder)}` : fromQuote ? `/quotes/${encodeURIComponent(fromQuote)}` : "/panel-orders?type=Sample")}
    />
  );
}
