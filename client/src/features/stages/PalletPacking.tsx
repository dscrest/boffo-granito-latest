/* Pallet Packing — table is live (listOrders, Data Store). The "New
   Pallet" action opens the close-pallet saga form which commits a real
   PalletisedBatch (produced → palletized); table reloads on success.
   KPI tiles above remain static prototype figures. */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { KPI, StageBadge } from "@/ui/primitives";
import { finishClass } from "@/lib/format";
import { type Order } from "@/data";
import { listOrders } from "@/features/orders/ordersApi";
import { PalletPackForm } from "./PalletPackForm";
import { closePallet, type ClosePalletInput } from "./palletisationApi";

export function PalletPacking() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await listOrders();
    if (!res.ok) {
      setError(res.error || "Failed to load orders");
      return;
    }
    setOrders(res.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  const items = orders.filter((o) => o.stage === "packing" || o.stage === "loading" || o.stage === "final");

  // Form stays open (showing "Saving…") until the saga resolves; closes on success.
  const onSave = async (input: ClosePalletInput) => {
    setError(null);
    setNotice("Closing pallet…");
    const res = await closePallet(input);
    if (!res.ok) {
      setNotice(null);
      setError(res.error || "Close-pallet failed");
      toast.error(res.error || "Close-pallet failed");
      return;
    }
    const msg = `Pallet closed — batch #${res.rowid} · ${res.data?.boxes_packed ?? 0} boxes.`;
    setShowForm(false);
    setNotice(msg);
    toast.success(msg);
    void load();
  };

  return (
    <div>
      {showForm && <PalletPackForm onSave={onSave} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div>
          <div className="title">Pallet Packing</div>
          <div className="sub">
            {items.length} active packing jobs · 6,284 boxes total · 173 updates today
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
            <Icon name="download" size={13} />
            Print labels
          </button>
          <button className="hbtn primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Pallet
          </button>
        </div>
      </div>

      {error && (
        <div
          className="card"
          style={{ marginBottom: 12, borderLeft: "3px solid var(--c-red)", color: "var(--c-red)", padding: "10px 14px" }}
        >
          {error} — check the <a href="#/ops">Operations log</a>.
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPI label="Pallets In Progress" value="3,142" unit="pallets" delta="+128 today" trend="up" spark={[5, 6, 7, 8, 9, 10, 11]} color="var(--c-violet)" />
        <KPI label="Boxes Palletized" value="112,108" delta="6,284 boxes today" spark={[4, 6, 7, 9, 10, 11, 12]} color="var(--c-violet)" />
        <KPI label="Remaining to Pack" value="58,140" delta="across 173 SKUs" spark={[14, 12, 11, 10, 9, 8, 7]} color="var(--c-amber)" />
        <KPI label="Error Rate" value="0.02" unit="%" delta="3 mispacks this week" spark={[2, 1, 2, 1, 2, 1, 1]} color="var(--c-red)" />
      </div>

      <div className="fbar" style={{ marginTop: 14 }}>
        <button className="btn active">600x1200</button>
        <button className="btn">600x600</button>
        <button className="btn">200x1200</button>
        <button className="btn">800x1600</button>
        <button className="btn">75x600</button>
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search pallet code…" />
        <button className="btn">Group: Party</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Pallet ID</th>
              <th>PO Number</th>
              <th>Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th className="num" style={{ textAlign: "right" }}>
                Box/Pallet
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Pallet Qty
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Total Boxes
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Loaded
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 16).map((o, i) => {
              const palletId = `[${o.boxesPerPallet}x${Math.ceil(o.orderQty / 60 / o.boxesPerPallet)}] · 26-04-2026`;
              const loaded = Math.floor(o.loadedQty / 60);
              const total = Math.ceil(o.orderQty / 60);
              const palletQty = Math.ceil(total / o.boxesPerPallet);
              const status = o.loadedQty >= o.orderQty ? "final" : o.palletizedQty >= o.orderQty * 0.85 ? "loading" : "packing";
              return (
                <tr key={o.id + i}>
                  <td className="mono" style={{ color: "var(--fg)" }}>
                    {palletId.split(" · ")[0]}
                    <span className="muted" style={{ fontSize: 10, marginLeft: 6 }}>
                      26-04-2026
                    </span>
                  </td>
                  <td className="mono">{o.poNumber}</td>
                  <td>
                    <span className="design-name">{o.design}</span>
                  </td>
                  <td>
                    <span className={`chip size ${o.size.startsWith("200") || o.size.startsWith("75") ? "b" : ""}`}>{o.size}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(o.finish)}`}>{o.finish}</span>
                  </td>
                  <td className="num">{o.boxesPerPallet}</td>
                  <td className="num">{palletQty}</td>
                  <td className="num">{total}</td>
                  <td className="num" style={{ color: loaded > 0 ? "var(--c-green)" : "var(--dim)" }}>
                    {loaded || "—"}
                  </td>
                  <td>
                    <StageBadge stage={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
