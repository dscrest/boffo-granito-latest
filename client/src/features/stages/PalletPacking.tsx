/* Palletization — split-view detail page (same design as Item/Quote detail):
   a resizable, searchable left sidebar of packing jobs and a right detail
   panel for the selected job. The "New Palletization" action opens the
   close-pallet saga form which commits a real PalletisedBatch (produced →
   palletized); the list reloads on success. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { StageBadge } from "@/ui/primitives";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { finishClass, fmt } from "@/lib/format";
import { type Order } from "@/data";
import { listOrders } from "@/features/orders/ordersApi";
import { PalletPackForm } from "./PalletPackForm";
import { closePallet, type ClosePalletInput } from "./palletisationApi";

export function PalletPacking() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");

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
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return packable.filter((o) => {
      if (!q) return true;
      return `${o.poNumber} ${o.design} ${o.party}`.toLowerCase().includes(q);
    });
  }, [orders, query]);

  // Auto-select the first job so the detail panel is never empty when jobs exist.
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId) setSelectedId("");
    } else if (!items.some((o) => o.id === selectedId)) {
      setSelectedId(items[0].id);
    }
  }, [items, selectedId]);

  const selected = items.find((o) => o.id === selectedId) || null;

  // Form stays open (showing "Saving…") until the sagas resolve; closes on
  // success. One batch is committed per distinct pallet chosen on the lines.
  const onSave = async (inputs: ClosePalletInput[]) => {
    setError(null);
    setNotice("Saving palletisation…");
    let done = 0;
    let boxes = 0;
    for (const input of inputs) {
      const res = await closePallet(input);
      if (!res.ok) {
        setNotice(null);
        setError(res.error || "Palletisation failed");
        toast.error(res.error || "Palletisation failed");
        void load();
        return;
      }
      done += 1;
      boxes += res.data?.boxes_packed ?? 0;
    }
    const msg = `Palletised — ${done} pallet${done > 1 ? "s" : ""} · ${boxes} boxes.`;
    setShowForm(false);
    setNotice(msg);
    toast.success(msg);
    void load();
  };

  const moreItems = selected
    ? [{ label: "Open Sales Order", onClick: () => navigate(`/orders/${encodeURIComponent(selected.id)}`) }]
    : [];

  return (
    <div>
      {showForm && <PalletPackForm onSave={onSave} onClose={() => setShowForm(false)} />}

      {/* Top toolbar — same aesthetic as the Quotes list (fbar + gsearch pill +
          primary New button aligned on one row). */}
      <div className="fbar" style={{ marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
          {packable.length} packing job{packable.length === 1 ? "" : "s"}
        </span>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search PO, design, customer…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <button className="hbtn primary" onClick={() => setShowForm(true)}>
          <Icon name="plus" size={13} />
          New Palletization
        </button>
        {selected && (
          <>
            <MoreMenu items={moreItems} />
            <button className="btn x" onClick={() => setSelectedId("")} title="Close selection">
              <Icon name="x" size={13} />
            </button>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {/* Left sidebar — list of packing jobs. Fixed viewport height with its OWN
          scroll, sticky while the detail scrolls; drag the bottom-right corner
          to resize. Mirrors Item/Quote detail. */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - var(--header-h) - 24px)",
          position: "sticky",
          top: 12,
        }}
      >
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {loading && orders.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <>
              {items.map((o) => {
                const cur = o.id === selectedId;
                return (
                  <button
                    key={o.id}
                    onClick={() => setSelectedId(o.id)}
                    title={o.poNumber}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "9px 12px",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      background: cur ? "var(--accent-soft)" : "transparent",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <div className="mono" style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {o.poNumber}
                    </div>
                    <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {o.party} · {o.size}
                    </div>
                  </button>
                );
              })}
              {!loading && items.length === 0 && (
                <div className="dim" style={{ padding: 12 }}>
                  {packable.length > 0 ? "No matching jobs" : "No packing jobs"}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

        {!selected ? (
          <div className="card" style={{ padding: 20 }}>
            {packable.length > 0 ? (
              <EmptyState title="No matching results" hint="Try a different search" />
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
          </div>
        ) : (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                className="title mono"
                style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                title={selected.poNumber}
              >
                {selected.poNumber}
              </div>
            </div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
              {selected.party} · {selected.design}
              {notice && <span style={{ marginLeft: 10 }}>· {notice}</span>}
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="form-section-title" style={{ marginBottom: 8 }}>Palletization Details</div>
              {(() => {
                const total = selected.orderQty;
                const palletQty = Math.ceil(total / selected.boxesPerPallet);
                const status = selected.loadedQty >= selected.orderQty ? "final" : selected.palletizedQty >= selected.orderQty * 0.85 ? "loading" : "packing";
                return (
                  <>
                    <DetailRow label="Customer" value={selected.party} />
                    <DetailRow label="PO Number" value={selected.poNumber} />
                    <DetailRow label="Design" value={selected.design} />
                    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>Size</span>
                      <span><span className={`chip size ${selected.size.startsWith("200") || selected.size.startsWith("75") ? "b" : ""}`}>{selected.size}</span></span>
                    </div>
                    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>Finish</span>
                      <span><span className={`chip finish ${finishClass(selected.finish)}`}>{selected.finish}</span></span>
                    </div>
                    <DetailRow label="Boxes / Pallet" value={String(selected.boxesPerPallet)} />
                    <DetailRow label="Pallets" value={String(palletQty)} />
                    <DetailRow label="Ordered (boxes)" value={fmt(total)} />
                    <DetailRow label="Palletized (boxes)" value={fmt(selected.palletizedQty)} />
                    <DetailRow label="Loaded (boxes)" value={selected.loadedQty ? fmt(selected.loadedQty) : "—"} />
                    <div style={{ display: "flex", gap: 12, padding: "6px 0" }}>
                      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>Status</span>
                      <span><StageBadge stage={status} /></span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
