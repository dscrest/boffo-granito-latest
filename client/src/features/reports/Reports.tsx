/* ============================================================
   Reports — Phase 5 quantity reports, all from live data.

   · By Item  — per design: ordered / produced / remaining / palletized / loaded
   · By PO    — same rollup per PO (party scoped)
   · Ready pallets — closed batches not yet loaded into a container

   Pure client-side aggregation over the live orders cache (useOrders)
   and the palletisation feed; no extra backend.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt, pct } from "@/lib/format";
import { ProgressBar } from "@/ui/primitives";
import { useOrders } from "@/features/orders/useOrders";
import { listLoadableBatches, type LoadableBatch } from "@/features/stages/palletisationApi";

type Tab = "item" | "po" | "ready";

interface QtyRow {
  key: string;
  label: string;
  sub: string;
  ordered: number;
  produced: number;
  palletized: number;
  loaded: number;
}

export function Reports() {
  const { orders, loading, error, reload } = useOrders();
  const [tab, setTab] = useState<Tab>("item");
  const [batches, setBatches] = useState<LoadableBatch[] | null>(null);
  const [batchErr, setBatchErr] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "ready" || batches !== null) return;
    void listLoadableBatches().then((res) => {
      if (!res.ok) {
        setBatchErr(res.error || "Failed to load ready pallets");
        return;
      }
      setBatchErr(null);
      setBatches(res.batches);
    });
  }, [tab, batches]);

  const byItem = useMemo<QtyRow[]>(() => {
    const m = new Map<string, QtyRow>();
    orders.forEach((o) => {
      const k = o.design || "—";
      const r = m.get(k) ?? {
        key: k,
        label: o.design || "—",
        sub: `${o.size} · ${o.finish}`,
        ordered: 0,
        produced: 0,
        palletized: 0,
        loaded: 0,
      };
      r.ordered += o.orderQty;
      r.produced += o.producedQty;
      r.palletized += o.palletizedQty;
      r.loaded += o.loadedQty;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.ordered - b.produced - (a.ordered - a.produced));
  }, [orders]);

  const byPo = useMemo<QtyRow[]>(() => {
    const m = new Map<string, QtyRow>();
    orders.forEach((o) => {
      const k = `${o.poNumber}__${o.partyCode}`;
      const r = m.get(k) ?? {
        key: k,
        label: o.poNumber || "—",
        sub: `${o.flag} ${o.party}`,
        ordered: 0,
        produced: 0,
        palletized: 0,
        loaded: 0,
      };
      r.ordered += o.orderQty;
      r.produced += o.producedQty;
      r.palletized += o.palletizedQty;
      r.loaded += o.loadedQty;
      m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.ordered - b.produced - (a.ordered - a.produced));
  }, [orders]);

  const rows = tab === "item" ? byItem : byPo;
  const readyBoxes = (batches ?? []).reduce((s, b) => s + b.boxes, 0);
  const showSkeleton = loading && orders.length === 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Quantity Reports</div>
          <div className="sub">Ordered vs produced vs remaining · ready pallets — live data</div>
        </div>
      </div>

      <div className="row" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
        <TabBtn active={tab === "item"} onClick={() => setTab("item")} label="By Item" />
        <TabBtn active={tab === "po"} onClick={() => setTab("po")} label="By PO" />
        <TabBtn active={tab === "ready"} onClick={() => setTab("ready")} label="Ready Pallets" />
      </div>

      {tab !== "ready" && (
        <>
          {error && <ErrorCard message={error} onRetry={reload} />}
          {showSkeleton ? (
            <SkeletonRows rows={8} />
          ) : (
            <div className="card">
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>{tab === "item" ? "Design" : "PO Number"}</th>
                      <th>{tab === "item" ? "Spec" : "Customer"}</th>
                      <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                      <th className="num" style={{ textAlign: "right" }}>Produced</th>
                      <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                      <th className="num" style={{ textAlign: "right" }}>Palletized</th>
                      <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                      <th style={{ width: 150 }}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const remaining = r.ordered - r.produced;
                      return (
                        <tr key={r.key}>
                          <td style={{ color: "var(--fg)" }}>{r.label}</td>
                          <td className="muted">{r.sub}</td>
                          <td className="num mono">{fmt(r.ordered)}</td>
                          <td className="num mono">{fmt(r.produced)}</td>
                          <td className="num mono" style={{ color: remaining > 0 ? "var(--c-amber)" : "var(--c-green)" }}>
                            {fmt(remaining)}
                          </td>
                          <td className="num mono">{fmt(r.palletized)}</td>
                          <td className="num mono">{fmt(r.loaded)}</td>
                          <td>
                            <div className="row" style={{ gap: 8, alignItems: "center" }}>
                              <ProgressBar value={r.produced} max={r.ordered} color="var(--c-blue)" height={4} />
                              <span className="mono muted" style={{ fontSize: "var(--t-sm)" }}>{pct(r.produced, r.ordered)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {rows.length === 0 && !loading && (
                      <tr>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <EmptyState icon="orders" title="No order data yet" hint="Create a master order to populate the report." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "ready" && (
        <>
          {batchErr && <ErrorCard message={batchErr} onRetry={() => setBatches(null)} />}
          {batches === null && !batchErr ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="card">
              <div className="card-head">
                <Icon name="truck" size={13} />
                <span className="title">Ready pallets</span>
                <span className="muted">
                  · {(batches ?? []).length} closed batch{(batches ?? []).length === 1 ? "" : "es"} · {fmt(readyBoxes)} boxes awaiting loading
                </span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th>Design</th>
                      <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(batches ?? []).map((b) => (
                      <tr key={b.batchId}>
                        <td className="mono muted">#{b.batchId.slice(-6)}</td>
                        <td style={{ color: "var(--fg)" }}>{b.label}</td>
                        <td className="num mono">{fmt(b.boxes)}</td>
                      </tr>
                    ))}
                    {(batches ?? []).length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: 0 }}>
                          <EmptyState icon="truck" title="No pallets waiting" hint="Close a pallet in Pallet Packing to see it here." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        background: "none",
        border: 0,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        color: active ? "var(--accent)" : "var(--fg-2)",
        font: "inherit",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
