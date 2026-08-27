/* ============================================================
   Load Planner — current container availability at a glance.

   1. Every non-dispatched container: destination, capacity, loaded,
      remaining space, fill % (ground truth from ContainerLoading —
      not the fit engine's hypothetical assignments).
   2. Ongoing orders with boxes ready to load / awaiting palletization
      that could top up the remaining space (spec 8.2).
   3. The existing LoadBoard for drag-drop rebalancing.
   Read-only page; all writes stay in Palletization / Loading.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState, SkeletonRows } from "@/ui/States";
import { ProgressBar } from "@/ui/primitives";
import { fmt } from "@/lib/format";
import type { Order } from "@/data";
import { LoadBoard } from "@/features/masters/LoadBoard";
import { listContainers, listContainerFill, type ContainerRow } from "@/features/masters/containersApi";
import { listOrders } from "@/features/orders/ordersApi";

const STATUS_COLOR: Record<string, string> = {
  planned: "var(--dim)",
  loading: "var(--c-cyan)",
  sealed: "var(--c-amber)",
};

export function LoadPlanner() {
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [fill, setFill] = useState<Map<string, number>>(new Map());
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [cs, cf, os] = await Promise.all([listContainers(), listContainerFill(), listOrders()]);
      setLoading(false);
      const err = (!cs.ok && cs.error) || (!cf.ok && cf.error) || (!os.ok && os.error);
      if (err) toast.error(err);
      setContainers(cs.ok ? cs.containers : []);
      setFill(cf.ok ? cf.loadedBoxes : new Map());
      setOrders(os.ok ? os.orders : []);
    })();
  }, []);

  const active = useMemo(
    () =>
      containers
        .filter((c) => c.status !== "dispatched")
        .map((c) => {
          const loaded = fill.get(c.id) || 0;
          return {
            ...c,
            loaded,
            remaining: Math.max(0, c.capacityBoxes - loaded),
            pctFill: c.capacityBoxes > 0 ? Math.round((loaded / c.capacityBoxes) * 100) : 0,
          };
        }),
    [containers, fill],
  );

  // Order lines with boxes that could fill remaining container space:
  // palletized-not-loaded (ready to load now) or produced-not-palletized.
  const ongoing = useMemo(
    () =>
      orders
        .map((o) => ({
          ...o,
          readyToLoad: Math.max(0, o.palletizedQty - o.loadedQty),
          awaitingPallet: Math.max(0, o.producedQty - o.palletizedQty),
        }))
        .filter((o) => o.readyToLoad > 0 || o.awaitingPallet > 0)
        .sort((a, b) => b.readyToLoad - a.readyToLoad),
    [orders],
  );

  return (
    <div>
      <div className="sec-title">
        <h2>Container Availability</h2>
        <span className="meta">
          {loading ? "Loading…" : `${active.length} active containers · ${fmt(active.reduce((s, c) => s + c.remaining, 0))} boxes of free space`}
        </span>
      </div>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : active.length === 0 ? (
        <EmptyState title="No active containers" hint="Add containers in Stages → Container Master." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Container</th>
                <th>Type</th>
                <th>Status</th>
                <th>Destination</th>
                <th className="num" style={{ textAlign: "right" }}>Capacity (boxes)</th>
                <th className="num" style={{ textAlign: "right" }}>Loaded (boxes)</th>
                <th className="num" style={{ textAlign: "right" }}>Space left (boxes)</th>
                <th style={{ width: 150 }}>Fill</th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.containerNumber}</td>
                  <td><span className="chip">{c.containerType || "—"}</span></td>
                  <td>
                    <span className="chip" style={{ color: STATUS_COLOR[c.status] || "var(--dim)" }}>{c.status}</span>
                  </td>
                  <td>{c.portOfDischarge || "—"}</td>
                  <td className="num mono">{c.capacityBoxes > 0 ? fmt(c.capacityBoxes) : "—"}</td>
                  <td className="num mono">{fmt(c.loaded)}</td>
                  <td className="num mono">{c.capacityBoxes > 0 ? fmt(c.remaining) : "—"}</td>
                  <td>
                    <div className="row" style={{ gap: 6, alignItems: "center" }}>
                      <div style={{ flex: 1 }}>
                        <ProgressBar value={c.loaded} max={c.capacityBoxes} />
                      </div>
                      <span className="mono dim" style={{ fontSize: 13 }}>{c.pctFill}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="sec-title" style={{ marginTop: 22 }}>
        <h2>Ongoing Orders</h2>
        <span className="meta">
          boxes that could fill the space above ·{" "}
          <Link to="/packing">Palletization</Link> · <Link to="/loading">Loading</Link>
        </span>
      </div>
      {!loading && ongoing.length === 0 ? (
        <EmptyState title="Nothing waiting" hint="No boxes are palletized-but-unloaded or produced-but-unpalletized." />
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>PO</th>
                <th>Customer</th>
                <th>Design</th>
                <th>Size</th>
                <th className="num" style={{ textAlign: "right" }}>Ready to load (boxes)</th>
                <th className="num" style={{ textAlign: "right" }}>Awaiting palletization (boxes)</th>
              </tr>
            </thead>
            <tbody>
              {ongoing.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.poNumber}</td>
                  <td>{o.party}</td>
                  <td><span className="design-name">{o.design}</span></td>
                  <td>{o.size}</td>
                  <td className="num mono" style={{ color: o.readyToLoad > 0 ? "var(--c-violet)" : "var(--dim)" }}>
                    {o.readyToLoad > 0 ? fmt(o.readyToLoad) : "—"}
                  </td>
                  <td className="num mono" style={{ color: o.awaitingPallet > 0 ? "var(--c-blue)" : "var(--dim)" }}>
                    {o.awaitingPallet > 0 ? fmt(o.awaitingPallet) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LoadBoard containers={containers} />
    </div>
  );
}
