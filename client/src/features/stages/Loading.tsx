/* Loading — queue table is live (listOrders, Data Store); dock cards
   above remain static prototype figures. The "Schedule truck" action
   opens the load-container saga form (palletized → loaded); table
   reloads on success. */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ProgressBar, StageBadge } from "@/ui/primitives";
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
          <div className="sub">
            4 trucks at dock · 7 shipments queued · next loading 14:30
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
            <Icon name="docs" size={13} />
            Loading list
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="truck" size={13} />
            Schedule truck
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="split" style={{ gridTemplateColumns: "1fr 1fr 1fr", display: "grid", gap: 10 }}>
        {["Dock 1", "Dock 2", "Dock 3"].map((dock, i) => (
          <div className="card" key={dock}>
            <div className="card-head">
              <span className={`dot ${i === 1 ? "green" : i === 0 ? "amber" : "blue"}`} />
              <span className="title">{dock}</span>
              <span className="muted">· {["Idle since 12:10", "Loading EX-14/2026-27", "Truck arriving 14:30"][i]}</span>
              <div className="right muted">{["—", "38%", "queued"][i]}</div>
            </div>
            <div style={{ padding: "12px 14px" }}>
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="muted" style={{ fontSize: 11 }}>
                  {["Awaiting next shipment", "Merkury Market", "AB Specializuota"][i]}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>
                  {["—", "TR-MH-04 GH 2384", "TR-MH-04 GH 2391"][i]}
                </span>
              </div>
              <div className="row" style={{ gap: 8, fontSize: 11 }}>
                <span className="inline-stat">
                  <span className="l">Pallets</span>
                  <span className="v">{["—", "13/34", "0/22"][i]}</span>
                </span>
                <span className="inline-stat">
                  <span className="l">Boxes</span>
                  <span className="v">{["—", "494/1,292", "0/836"][i]}</span>
                </span>
                <span className="inline-stat">
                  <span className="l">ETA done</span>
                  <span className="v">{["—", "13:50", "15:20"][i]}</span>
                </span>
              </div>
              {i === 1 && (
                <div style={{ marginTop: 10 }}>
                  <ProgressBar value={38} max={100} color="var(--c-cyan)" height={5} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sec-title">
        <h2>Loading Queue</h2>
        <span className="meta">Ready to load · sorted by priority</span>
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
                Pallets
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Boxes
              </th>
              <th>Truck</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 12).map((o, i) => {
              const pallets = Math.ceil(o.palletizedQty / 60 / o.boxesPerPallet);
              const truck = `TR-MH-04 GH ${2380 + i}`;
              const status = i === 0 ? "loading" : i < 3 ? "packing" : "packing";
              return (
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
                  <td className="num">{pallets}</td>
                  <td className="num">{fmt(o.palletizedQty)}</td>
                  <td className="mono muted">{i < 4 ? truck : "—"}</td>
                  <td>
                    <StageBadge stage={status} />
                  </td>
                </tr>
              );
            })}
            {!loading && !error && items.length === 0 && (
              <tr>
                <td colSpan={9}>
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
