/* Orders Pipeline (Kanban) — ported verbatim from prototype/views.jsx. */
import { memo, useMemo, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { ProgressBar } from "@/ui/primitives";
import { fmt, finishClass, pct } from "@/lib/format";
import { ORDERS, PARTIES, STAGES, type Order, type Stage } from "@/data";
import { QuickView } from "./QuickView";
import { OrderDrawer } from "@/features/orders/OrderDrawer";

export function Kanban() {
  const [filter, setFilter] = useState("all");
  const [openOrder, setOpenOrder] = useState<Order | null>(null);
  const [quickView, setQuickView] = useState<{ order: Order; rect: DOMRect } | null>(null);

  const byStage = useMemo(() => {
    const m: Record<string, Order[]> = {};
    STAGES.forEach((s) => (m[s.id] = []));
    ORDERS.forEach((o) => {
      if (filter === "all" || o.partyCode === filter) m[o.stage].push(o);
    });
    return m;
  }, [filter]);

  const handleOpenFull = (order: Order) => {
    setQuickView(null);
    setOpenOrder(order);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Orders Pipeline</div>
          <div className="sub">
            Click the <Icon name="chev-r" size={11} style={{ verticalAlign: "middle" }} /> arrow on a card for quick line-items view ·
            click the card for full details. {ORDERS.length} orders in flight.
          </div>
        </div>
        <div className="right">
          <button className="hbtn">
            <Icon name="filter" size={13} />
            Filters
          </button>
          <button className="hbtn primary" onClick={() => { location.hash = "#/orders"; }}>
            <Icon name="plus" size={13} />
            New Order
          </button>
        </div>
      </div>

      <div className="fbar">
        <button className={`btn ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
          All parties
        </button>
        {PARTIES.map((p) => (
          <button key={p.code} className={`btn ${filter === p.code ? "active" : ""}`} onClick={() => setFilter(p.code)}>
            {p.name}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <input type="text" placeholder="Search PO, design, party…" />
        <button className="btn">
          <Icon name="settings" size={12} />
          Fields
        </button>
      </div>

      <div className="kanban-grid">
        {STAGES.map((s) => (
          <KanbanColumn
            key={s.id}
            stage={s}
            orders={byStage[s.id]}
            onOpen={setOpenOrder}
            onQuickView={setQuickView}
            quickViewId={quickView?.order?.id}
          />
        ))}
      </div>

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
  onOpen,
  onQuickView,
  quickViewId,
}: {
  stage: Stage;
  orders: Order[];
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
        <span>{fmt(totalQty)} sqm</span>
        <span className="mono">{orders.length > 0 ? `avg ${fmt(totalQty / orders.length)}` : "—"}</span>
      </div>
      <div className="col-list">
        {orders.map((o) => (
          <KanbanCard key={o.id} order={o} onOpen={onOpen} onQuickView={onQuickView} quickViewActive={quickViewId === o.id} />
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
  onOpen,
  onQuickView,
  quickViewActive,
}: {
  order: Order;
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

  const siblings = ORDERS.filter((o) => o.poNumber === order.poNumber && o.partyCode === order.partyCode);
  const isMulti = siblings.length > 1;

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
    <div ref={cardRef} className="kcard" onClick={() => onOpen && onOpen(order)}>
      <button
        className={`quick-btn ${quickViewActive ? "open" : ""}`}
        onClick={handleQuickView}
        title={`Quick view${isMulti ? ` · ${siblings.length} items` : ""}`}
      >
        <Icon name="chev-r" size={13} />
      </button>

      <div className="top">
        <span className="po">{order.poNumber}</span>
        <span>·</span>
        <span>{order.flag}</span>
        {isMulti && (
          <span className="li-badge" title={`${siblings.length} line items in this PO`}>
            {siblings.length} items
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
          <span className="muted"> sqm</span>
        </span>
        <span style={{ marginLeft: "auto" }} className="muted mono">
          {order.dueDate}
        </span>
      </div>
    </div>
  );
});
