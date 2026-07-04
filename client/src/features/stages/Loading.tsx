/* Loading — queue table is live (listOrders, Data Store); dock cards
   above remain static prototype figures. The "Schedule truck" action
   opens the load-container saga form (palletized → loaded); table
   reloads on success. */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { StageBadge } from "@/ui/primitives";
import { fmt } from "@/lib/format";
import { type Order } from "@/data";
import { listOrders } from "@/features/orders/ordersApi";
import { LoadContainerForm } from "./LoadContainerForm";
import { loadContainer, type LoadContainerInput } from "./palletisationApi";

export function Loading() {
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

  const items = orders.filter((o) => o.stage === "loading" || o.stage === "packing");

  // Form stays open (showing "Loading…") until the saga resolves; closes on success.
  const onSave = async (input: LoadContainerInput) => {
    setError(null);
    setNotice("Loading container…");
    const res = await loadContainer(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Load-container failed");
      toast.error(res.error || "Load-container failed");
      return;
    }
    const msg = `Container loaded — ${res.data?.loaded_batches ?? input.batches.length} pallet(s) on container #${res.rowid}.`;
    setShowForm(false);
    setNotice(msg);
    toast.success(msg);
    void load();
  };

  return (
    <div>
      {showForm && <LoadContainerForm onSave={onSave} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Loading</div>
          <div className="sub">{loading ? "Loading…" : <span className="dim">{notice}</span>}</div>
        </div>
        <div className="right">
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="truck" size={13} />
            Schedule truck
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="sec-title">
        <h2>Loading Queue</h2>
        <span className="meta">Palletized orders ready to load</span>
      </div>

      <div className="card">
        {loading && orders.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Sequence</th>
              <th>PO / Invoice</th>
              <th>Party</th>
              <th>Design</th>
              <th>Size</th>
              <th className="num" style={{ textAlign: "right" }}>
                Palletized (sqm)
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((o, i) => (
              <tr key={o.id}>
                <td className="mono muted">#{(i + 1).toString().padStart(2, "0")}</td>
                <td>
                  <div className="mono">{o.poNumber}</div>
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    {o.invoice || "pending"}
                  </div>
                </td>
                <td>
                  {o.flag} {o.party}
                </td>
                <td>
                  <span className="design-name">{o.design}</span>
                </td>
                <td>
                  <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                </td>
                <td className="num">{fmt(o.palletizedQty)}</td>
                <td>
                  <StageBadge stage={o.stage} />
                </td>
              </tr>
            ))}
            {!loading && !error && items.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    icon="truck"
                    title="Loading queue is empty"
                    hint="Orders appear here once they are palletized and ready to load"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}
