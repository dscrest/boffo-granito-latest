/* "Which samples did we supply this customer, how many, against which
   request?" (CR-317) — the Samples section on the Customer page: one row
   per sample LINE across every sample order of the customer, newest order
   first. The row opens the order. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Chip } from "@/ui/Chip";
import { codeOf } from "@/ui/statusCode";
import { EmptyState } from "@/ui/States";
import { fmt } from "@/lib/format";
import { ImageThumb } from "@/features/common/ImageLightbox";
import { SAMPLE_STATUS_TONE } from "./pcBits";
import { cachedSampleOrders, listSampleOrders, SAMPLE_PIECE_LABEL, SAMPLE_STATUS_LABEL, type SampleOrderRow } from "./sampleOrdersApi";

export function CustomerSamples({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SampleOrderRow[]>(() => cachedSampleOrders() ?? []);
  useEffect(() => {
    void listSampleOrders().then((r) => r.ok && setOrders(r.orders));
  }, []);
  const rows = useMemo(
    () => orders.filter((o) => o.customerId === customerId).flatMap((o) => o.lines.map((l) => ({ o, l }))),
    [orders, customerId],
  );
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (rows.length === 0) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <EmptyState title="No samples yet" hint="Sample orders for this customer show here (Sales ▸ Panel Craft ▸ Sample Orders)" />
      </div>
    );
  }
  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 44 }}>Image</th>
              <th>Item</th>
              <th>Piece</th>
              <th>Cut Piece Size</th>
              <th className="num" style={{ textAlign: "right" }}>Requested</th>
              <th className="num" style={{ textAlign: "right" }}>Supplied</th>
              <th>Supplied On</th>
              <th>Order Date</th>
              <th>Status</th>
              <th>Source</th>
              <th>Order No</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ o, l }) => {
              const to = `/sample-orders/${encodeURIComponent(o.id)}`;
              return (
                <tr
                  key={l.id}
                  tabIndex={0}
                  style={{ cursor: "pointer" }}
                  title="Open sample order"
                  onClick={() => navigate(to)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) navigate(to);
                  }}
                >
                  <td><ImageThumb images={l.images} alt={l.designName} /></td>
                  <td>
                    <Link className="linkish" to={`/design/${encodeURIComponent(l.designId)}`} onClick={stop} title="Open item">{l.designName}</Link>
                  </td>
                  <td>{SAMPLE_PIECE_LABEL[l.pieceKind]}</td>
                  <td className="mono muted">{l.pieceKind === "Cut" ? l.cutSizeName || "—" : <span className="dim">—</span>}</td>
                  <td className="num mono">{fmt(l.qty)}</td>
                  <td className="num mono">{fmt(l.suppliedQty)}</td>
                  <td className="mono muted">{l.suppliedOn || <span className="dim">—</span>}</td>
                  <td className="mono muted">{o.orderDate || "—"}</td>
                  <td>
                    <Chip tone={SAMPLE_STATUS_TONE[o.status]} label={codeOf(SAMPLE_STATUS_LABEL[o.status])} title={SAMPLE_STATUS_LABEL[o.status]} />
                  </td>
                  <td>
                    {o.salesOrderId ? (
                      <Link className="linkish mono" to={`/orders/${encodeURIComponent(o.salesOrderId)}`} onClick={stop}>{o.salesOrderNo || "SO"}</Link>
                    ) : o.quoteId ? (
                      <Link className="linkish mono" to={`/quotes/${encodeURIComponent(o.quoteId)}`} onClick={stop}>{o.quoteNo || "Quote"}</Link>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td className="mono dim">{o.orderNumber || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
