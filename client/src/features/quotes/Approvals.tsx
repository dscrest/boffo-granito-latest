/* ============================================================
   Approvals — inbox for quotes and sales orders awaiting approval.

   Lists every PendingApproval quote / SO with Approve / Reject-with-
   reason actions (the /quote-status and /so-status state machines; on
   a verdict the salesperson is notified in-app). Each section shows
   only to roles whose Role.matrix "approve" list includes that doc
   type (Admin always qualifies); the route is gated the same way in
   App.tsx and the nav leaf by the "approvals" feature id.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { ErrorCard } from "@/ui/States";
import { fmt } from "@/lib/format";
import { canApprove } from "@/lib/auth";
import { quoteTotals, type Order, type Quote } from "@/data";
import { cachedQuotes, invalidateQuotes, listQuotes, setQuoteStatus } from "./quotesApi";
import { cachedOrders, invalidateOrders, listOrders, setOrderStatus } from "@/features/orders/ordersApi";

export function Approvals() {
  const [quotes, setQuotes] = useState<Quote[]>(() => cachedQuotes() ?? []);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [loading, setLoading] = useState(() => cachedQuotes() == null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // quote/SO id being acted on

  const showQuotes = canApprove("Quote");
  const showOrders = canApprove("SalesOrder");

  const load = async () => {
    setLoading(true);
    const [q, o] = await Promise.all([
      showQuotes ? listQuotes() : Promise.resolve({ ok: true, quotes: [] as Quote[] }),
      showOrders ? listOrders() : Promise.resolve({ ok: true, orders: [] as Order[] }),
    ]);
    setLoading(false);
    const err = (!q.ok && (q as { error?: string }).error) || (!o.ok && (o as { error?: string }).error);
    if (err) {
      setError(err || "Failed to load approvals");
      return;
    }
    setError(null);
    if ("quotes" in q) setQuotes(q.quotes);
    if ("orders" in o) setOrders(o.orders);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = quotes.filter((q) => q.status === "PendingApproval");
  // ordersApi rows are per line item — collapse to one row per SalesOrder.
  const pendingSOs = [...new Map(
    orders.filter((o) => o.status === "PendingApproval" && o.salesOrderId).map((o) => [o.salesOrderId!, o]),
  ).values()];

  const askReason = (label: string): string | null => {
    const r = window.prompt(`Rejection reason for ${label} (required):`, "");
    if (r === null) return null;
    if (!r.trim()) {
      toast.error("A rejection reason is required");
      return null;
    }
    return r.trim();
  };

  const act = async (q: Quote, approve: boolean) => {
    let reason = "";
    if (!approve) {
      const r = askReason(q.quoteNo);
      if (r === null) return;
      reason = r;
    }
    setBusy(q.id);
    const res = await setQuoteStatus(q.id, approve ? "Approved" : "Draft", reason || undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Action failed");
      return;
    }
    toast.success(approve ? `${q.quoteNo} approved` : `${q.quoteNo} rejected — back to draft`);
    invalidateQuotes();
    await load();
  };

  const actSO = async (o: Order, approve: boolean) => {
    let reason = "";
    if (!approve) {
      const r = askReason(o.poNumber);
      if (r === null) return;
      reason = r;
    }
    setBusy(o.salesOrderId!);
    const res = await setOrderStatus(o.salesOrderId!, approve ? "Confirmed" : "Draft", reason || undefined);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Action failed");
      return;
    }
    toast.success(approve ? `${o.poNumber} approved` : `${o.poNumber} rejected — back to draft`);
    invalidateOrders();
    await load();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Approvals</div>
          <div className="sub">Quotes and sales orders submitted for approval — approve to release, or reject with a reason.</div>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {showQuotes && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
            Quotations
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Quote No</th>
                  <th>Customer</th>
                  <th>Salesperson</th>
                  <th>Date</th>
                  <th className="num" style={{ textAlign: "right" }}>Total</th>
                  <th style={{ width: 200 }}></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link className="linkish" to={`/quotes/${q.id}`} title="Open quote">
                        {q.quoteNo}
                      </Link>
                    </td>
                    <td>{q.customer}</td>
                    <td className="muted">{q.salesperson || "—"}</td>
                    <td className="mono muted">{q.quoteDate || "—"}</td>
                    <td className="num mono">{q.currency} {fmt(quoteTotals(q).final)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="hbtn primary" disabled={busy === q.id} onClick={() => void act(q, true)} title="Approve">
                          <Icon name="check" size={13} /> Approve
                        </button>
                        <button className="hbtn" disabled={busy === q.id} onClick={() => void act(q, false)} title="Reject with reason" style={{ color: "var(--c-red)" }}>
                          <Icon name="x" size={13} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && pending.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No quotes waiting for approval.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showOrders && (
        <div className="card">
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
            Sales Orders
          </div>
          <div style={{ overflow: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Customer</th>
                  <th>Salesperson</th>
                  <th>Order Date</th>
                  <th style={{ width: 200 }}></th>
                </tr>
              </thead>
              <tbody>
                {pendingSOs.map((o) => (
                  <tr key={o.salesOrderId}>
                    <td>
                      <Link className="linkish" to={`/orders/${o.salesOrderId}`} title="Open order">
                        {o.poNumber}
                      </Link>
                    </td>
                    <td>{o.flag} {o.party}</td>
                    <td className="muted">{o.salesperson || "—"}</td>
                    <td className="mono muted">{o.orderDate || "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                        <button className="hbtn primary" disabled={busy === o.salesOrderId} onClick={() => void actSO(o, true)} title="Approve">
                          <Icon name="check" size={13} /> Approve
                        </button>
                        <button className="hbtn" disabled={busy === o.salesOrderId} onClick={() => void actSO(o, false)} title="Reject with reason" style={{ color: "var(--c-red)" }}>
                          <Icon name="x" size={13} /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && pendingSOs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                      No sales orders waiting for approval.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
