/* ============================================================
   Panel Order form page (CR-290, CR-302) — PanelOrderForm as a full page,
   the PanelFormPage shape:
     /panel-orders/new                   New Panel Order
     /panel-orders/new?fromOrder=<soId>  "Request Panels" from a Sales Order
     /panel-orders/new?fromQuote=<id>    "Request Panels" from a Quote
     /panel-orders/:id/edit              edit header + lines (New / Received only)
     /panel-orders/:id/clone             clone customer + lines into a new order
   The request forms (CR-286) lock the customer, preselect the panels that
   carry the sale's designs and stamp the source id, so the order shows on
   the source record's Panel Orders tab. Every order is born New (CR-294).
   One Save = ONE /panel-order-save call (header + lines).
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { PanelOrderForm } from "./PanelOrderForm";
import { useSaleSource } from "./saleSource";
import {
  cachedPanelOrders,
  listPanelOrders,
  PANEL_ORDER_EDITABLE,
  PANEL_ORDER_LOCK_REASON,
  panelOrderToInput,
  savePanelOrder,
  type PanelOrderInput,
  type PanelOrderRow,
} from "./panelOrdersApi";

const detailUrl = (rowid: string) => `/panel-orders/${encodeURIComponent(rowid)}`;

export function PanelOrderFormPage() {
  const [params] = useSearchParams();
  const fromOrder = params.get("fromOrder") || "";
  const fromQuote = params.get("fromQuote") || "";
  const { id = "" } = useParams();
  const orderId = decodeURIComponent(id);
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!orderId && !clone;
  const navigate = useNavigate();

  const [panelOrders, setPanelOrders] = useState<PanelOrderRow[] | null>(() => cachedPanelOrders());
  useEffect(() => {
    if (orderId) void listPanelOrders().then((r) => setPanelOrders(r.ok ? r.orders : (cachedPanelOrders() ?? [])));
  }, [orderId]);
  // The source sale (customer + designs) — the hook is shared with the Sample Order form (CR-317).
  const source = useSaleSource(fromOrder, fromQuote);

  if (!can("panel_craft", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (source === undefined) return <div className="dim">Loading…</div>;
  if ((fromOrder || fromQuote) && source === null) return <EmptyState title="Source record not found" hint="Open the Quote or Sales Order again and retry Request Panels" />;
  if (orderId && panelOrders === null) return <div className="dim">Loading…</div>;
  const existing = orderId ? panelOrders?.find((o) => o.id === orderId) : undefined;
  if (orderId && !existing) return <EmptyState title="Panel order not found" />;
  if (editing && existing && !PANEL_ORDER_EDITABLE.has(existing.status)) {
    return <EmptyState title="This order is locked" hint={PANEL_ORDER_LOCK_REASON} />;
  }

  // Clone never copies the identity or the source — the server assigns the next PNL number.
  const initial: PanelOrderInput | undefined = existing
    ? editing
      ? panelOrderToInput(existing)
      : { ...panelOrderToInput(existing), order_date: todayISO(), sales_order: undefined, quote: undefined }
    : undefined;

  const onSave = async (input: PanelOrderInput) => {
    const res = await savePanelOrder({ ...input, sales_order: source?.sales_order, quote: source?.quote }, editing ? orderId : undefined);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Panel order updated" : source ? "Panel request raised" : "Panel order saved");
    // Land on the record. Replace so Back never returns to a spent form.
    navigate(editing ? detailUrl(orderId) : res.rowid ? detailUrl(res.rowid) : "/panel-orders", { replace: true });
  };

  return (
    <PanelOrderForm
      key={`${fromOrder}|${fromQuote}|${orderId}|${clone}`}
      initial={initial}
      orderNumber={editing ? existing?.orderNumber : undefined}
      isEdit={editing}
      presetCustomerId={source?.customerId || undefined}
      presetDesignIds={source?.designIds}
      source={source ? { label: source.label } : undefined}
      onSave={onSave}
      onClose={() => navigate(orderId ? detailUrl(orderId) : fromOrder ? `/orders/${encodeURIComponent(fromOrder)}` : fromQuote ? `/quotes/${encodeURIComponent(fromQuote)}` : "/panel-orders")}
    />
  );
}
