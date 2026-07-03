/* Pallet Packing — table is live (listOrders, Data Store). The "New
   Pallet" action opens the close-pallet saga form which commits a real
   PalletisedBatch (produced → palletized); table reloads on success.
   KPI tiles above remain static prototype figures. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { KPI, StageBadge } from "@/ui/primitives";
import { finishClass } from "@/lib/format";
import { type Order } from "@/data";
import { listOrders } from "@/features/orders/ordersApi";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { PalletPackForm } from "./PalletPackForm";
import { closePallet, type ClosePalletInput } from "./palletisationApi";

export function PalletPacking() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeF, setSizeF] = useState("");
  const [query, setQuery] = useState("");

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

  const packable = orders.filter((o) => o.stage === "packing" || o.stage === "loading" || o.stage === "final");
  // Size chips come from the live rows (DB-sourced), not a static list.
  const sizeOptions = useMemo(() => [...new Set(packable.map((o) => o.size).filter(Boolean))].sort(), [orders]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packable.filter((o) => {
      if (sizeF && o.size !== sizeF) return false;
      if (!q) return true;
      return `${o.poNumber} ${o.design} ${o.party}`.toLowerCase().includes(q);
    });
  }, [orders, sizeF, query]);
  const pager = usePagination(items.length, "packingPageSize", `${sizeF}|${query}`);

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
          <div className="title">Palletization</div>
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
            New Palletization
          </button>
        </div>
      </div>

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPI label="Pallets In Progress" value="3,142" unit="pallets" delta="+128 today" trend="up" spark={[5, 6, 7, 8, 9, 10, 11]} color="var(--c-violet)" />
        <KPI label="Boxes Palletized" value="112,108" delta="6,284 boxes today" spark={[4, 6, 7, 9, 10, 11, 12]} color="var(--c-violet)" />
        <KPI label="Remaining to Pack" value="58,140" delta="across 173 SKUs" spark={[14, 12, 11, 10, 9, 8, 7]} color="var(--c-amber)" />
        <KPI label="Error Rate" value="0.02" unit="%" delta="3 mispacks this week" spark={[2, 1, 2, 1, 2, 1, 1]} color="var(--c-red)" />
      </div>

      <div className="fbar" style={{ marginTop: 14 }}>
        {sizeOptions.map((s) => (
          <button
            key={s}
            className={`btn${sizeF === s ? " active" : ""}`}
            onClick={() => setSizeF(sizeF === s ? "" : s)}
            title={sizeF === s ? "Clear size filter" : `Only ${s}`}
          >
            {s}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input
          type="text"
          placeholder="Search PO, design, party…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card">
        {loading && orders.length === 0 ? (
          <SkeletonRows rows={6} />
        ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Party</th>
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
            {pager.slice(items).map((o, i) => {
              const loaded = Math.floor(o.loadedQty / 60);
              const total = Math.ceil(o.orderQty / 60);
              const palletQty = Math.ceil(total / o.boxesPerPallet);
              const status = o.loadedQty >= o.orderQty ? "final" : o.palletizedQty >= o.orderQty * 0.85 ? "loading" : "packing";
              return (
                <tr
                  key={o.id + i}
                  tabIndex={0}
                  onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/orders/${encodeURIComponent(o.id)}`);
                  }}
                  style={{ cursor: "pointer" }}
                  title="Open order details"
                >
                  <td>
                    <span style={{ marginRight: 6 }}>{o.flag}</span>
                    {o.party}
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
            {!loading && !error && items.length === 0 && (
              <tr>
                <td colSpan={10}>
                  {packable.length > 0 ? (
                    <EmptyState title="No matching results" hint="Try a different size filter or search" />
                  ) : (
                    <EmptyState
                      icon="package"
                      title="No packing jobs"
                      hint="Orders appear here once they reach the packing stage"
                      action={
                        <button className="hbtn primary" onClick={() => setShowForm(true)}>
                          New Palletization
                        </button>
                      }
                    />
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        )}
        {!(loading && orders.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
