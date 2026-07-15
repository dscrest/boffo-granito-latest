/* By Order — grouped view. Ported verbatim from prototype/by-order.jsx.
   Now the primary orders list (All Orders commented, #21): carries New Order
   create (#8) + a choosable filter (#20). */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { can } from "@/lib/auth";
import { exportCsv } from "@/lib/csv";
import { fmt, finishClass, pct } from "@/lib/format";
import { STAGES, type Order } from "@/data";
import { useOrders } from "./useOrders";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { OrderDrawer } from "./OrderDrawer";
import { AdvanceButton } from "./AdvanceButton";
import { OrderForm, type OrderDraft } from "./OrderForm";
import { ViewToggle } from "./ViewToggle";
import { draftToInput } from "./OrdersTable";
import { createSalesOrder } from "./ordersApi";
import { OrdersFilter, applyOrderFilter, EMPTY_FILTER } from "./OrdersFilter";
import { toast } from "@/ui/Toast";
import { GridFooter, usePagination } from "@/ui/GridFooter";

interface Totals {
  qty: number;
  produced: number;
  palletized: number;
  loaded: number;
}
interface Group {
  key: string;
  salesOrderId: string;
  orderNumber: string;
  poNumber: string;
  partyCode: string;
  party: string;
  country: string;
  flag: string;
  orderDate: string;
  dueDate: string;
  items: Order[];
  totals: Totals;
  stageDist: Record<string, number>;
  minStageIdx: number;
  progress: number;
}

export function ByOrderView() {
  const { orders, loading, error, reload } = useOrders();
  const navigate = useNavigate();
  const [openDrawer, setOpenDrawer] = useState<Order | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // #20: shared choosable filter (Customer / PO / Stage) + free-text search.
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [showForm, setShowForm] = useState(false);

  // #8: deep-link from Dashboard "New Order" (/byorder?new=1) opens the form directly.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowForm(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSaveOrder = async (dr: OrderDraft) => {
    const res = await createSalesOrder(draftToInput(dr));
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setShowForm(false);
    toast.success(`Order saved (#${res.rowid})`);
    // Land on the new record so the next action can't target the wrong one.
    if (res.rowid) navigate(`/orders/${encodeURIComponent(res.rowid)}`);
  };

  // Filter + search applied before grouping (shared with the Pipeline).
  const fOrders = useMemo(() => applyOrderFilter(orders, filter), [orders, filter]);

  const groups = useMemo<Group[]>(() => {
    const m: Record<string, Omit<Group, "totals" | "stageDist" | "minStageIdx" | "progress">> = {};
    fOrders.forEach((o) => {
      // One group per SalesOrder (a PO number can repeat across orders).
      const key = o.salesOrderId || `${o.poNumber}__${o.partyCode}`;
      if (!m[key]) {
        m[key] = {
          key,
          salesOrderId: o.salesOrderId || "",
          orderNumber: o.orderNumber || "",
          poNumber: o.poNumber,
          partyCode: o.partyCode,
          party: o.party,
          country: o.country,
          flag: o.flag,
          orderDate: o.orderDate,
          dueDate: o.dueDate,
          items: [],
        };
      }
      m[key].items.push(o);
    });
    return Object.values(m).map((g) => {
      const totals = g.items.reduce(
        (a, o) => ({
          qty: a.qty + o.orderQty,
          produced: a.produced + o.producedQty,
          palletized: a.palletized + o.palletizedQty,
          loaded: a.loaded + o.loadedQty,
        }),
        { qty: 0, produced: 0, palletized: 0, loaded: 0 },
      );

      const stageDist: Record<string, number> = {};
      STAGES.forEach((s) => (stageDist[s.id] = 0));
      g.items.forEach((o) => (stageDist[o.stage] = (stageDist[o.stage] || 0) + 1));

      // Unknown stage values (legacy/seed rows) index as 0 instead of -1 so
      // STAGES[minStageIdx] below stays defined.
      const minStageIdx = Math.min(
        ...g.items.map((o) => Math.max(0, STAGES.findIndex((s) => s.id === o.stage))),
      );

      return { ...g, totals, stageDist, minStageIdx, progress: pct(totals.loaded, totals.qty) };
    });
  }, [fOrders]);

  // Newest sales order first (ROWIDs are chronological).
  const visible = useMemo(
    () => [...groups].sort((a, b) => Number(b.salesOrderId) - Number(a.salesOrderId)),
    [groups],
  );

  // House pager (grid standard): persisted page size, snaps to page 1 on
  // filter change via resetKey.
  const pager = usePagination(visible.length, "pg.byorder", JSON.stringify(filter));
  const shown = pager.slice(visible);

  const toggle = (key: string) => setCollapsed((s) => ({ ...s, [key]: !s[key] }));
  const allCollapsed = visible.every((g) => collapsed[g.key]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allCollapsed) visible.forEach((g) => (next[g.key] = true));
    setCollapsed(next);
  };

  return (
    <div>
      {showForm && <OrderForm onSave={onSaveOrder} onClose={() => setShowForm(false)} />}
      <div className="page-head">
        <div className="right">
          <ViewToggle />
          {can("orders", "export") && (
            <button
              className="hbtn"
              title="Export the filtered line items as CSV"
              onClick={() =>
                exportCsv("orders", fOrders, [
                  { header: "SO Number", value: (o) => o.orderNumber || "" },
                  { header: "PO Number", value: (o) => o.poNumber },
                  { header: "Customer", value: (o) => o.party },
                  { header: "Item", value: (o) => o.design },
                  { header: "Size", value: (o) => o.size },
                  { header: "Order Qty", value: (o) => o.orderQty },
                  { header: "Produced", value: (o) => o.producedQty },
                  { header: "Palletized", value: (o) => o.palletizedQty },
                  { header: "Loaded", value: (o) => o.loadedQty },
                  { header: "Stage", value: (o) => o.stage },
                  { header: "Status", value: (o) => o.status },
                  { header: "Order Date", value: (o) => o.orderDate },
                  { header: "Due Date", value: (o) => o.dueDate },
                ])
              }
            >
              <Icon name="docs" size={13} />
              Export
            </button>
          )}
          {can("orders", "create") && (
            <button className="hbtn primary" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={13} />
              New Order
            </button>
          )}
        </div>
      </div>

      {/* #20: shared choosable filter (type-to-search value) + search box.
         Collapse/Expand-all lives here (in the filter bar), not the header. */}
      <OrdersFilter
        orders={orders}
        value={filter}
        onChange={setFilter}
        actions={
          <button className="hbtn" onClick={toggleAll} title={allCollapsed ? "Expand all groups" : "Collapse all groups"}>
            <Icon name={allCollapsed ? "chev-r" : "menu"} size={13} />
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        }
      />

      {loading && orders.length === 0 ? (
        <SkeletonRows />
      ) : error && orders.length === 0 ? (
        <ErrorCard message={error} onRetry={reload} />
      ) : (
        <div className="bypo-list">
          {shown.map((g) => (
            <ByOrderGroup key={g.key} group={g} collapsed={!!collapsed[g.key]} onToggle={() => toggle(g.key)} onOpenLineItem={setOpenDrawer} />
          ))}
          {/* .card wrapper gives the standalone pager the house panel chrome. */}
          <div className="card" style={{ overflow: "hidden" }}>
            <GridFooter {...pager} />
          </div>
        </div>
      )}

      {openDrawer && <OrderDrawer order={openDrawer} onClose={() => setOpenDrawer(null)} />}
    </div>
  );
}

function ByOrderGroup({
  group,
  collapsed,
  onToggle,
  onOpenLineItem,
}: {
  group: Group;
  collapsed: boolean;
  onToggle: () => void;
  onOpenLineItem: (o: Order) => void;
}) {
  const { totals, stageDist, items } = group;
  const bottleneckStage = STAGES[group.minStageIdx];

  return (
    <div className={`bypo-group ${collapsed ? "collapsed" : ""}`}>
      <div className="bypo-rail">
        {!collapsed && <div className="po-lbl">Sales Order</div>}
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <button className="bypo-toggle" onClick={onToggle} title={collapsed ? "Expand" : "Collapse"}>
            <Icon name={collapsed ? "chev-r" : "arrow-down"} size={11} />
          </button>
          <div className="po-num">
            {group.salesOrderId ? (
              <Link className="linkish" to={`/orders/${group.salesOrderId}`} title="Open sales order">
                {group.orderNumber || group.poNumber}
              </Link>
            ) : (
              group.orderNumber || group.poNumber
            )}
          </div>
          {!collapsed && (
            <span className="li-badge" style={{ marginLeft: "auto" }}>
              {items.length} items
            </span>
          )}
        </div>
        {group.poNumber && (
          <div className="party-name" title="Customer PO number">
            <span className="mono">PO · {group.poNumber}</span>
          </div>
        )}
        <div className="party-name">
          <span>{group.party}</span>
          <span className="country">· {group.country}</span>
        </div>

        {!collapsed && (
          <>
            <div className="rail-stats">
              <div className="stat">
                <div className="l">Order Qty</div>
                <div className="v">
                  {fmt(totals.qty)} <span style={{ color: "var(--muted)", fontFamily: "var(--font-sans)" }}>boxes</span>
                </div>
              </div>
              <div className="stat">
                <div className="l">Line items</div>
                <div className="v">{items.length}</div>
              </div>
              <div className="stat">
                <div className="l">Produced</div>
                <div className="v" style={{ color: "var(--c-blue)" }}>
                  {pct(totals.produced, totals.qty)}%
                </div>
              </div>
              <div className="stat">
                <div className="l">Loaded</div>
                <div className="v" style={{ color: "var(--c-green)" }}>
                  {pct(totals.loaded, totals.qty)}%
                </div>
              </div>
            </div>

            <div className="rail-progress">
              <SplitBar produced={totals.produced} palletized={totals.palletized} loaded={totals.loaded} total={totals.qty} />
            </div>

            <div className="rail-stage-dist">
              {STAGES.map(
                (s) =>
                  stageDist[s.id] > 0 && (
                    <div className="row" key={s.id}>
                      <span className={`dot ${s.color}`} />
                      <span>{s.label}</span>
                      <span className="ct">{stageDist[s.id]}</span>
                    </div>
                  ),
              )}
            </div>

            <div className="rail-footer">
              <Icon name="calendar" size={10} />
              <span>Due</span>
              <span className="mono">{group.dueDate}</span>
              <span style={{ marginLeft: "auto" }}>
                <span className={`stage xs ${bottleneckStage.color}`}>
                  <span className={`dot ${bottleneckStage.color}`} />
                  at {bottleneckStage.short}
                </span>
              </span>
            </div>
          </>
        )}
      </div>

      {!collapsed && (
        <div className="bypo-items">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}>#</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Brand</th>
                <th className="num" style={{ textAlign: "right" }}>
                  Ordered (boxes)
                </th>
                <th className="num" style={{ textAlign: "right" }}>
                  Produced (boxes)
                </th>
                <th className="num" style={{ textAlign: "right" }}>
                  Loaded (boxes)
                </th>
                <th>Progress</th>
                <th>Stage</th>
                <th colSpan={2} style={{ width: 136 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((li, i) => (
                <tr
                  key={li.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={() => onOpenLineItem(li)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) onOpenLineItem(li);
                  }}
                  title="Open line item"
                >
                  <td className="li-num">{i + 1}</td>
                  <td className="li-design">{li.design}</td>
                  <td>
                    <span className={`chip size ${li.size.startsWith("200") || li.size.startsWith("75") ? "b" : ""}`}>{li.size}</span>
                  </td>
                  <td>
                    <span className={`chip finish ${finishClass(li.finish)}`}>{li.finish}</span>
                  </td>
                  <td>
                    <span className={`chip brand ${li.brand === "BIG" ? "big" : ""}`}>{li.brand}</span>
                  </td>
                  <td className="num">{fmt(li.orderQty)}</td>
                  <td className="num" style={{ color: li.producedQty > 0 ? "var(--c-blue)" : "var(--dim)" }}>
                    {li.producedQty > 0 ? fmt(li.producedQty) : "—"}
                  </td>
                  <td className="num" style={{ color: li.loadedQty > 0 ? "var(--c-green)" : "var(--dim)" }}>
                    {li.loadedQty > 0 ? fmt(li.loadedQty) : "—"}
                  </td>
                  <td style={{ width: 130 }}>
                    <div
                      className="row"
                      style={{ gap: 6, alignItems: "center" }}
                      title={`produced ${fmt(li.producedQty)} · palletized ${fmt(li.palletizedQty)} · loaded ${fmt(li.loadedQty)} of ${fmt(li.orderQty)}`}
                    >
                      <div style={{ flex: 1 }}>
                        <SplitBar produced={li.producedQty} palletized={li.palletizedQty} loaded={li.loadedQty} total={li.orderQty} />
                      </div>
                      <span className="mono dim" style={{ fontSize: 11 }}>{pct(li.loadedQty, li.orderQty)}%</span>
                    </div>
                  </td>
                  <td>
                    <StageBadge stage={li.stage} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <AdvanceButton order={li} />
                  </td>
                  <td className="expand-cell">
                    <Icon name="chev-r" size={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
