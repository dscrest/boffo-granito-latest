/* Order Detail Drawer — ported verbatim from prototype/order-detail.jsx. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { SplitBar, StageBadge } from "@/ui/primitives";
import { fmt, finishClass, pct } from "@/lib/format";
import { STAGES, type Order } from "@/data";
import { useOrders } from "./useOrders";
import { AdvanceButton } from "./AdvanceButton";
import { EmptyState } from "@/ui/States";

export function OrderDrawer({ order: initial, onClose }: { order: Order; onClose: () => void }) {
  // Live orders (cache-first, so opening the drawer costs no extra fetch).
  const { orders } = useOrders();
  // Track the live row so a stage advance from inside the drawer repaints
  // the timeline/badges without reopening; fall back to the clicked snapshot.
  const order = orders.find((o) => o.id === initial.id) ?? initial;
  const lineItems = useMemo(() => {
    const list = orders.filter((o) => o.poNumber === order.poNumber && o.partyCode === order.partyCode);
    return list.length > 0 ? list : [order];
  }, [orders, order]);

  const totals = useMemo(
    () =>
      lineItems.reduce(
        (a, o) => ({
          qty: a.qty + o.orderQty,
          produced: a.produced + o.producedQty,
          palletized: a.palletized + o.palletizedQty,
          loaded: a.loaded + o.loadedQty,
          boxes: a.boxes + o.totalBoxes,
          pallets: a.pallets + o.pallets,
        }),
        { qty: 0, produced: 0, palletized: 0, loaded: 0, boxes: 0, pallets: 0 },
      ),
    [lineItems],
  );

  const stageIdx = STAGES.findIndex((s) => s.id === order.stage);

  const navigate = useNavigate();
  // Same rule as OrderDetail's avail(): produced but not yet palletized.
  const palletizable = totals.produced - totals.palletized > 0;

  // Focus trap + Esc + focus restore, same as the form modals.
  const panelRef = useModalA11y(onClose);

  const [tab, setTab] = useState("overview");

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-label="Order detail">
        <div className="drawer-head">
          <div className="meta">
            <div className="id">
              PO · {order.poNumber}{" "}
              <span style={{ marginLeft: 8 }}>
                {order.flag} {order.party}
              </span>
            </div>
            <div className="title">
              {lineItems.length === 1 ? (
                order.design
              ) : (
                <>
                  {lineItems.length} line items · {fmt(totals.qty)} sqm total
                </>
              )}
            </div>
          </div>
          <div className="actions">
            <AdvanceButton order={order} className="hbtn primary" verbose />
            <button
              className="hbtn primary"
              disabled={!palletizable}
              title={palletizable ? "Select items and close a pallet" : "Nothing produced yet to palletize"}
              onClick={() => {
                onClose();
                navigate(`/orders/${encodeURIComponent(order.id)}`);
              }}
            >
              <Icon name="palette" size={13} />
              Send to Palletisation
            </button>
            <button className="iconbtn" title="Close" onClick={onClose} style={{ fontSize: 16 }}>
              ×
            </button>
          </div>
        </div>

        <div className="drawer-body">
          <div className="stage-timeline">
            {STAGES.map((s, i) => {
              const cls = i < stageIdx ? "done" : i === stageIdx ? "curr" : "";
              // No per-stage timestamps in the DB yet — say Done/In progress, never invent dates.
              const when = i < stageIdx ? "Done" : i === stageIdx ? "In progress" : "—";
              return (
                <div className={`stage-step ${cls}`} key={s.id}>
                  <div className="ring">{i < stageIdx ? <Icon name="check" size={11} /> : i + 1}</div>
                  <div className="name">{s.label}</div>
                  <div className="when">{when}</div>
                </div>
              );
            })}
          </div>

          <div className="mini-stats">
            <div className="mini-stat">
              <div className="l">Order Qty</div>
              <div className="v">
                {fmt(totals.qty)}
                <small>sqm</small>
              </div>
              <div className="sub">
                {totals.boxes} boxes · {totals.pallets} pallets
              </div>
            </div>
            <div className="mini-stat">
              <div className="l">Produced</div>
              <div className="v" style={{ color: "var(--c-blue)" }}>
                {pct(totals.produced, totals.qty)}
                <small>%</small>
              </div>
              <div className="sub">
                {fmt(totals.produced)} of {fmt(totals.qty)} sqm
              </div>
            </div>
            <div className="mini-stat">
              <div className="l">Palletized</div>
              <div className="v" style={{ color: "var(--c-violet)" }}>
                {pct(totals.palletized, totals.qty)}
                <small>%</small>
              </div>
              <div className="sub">{Math.ceil(totals.palletized / 60 / order.boxesPerPallet)} pallets packed</div>
            </div>
            <div className="mini-stat">
              <div className="l">Loaded</div>
              <div className="v" style={{ color: "var(--c-green)" }}>
                {pct(totals.loaded, totals.qty)}
                <small>%</small>
              </div>
              <div className="sub">{order.invoice || "—"}</div>
            </div>
          </div>

          <div className="dtabs" role="tablist">
            {(
              [
                ["overview", <>Line items <span className="ct">{lineItems.length}</span></>],
                ["packing", "Packing & pallets"],
                ["docs", "Documents"],
                ["activity", "Activity"],
              ] as [string, React.ReactNode][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`tab ${tab === id ? "active" : ""}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" && <OverviewTab order={order} lineItems={lineItems} />}
          {tab === "packing" && <PackingTab order={order} totals={totals} />}
          {tab === "docs" && <DocsTab order={order} />}
          {tab === "activity" && <ActivityTab order={order} />}
        </div>
      </aside>
    </>
  );
}

function OverviewTab({ order, lineItems }: { order: Order; lineItems: Order[] }) {
  return (
    <div className="dgrid">
      <div className="dpanel">
        <div className="head">
          <Icon name="tile" size={12} />
          Line items
          <span className="right">Click a row to drill into the SKU</span>
        </div>
        {/* .dpanel clips overflow — without this wrapper the Progress/Stage
            columns get cut off in the narrow drawer grid. */}
        <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28, textAlign: "center" }}>#</th>
              <th>Design</th>
              <th>Size</th>
              <th>Finish</th>
              <th className="num" style={{ textAlign: "right" }}>
                Ordered
              </th>
              <th className="num" style={{ textAlign: "right" }}>
                Produced
              </th>
              <th>Progress</th>
              <th>Stage</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li, i) => (
              <tr key={li.id} className={`li-row clickable ${li.id === order.id ? "current" : ""}`}>
                <td className="muted mono" style={{ textAlign: "center" }}>
                  {i + 1}
                </td>
                <td>
                  <span className="design-name">{li.design}</span>
                </td>
                <td>
                  <span className={`chip size ${li.size.startsWith("200") || li.size.startsWith("75") ? "b" : ""}`}>{li.size}</span>
                </td>
                <td>
                  <span className={`chip finish ${finishClass(li.finish)}`}>{li.finish}</span>
                </td>
                <td className="num">{fmt(li.orderQty)}</td>
                <td className="num">{fmt(li.producedQty)}</td>
                <td style={{ width: 90 }}>
                  <SplitBar produced={li.producedQty} palletized={li.palletizedQty} loaded={li.loadedQty} total={li.orderQty} />
                </td>
                <td>
                  <StageBadge stage={li.stage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="dpanel">
        <div className="head">
          <Icon name="docs" size={12} />
          Order specs
        </div>
        {/* Real SalesOrder/OrderItem fields only — no invented doc refs or shipping terms. */}
        <div className="spec-grid">
          <Spec l="PO Number" v={order.poNumber} mono />
          <Spec l="Party" v={`${order.flag} ${order.party}`} />
          <Spec l="Country" v={order.country} />
          <Spec l="Order Date" v={order.orderDate} mono />
          <Spec l="Due Date" v={order.dueDate} mono />
          <Spec l="Shipment Date" v={order.shipmentDate || "—"} mono />
          <Spec l="Priority" v={order.priority.toUpperCase()} />
          <Spec l="Brand" v={order.brand || "—"} />
          <Spec l="Box Branding" v={order.boxBranding || "—"} />
          <Spec l="Salesperson" v={order.salesperson || "—"} />
          <Spec l="Boxes / Pallet" v={order.boxesPerPallet} />
          <Spec l="Currency Total" v={order.totalAmount ? fmt(order.totalAmount) : "—"} mono />
        </div>
      </div>
    </div>
  );
}

function PackingTab({
  order,
  totals,
}: {
  order: Order;
  totals: { qty: number; palletized: number; loaded: number };
}) {
  const palletsTotal = Math.max(1, Math.ceil(totals.qty / 60 / order.boxesPerPallet));
  const packed = Math.ceil(totals.palletized / 60 / order.boxesPerPallet);
  const loaded = Math.ceil(totals.loaded / 60 / order.boxesPerPallet);
  const cells = Array.from({ length: palletsTotal }, (_, i) => {
    if (i < loaded) return "loaded";
    if (i < packed) return "packed";
    return "empty";
  });

  return (
    <div className="dgrid">
      <div className="dpanel">
        <div className="head">
          <Icon name="palette" size={12} />
          Pallets{" "}
          <span className="right">
            {palletsTotal} pallets total · {order.boxesPerPallet} boxes each
          </span>
        </div>
        <div className="pallet-grid">
          {cells.map((c, i) => (
            <div key={i} className={`pallet-cell ${c}`}>
              {i + 1}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 14, padding: "6px 14px 14px", fontSize: 11, color: "var(--muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="pallet-cell loaded" style={{ width: 12, height: 12 }} /> Loaded {loaded}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="pallet-cell packed" style={{ width: 12, height: 12 }} /> Packed {packed - loaded}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="pallet-cell empty" style={{ width: 12, height: 12, border: "1px solid var(--border)" }} /> Remaining{" "}
            {palletsTotal - packed}
          </span>
        </div>
      </div>

      <div className="dpanel">
        <div className="head">
          <Icon name="truck" size={12} />
          Shipment
        </div>
        {/* Truck/seal/ETA aren't captured per order yet (they live on Container
            loading) — show "—" rather than inventing them. */}
        <div className="spec-grid">
          <Spec l="Invoice No." v={order.invoice || "—"} mono />
          <Spec l="Loaded Pallets" v={`${loaded} of ${palletsTotal}`} />
          <Spec l="Loaded Boxes" v={fmt(loaded * order.boxesPerPallet)} />
          <Spec l="Truck No." v="—" mono />
          <Spec l="Container Seal" v="—" mono />
          <Spec l="ETA Port" v="—" />
        </div>
      </div>
    </div>
  );
}

/* Docs/Activity: no document store or per-order event feed is wired yet.
   Honest empty states until those APIs exist — never invented rows. */
function DocsTab(_props: { order: Order }) {
  return (
    <div className="dpanel">
      <div className="head">
        <Icon name="docs" size={12} />
        Documents
      </div>
      <EmptyState
        icon="docs"
        title="No documents attached"
        hint="Document storage isn't connected yet — PI, PO and packing list files will appear here once it is."
      />
    </div>
  );
}

function ActivityTab({ order }: { order: Order }) {
  return (
    <div className="dpanel">
      <div className="head">
        <Icon name="clock" size={12} />
        Timeline
      </div>
      <div className="activity">
        <div className="item">
          <div className="time">{order.orderDate}</div>
          <div className="indicator">
            <span className="dot amber" />
          </div>
          <div className="body">
            <div>
              <span className="action">PO created</span>
            </div>
            <div className="detail">
              {order.poNumber} · {order.party}
            </div>
          </div>
        </div>
      </div>
      <EmptyState
        icon="clock"
        title="Detailed activity coming soon"
        hint="Stage updates are recorded in the audit log; the per-order feed isn't connected here yet."
      />
    </div>
  );
}

function Spec({ l, v, mono }: { l: string; v: string | number; mono?: boolean }) {
  return (
    <div className="item">
      <div className="l">{l}</div>
      <div className={`v ${mono ? "mono" : ""}`}>{v}</div>
    </div>
  );
}
