/* RETIRED 2026-08-29 — legacy PalletisedBatch/ContainerLoading flow; no route or
   caller imports this. The live path is PalPlans (/packing) + LoadingBay (/loading).
   Kept for git history; delete freely. */
/* Final Loading & Invoicing — invoice tables are live (listOrders, Data
   Store), grouped by invoice number. The "Dispatch" action opens the
   dispatch saga form (loaded → dispatched); tables reload on success.
   KPI tiles are live-computed from the loaded orders. */
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
    pallets: list.reduce((s, o) => s + Math.ceil(o.orderQty / o.boxesPerPallet), 0),
    boxes: list.reduce((s, o) => s + o.orderQty, 0),
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
            {loading ? "Loading…" : "Loaded orders grouped by invoice"}
            {notice && (
              <>
                {" · "}
                <span className="muted">{notice}</span>
              </>
            )}
          </div>
        </div>
        <div className="right">
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="truck" size={13} />
            Dispatch
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      {/* Live figures computed from the loaded orders — no placeholder numbers. */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPI label="Active Invoices" value={String(inv.length)} delta="awaiting dispatch" color="var(--c-green)" />
        <KPI label="Line Items" value={String(finals.length)} delta="in final stage" color="var(--c-green)" />
        <KPI label="Final Qty" value={fmt(finals.reduce((s, o) => s + o.orderQty, 0))} unit="boxes" color="var(--c-cyan)" />
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
              <th>Customer</th>
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
                <td colSpan={8}>
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

      {/* Batch-detail table removed — its Sr./batch/remaining figures were
          prototype fiction. It returns when it reads PalletisedBatch +
          ContainerLoading for real. */}
    </div>
  );
}
