/* Final Loading & Invoicing — invoice tables are live (listOrders, Data
   Store), grouped by invoice number. The "Dispatch" action opens the
   dispatch saga form (loaded → dispatched); tables reload on success.
   KPI tiles above remain static prototype figures. */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { KPI } from "@/ui/primitives";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { listOrders } from "@/features/orders/ordersApi";
import { DispatchForm } from "./DispatchForm";
import { dispatchContainer } from "./palletisationApi";

export function FinalLoading() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await listOrders();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load orders");
      return;
    }
    setOrders(res.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  const finals = orders.filter((o) => o.stage === "final");

  // Form stays open (showing "Dispatching…") until the saga resolves; closes on success.
  const onConfirm = async (containerId: string) => {
    setError(null);
    setNotice("Dispatching…");
    const res = await dispatchContainer(containerId);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Dispatch failed");
      toast.error(res.error || "Dispatch failed");
      return;
    }
    const msg = `Container #${res.rowid} dispatched — ${res.data?.batches ?? 0} batch(es) closed out.`;
    setShowForm(false);
    setNotice(msg);
    toast.success(msg);
    void load();
  };
  // Until the invoicing saga (Phase 5) stamps invoice numbers, dispatched
  // finals carry no invoice — group by PO so each shows as its own row.
  const invoices: Record<string, Order[]> = {};
  finals.forEach((o) => (invoices[o.invoice || o.poNumber] ||= []).push(o));
  const inv = Object.entries(invoices).map(([key, list]) => ({
    invoice: list[0].invoice || `${key} · pending`,
    party: list[0].party,
    flag: list[0].flag,
    country: list[0].country,
    pallets: list.reduce((s, o) => s + Math.ceil(o.orderQty / 60 / o.boxesPerPallet), 0),
    boxes: list.reduce((s, o) => s + Math.ceil(o.orderQty / 60), 0),
    qty: list.reduce((s, o) => s + o.orderQty, 0),
    items: list.length,
    date: list[0].dueDate,
  }));

  return (
    <div>
      {showForm && <DispatchForm onConfirm={onConfirm} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Final Loading &amp; Invoicing</div>
          <div className="sub">
            {inv.length} active invoices · 22 issued this month · ₹4.62 Cr
            {notice && (
              <>
                {" · "}
                <span className="dim">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="invoice" size={13} />
            Generate invoice
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="truck" size={13} />
            Dispatch
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPI label="Invoices (May)" value="22" delta="+4 vs April" trend="up" spark={[3, 4, 5, 4, 6, 7, 8]} color="var(--c-green)" />
        <KPI label="Pallets Loaded" value="347" unit="pallets" delta="EX-14/2026-27" spark={[5, 6, 7, 8, 9, 10, 11]} color="var(--c-green)" />
        <KPI label="Boxes Loaded" value="12,664" delta="818 boxes today" spark={[6, 8, 9, 10, 11, 12, 13]} color="var(--c-green)" />
        <KPI label="Avg Days to Ship" value="42" unit="days" delta="-3 days vs Q1" trend="up" spark={[10, 9, 8, 8, 7, 7, 6]} color="var(--c-cyan)" />
      </div>

      <div className="sec-title">
        <h2>Active Invoices</h2>
        <span className="meta">Grouped by invoice number</span>
        <div className="right">
          <span className="muted">Sorted by: Invoice date</span>
        </div>
      </div>

      <div className="card">
        {loading && orders.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Party</th>
              <th>Country</th>
              <th className="num" style={{ textAlign: "right" }}>
                Line Items
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Pallets
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Boxes
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Qty (sqm)
              </th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {inv.map((i) => (
              <tr key={i.invoice}>
                <td className="mono" style={{ color: "var(--fg)" }}>
                  {i.invoice}
                </td>
                <td>{i.party}</td>
                <td>
                  {i.flag} {i.country}
                </td>
                <td className="num">{i.items}</td>
                <td className="num">{i.pallets}</td>
                <td className="num">{fmt(i.boxes)}</td>
                <td className="num">{fmt(i.qty)}</td>
                <td className="mono muted">{i.date}</td>
                <td>
                  <span className="stage green">
                    <Icon name="check" size={11} />
                    Loaded
                  </span>
                </td>
              </tr>
            ))}
            {!loading && !error && inv.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon="invoice"
                    title="No active invoices"
                    hint="Orders appear here once they reach final loading"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>

      <div className="sec-title">
        <h2>Recent Invoices · Batch detail</h2>
        <span className="meta">Master view · Master - For Printing</span>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: "center" }}>Sr.</th>
              <th>PO Number</th>
              <th>Party</th>
              <th>Batch / Shade</th>
              <th className="num" style={{ textAlign: "right" }}>
                Pallets - Rem.
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Pallets Loaded
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Boxes / Pallet
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Loaded Boxes
              </th>
            </tr>
          </thead>
          <tbody>
            {finals.slice(0, 9).map((o, i) => {
              const pal = Math.ceil(o.orderQty / 60 / o.boxesPerPallet);
              const batch = `0${500 + i * 3}/${i % 2 ? 2 : 1}`;
              return (
                <tr key={o.id}>
                  <td className="muted mono" style={{ textAlign: "center" }}>
                    {419 + i}
                  </td>
                  <td className="mono">{o.poNumber}</td>
                  <td>
                    {o.flag} {o.party}
                  </td>
                  <td className="mono">{batch}</td>
                  <td className="num">{i === 1 ? 3 : 0}</td>
                  <td className="num">{pal - (i === 1 ? 3 : 0)}</td>
                  <td className="num">{o.boxesPerPallet}</td>
                  <td className="num">{fmt(Math.ceil(o.orderQty / 60))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
