/* Orders Pipeline (Kanban) — ported verbatim from prototype/views.jsx. */
import { memo, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { fmt, finishClass, pct } from "@/lib/format";
import { STAGES, type Order, type Stage } from "@/data";
import { useOrders } from "@/features/orders/useOrders";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { QuickView } from "./QuickView";
import { OrderDrawer } from "@/features/orders/OrderDrawer";
import { OrdersFilter, applyOrderFilter, EMPTY_FILTER } from "@/features/orders/OrdersFilter";
import { ViewToggle } from "@/features/orders/ViewToggle";

export function Kanban() {
  const { orders, loading, error, reload } = useOrders();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [quickView, setQuickView] = useState<{ order: Order; rect: DOMRect } | null>(null);

  // Same choosable filter + search as By Order.
  const filtered = useMemo(() => applyOrderFilter(orders, filter), [orders, filter]);

  const byStage = useMemo(() => {
    const m: Record<string, Order[]> = {};
    STAGES.forEach((s) => (m[s.id] = []));
    filtered.forEach((o) => {
      // Live rows can carry stage values outside STAGES — bucket them on the fly.
      (m[o.stage] ??= []).push(o);
    });
    return m;
  }, [filtered]);

  // Sales-order sibling counts for the "N items" badge on cards.
  const siblingCounts = useMemo(() => {
    const m: Record<string, number> = {};
    orders.forEach((o) => {
      const k = o.salesOrderId || `${o.poNumber}__${o.partyCode}`;
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [orders]);

  const handleOpenFull = (order: Order) => {
    setQuickView(null);
    setOpenOrder(order);
  };

  return (
    <div>
      <OrdersFilter
        orders={orders}
        value={filter}
        onChange={setFilter}
        actions={
          <>
            <ViewToggle />
            <button className="hbtn primary" onClick={() => { location.hash = "#/byorder?new=1"; }} title="New Order">
              <Icon name="plus" size={13} />
              New Order
            </button>
          </>
        }
      />

      {loading && orders.length === 0 ? (
        <SkeletonRows />
      ) : error && orders.length === 0 ? (
        <ErrorCard message={error} onRetry={reload} />
      ) : (
        <div className="kanban-grid">
          {STAGES.map((s) => (
            <KanbanColumn
              key={s.id}
              stage={s}
              orders={byStage[s.id]}
              siblingCounts={siblingCounts}
              onOpen={setOpenOrder}
              onQuickView={setQuickView}
              quickViewId={quickView?.order?.id}
            />
          ))}
        </div>
      )}

      {quickView && (
        <QuickView
          order={quickView.order}
          anchorRect={quickView.rect}
          onClose={() => setQuickView(null)}
          onOpenFull={handleOpenFull}
        />
      )}

      {openOrder && <OrderDrawer order={openOrder} onClose={() => setOpenOrder(null)} />}
    </div>
  );
}

/* Memoized: filter/quick-view state changes re-render only affected
   columns (setState setters passed as onOpen/onQuickView are stable). */
const KanbanColumn = memo(function KanbanColumn({
  stage,
  orders,
  siblingCounts,
  onOpen,
  onQuickView,
  quickViewId,
}: {
  stage: Stage;
  orders: Order[];
  siblingCounts: Record<string, number>;
  onOpen: (o: Order) => void;
  onQuickView: (v: { order: Order; rect: DOMRect } | null) => void;
  quickViewId?: string;
}) {
  const totalQty = orders.reduce((sum, o) => sum + o.orderQty, 0);
  return (
    <div className="col">
      <div className="col-head">
        <span className={`dot ${stage.color}`} />
        <span className="name">{stage.label}</span>
        <span className="count">{orders.length}</span>
      </div>
      <div
        style={{
          padding: "6px 12px 4px",
          fontSize: 10.5,
          color: "var(--muted)",
          display: "flex",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span>{fmt(totalQty)} boxes</span>
        <span className="mono">{orders.length > 0 ? `avg ${fmt(totalQty / orders.length)}` : "—"}</span>
      </div>
      <div className="col-list">
        {orders.map((o) => (
          <KanbanCard
            key={o.id}
            order={o}
            siblingCount={siblingCounts[o.salesOrderId || `${o.poNumber}__${o.partyCode}`] ?? 1}
            onOpen={onOpen}
            onQuickView={onQuickView}
            quickViewActive={quickViewId === o.id}
          />
        ))}
        {orders.length === 0 && (
          <div className="muted" style={{ padding: 16, textAlign: "center", fontSize: 11.5 }}>
            —
          </div>
        )}
      </div>
    </div>
  );
});

const KanbanCard = memo(function KanbanCard({
  order,
  siblingCount,
  onOpen,
  onQuickView,
  quickViewActive,
}: {
  order: Order;
  siblingCount: number;
  onOpen: (o: Order) => void;
  onQuickView: (v: { order: Order; rect: DOMRect } | null) => void;
  quickViewActive: boolean;
}) {
  const progress =
    order.stage === "po"
      ? 0
      : order.stage === "prod"
        ? pct(order.producedQty, order.orderQty)
        : order.stage === "packing"
          ? pct(order.palletizedQty, order.orderQty)
          : order.stage === "loading"
            ? pct(order.loadedQty, order.orderQty)
            : 100;

  const isMulti = siblingCount > 1;

  const cardRef = useRef<HTMLDivElement>(null);

  const handleQuickView = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!cardRef.current) return;
    if (quickViewActive) {
      onQuickView(null);
      return;
    }
    const rect = cardRef.current.getBoundingClientRect();
    onQuickView({ order, rect });
  };

  return (
    <div
      ref={cardRef}
      className="kcard"
      role="button"
      tabIndex={0}
      aria-label={`${order.orderNumber || order.poNumber} · ${order.design} · ${order.party}`}
      onClick={() => onOpen && onOpen(order)}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(order);
        }
      }}
    >
      <button
        className={`quick-btn ${quickViewActive ? "open" : ""}`}
        onClick={handleQuickView}
        title={`Quick view${isMulti ? ` · ${siblingCount} items` : ""}`}
      >
        <Icon name="chev-r" size={13} />
      </button>

      <div className="top">
        <span className="po">{order.orderNumber || order.poNumber}</span>
        <span>·</span>
        <span>{order.flag}</span>
        {isMulti && (
          <span className="li-badge" title={`${siblingCount} line items in this order`}>
            {siblingCount} items
          </span>
        )}
        <span className={`pri-dot pri ${order.priority}`} title={order.priority} style={{ marginLeft: "auto", marginRight: 26 }} />
      </div>
      <div className="design">{order.design}</div>
      <div className="party">{order.party}</div>
      <div className="chips">
        <span className={`chip size ${order.size.startsWith("200") || order.size.startsWith("75") ? "b" : ""}`}>{order.size}</span>
        <span className={`chip finish ${finishClass(order.finish)}`}>{order.finish}</span>
        <span className={`chip brand ${order.brand === "BIG" ? "big" : ""}`}>{order.brand}</span>
      </div>
      {order.stage !== "po" && order.stage !== "final" && (
        <ProgressBar
          value={progress}
          max={100}
          color={order.stage === "prod" ? "var(--c-blue)" : order.stage === "packing" ? "var(--c-violet)" : "var(--c-cyan)"}
        />
      )}
      <div className="meta">
        <span className="qty">
          {fmt(order.orderQty)}
          <span className="muted"> boxes</span>
        </span>
        <span style={{ marginLeft: "auto" }} className="muted mono">
          {order.dueDate}
        </span>
      </div>
    </div>
  );
});
