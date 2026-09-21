/* ============================================================
   Allocate Stock (CR-199, production-first) — the factory produces to
   stock; this hands FREE stock to a Sales Order. One section per order
   line: the item row, then its batches with available boxes (oldest first)
   and a qty to allocate. Saving bumps the
   line's produced qty and drops the boxes into Ready for Palletization —
   everything downstream is unchanged. Free = on hand − boxes other order
   lines already own (batchStockApi `free`); the server re-checks it.
   ============================================================ */
import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import type { Order } from "@/data";
import { cachedBatchStock, listBatchStock, type BatchStockRow } from "@/features/stages/batchStockApi";
import { allocateStock } from "@/features/stages/productionApi";

const needOf = (o: Order) => Math.max(0, o.orderQty - o.producedQty);
// Oldest first; the unbatched bucket ("" mfg date) leads, as in the stock FIFO.
const byAge = (a: BatchStockRow, b: BatchStockRow) => a.mfgDate.localeCompare(b.mfgDate) || a.batchNumber.localeCompare(b.batchNumber);

export function AllocateStockModal({
  title,
  items,
  onDone,
  onClose,
}: {
  /** Record identity under the title (SO number · customer). */
  title: string;
  /** The Sales Order's lines (Order.id = OrderItem ROWID). */
  items: Order[];
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [stock, setStock] = useState<BatchStockRow[]>(() => cachedBatchStock() ?? []);
  const [qty, setQty] = useState<Map<string, number>>(new Map()); // `${orderItemId}|${batch}` → boxes
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    void listBatchStock().then((r) => r.ok && setStock(r.rows));
  }, []);

  const open = items.filter((o) => needOf(o) > 0);
  const shown = open.filter((o) => o.design.toLowerCase().includes(q.trim().toLowerCase()));
  // Join on the unique label (unique_name), never the plain design_name — that is
  // shared across sizes/finishes and the server checks free stock per Design row.
  const rowsFor = (o: Order) => stock.filter((r) => r.designLabel === o.design && r.free > 0).sort(byAge);
  const key = (o: Order, r: BatchStockRow) => `${o.id}|${r.batchNumber}`;
  const pickedFor = (o: Order) => rowsFor(o).reduce((s, r) => s + (qty.get(key(o, r)) || 0), 0);

  // ponytail: two lines of the SAME design share a batch's free boxes and are
  // not clamped against each other here — the server 409 is the backstop.
  const setRow = (o: Order, r: BatchStockRow, v: number) => {
    const others = pickedFor(o) - (qty.get(key(o, r)) || 0);
    const cap = Math.max(0, Math.min(r.free, needOf(o) - others));
    setQty((prev) => new Map(prev).set(key(o, r), Math.max(0, Math.min(cap, Math.floor(v) || 0))));
  };
  const total = open.reduce((s, o) => s + pickedFor(o), 0);

  const submit = async () => {
    if (saving || total === 0) return;
    setSaving(true);
    let done = 0;
    for (const o of open) {
      const rows = rowsFor(o)
        .map((r) => ({ batch_number: r.batchNumber, qty_boxes: qty.get(key(o, r)) || 0 }))
        .filter((r) => r.qty_boxes > 0);
      if (!rows.length) continue;
      const res = await allocateStock({ order_item: o.id, rows });
      if (!res.ok) {
        setSaving(false);
        toast.error(`${o.design}: ${res.error || "Could not allocate stock"}`);
        if (done > 0) onDone();
        return;
      }
      done += rows.reduce((s, r) => s + r.qty_boxes, 0);
    }
    setSaving(false);
    toast.success(`${fmt(done)} boxes allocated — queued in Ready for Palletization`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Allocate Stock</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{title}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {open.length === 0 && <div className="dim" style={{ padding: 8 }}>Every item on this order is fully allocated.</div>}
          {open.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div className="lp-search">
                <Icon name="search" size={13} />
                <input type="text" placeholder="Search item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Item / Batch</th>
                    <th className="num" style={{ textAlign: "right" }}>Available</th>
                    <th className="num" style={{ textAlign: "right", width: 120 }}>Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr><td colSpan={3} className="dim">No items match.</td></tr>
                  )}
                  {shown.map((o) => {
                    const rows = rowsFor(o);
                    return (
                      <Fragment key={o.id}>
                        <tr style={{ background: "var(--panel-2)" }}>
                          <td style={{ fontWeight: 600 }}>{o.design}</td>
                          <td className="num mono">{fmt(rows.reduce((s, r) => s + r.free, 0))}</td>
                          <td className="num mono" title="Boxes this item still needs">{fmt(needOf(o) - pickedFor(o))} to allocate</td>
                        </tr>
                        {rows.length === 0 && (
                          <tr><td colSpan={3} style={{ paddingLeft: 28, color: "var(--c-red)" }}>No stock available — needs production</td></tr>
                        )}
                        {rows.map((r) => (
                          <tr key={r.batchNumber}>
                            <td className="mono" style={{ paddingLeft: 28 }}>{r.batchNumber || "—"}</td>
                            <td className="num mono">{fmt(r.free)}</td>
                            <td className="num">
                              <NumberInput
                                min={0}
                                value={qty.get(key(o, r)) || ""}
                                onChange={(e) => setRow(o, r, Number(e.target.value))}
                                placeholder="0"
                                style={{ width: 100, textAlign: "right" }}
                                aria-label={`${o.design} batch ${r.batchNumber || "unbatched"} boxes to allocate`}
                              />
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">{total > 0 ? `${fmt(total)} boxes to allocate` : ""}</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving || total === 0} onClick={() => void submit()}>
            <Icon name="check" size={13} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
