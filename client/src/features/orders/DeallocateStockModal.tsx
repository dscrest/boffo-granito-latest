/* ============================================================
   Deallocate Stock (CR-263, CR-297) — the reverse of Allocate Stock, per
   order line: every allocation row (batch · boxes · date · by) with a
   Return box (defaults to the whole row) and a Deallocate button that
   returns that many boxes to free stock. A partial return trims the row;
   a full return removes it. The Return box is capped at what the line
   has not palletised yet — server `deallocate-stock/:rowid` refuses the
   rest anyway. Scoped to ONE line (orderItemId) from the Items table /
   Production tab, or to the whole order from More.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { NumberInput } from "@/ui/NumberInput";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { cachedAllocEntries, deallocateStock, listProductionLogs, type AllocEntry } from "@/features/stages/productionApi";
import type { Order } from "@/data";

export function DeallocateStockModal({
  title,
  salesOrderId,
  orderItemId,
  items,
  onDone,
  onClose,
}: {
  title: string;
  salesOrderId: string;
  /** One line only; undefined = every allocation on the order. */
  orderItemId?: string;
  /** The order's lines — palletised boxes can never be returned. */
  items: Order[];
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const scope = (a: AllocEntry) => a.salesOrderId === salesOrderId && (!orderItemId || a.orderItemId === orderItemId);
  const [allocs, setAllocs] = useState<AllocEntry[] | null>(() => cachedAllocEntries().filter(scope));
  // Boxes to return per allocation row (string drafts) — defaults to the whole row.
  const [boxesById, setBoxesById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setAllocs(r.allocEntries.filter(scope)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderId, orderItemId, tick]);

  // Boxes of this line still returnable = allocated − palletised.
  const releasableOf = (a: AllocEntry) => {
    const o = items.find((i) => i.id === a.orderItemId);
    return o ? Math.max(0, o.producedQty - o.palletizedQty) : a.qtyBoxes;
  };
  const capOf = (a: AllocEntry) => Math.min(a.qtyBoxes, releasableOf(a));
  const boxesOf = (a: AllocEntry) => Math.min(Math.max(0, Math.floor(Number(boxesById[a.id] ?? capOf(a)) || 0)), capOf(a));

  const release = async (a: AllocEntry) => {
    const n = boxesOf(a);
    if (n <= 0) {
      toast.error("Enter how many boxes to return");
      return;
    }
    const what = `${a.design}${a.batchNumber ? ` (batch ${a.batchNumber})` : ""}`;
    const message =
      n < a.qtyBoxes
        ? `Return ${fmt(n)} of ${fmt(a.qtyBoxes)} boxes of ${what} to free stock? ${fmt(a.qtyBoxes - n)} stay allocated to this order.`
        : `Return all ${fmt(a.qtyBoxes)} boxes of ${what} to free stock?`;
    if (!(await confirmDialog({ title: "Deallocate stock", message, confirmLabel: "Deallocate", danger: true }))) return;
    setBusy(a.id);
    const res = await deallocateStock(a.id, n < a.qtyBoxes ? n : undefined);
    setBusy("");
    if (!res.ok) {
      toast.error(res.error || "Could not deallocate");
      return;
    }
    toast.success(`${fmt(n)} boxes returned to free stock`);
    setBoxesById((p) => {
      const { [a.id]: _gone, ...rest } = p;
      return rest;
    });
    setTick((t) => t + 1);
    onDone();
  };

  const rows = allocs ?? [];
  const total = rows.reduce((s, a) => s + a.qtyBoxes, 0);
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Deallocate Stock</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{title}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          {rows.length === 0 ? (
            <div className="dim" style={{ padding: 8 }}>{allocs === null ? "Loading…" : "No stock allocated here."}</div>
          ) : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Allocated on</th>
                    <th>Design</th>
                    <th>Batch</th>
                    <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    <th className="num" style={{ textAlign: "right" }}>Return</th>
                    <th>By</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const cap = capOf(a);
                    const n = boxesOf(a);
                    const locked = a.qtyBoxes - cap;
                    return (
                      <tr key={a.id}>
                        <td className="mono muted nw">{a.createdTime.slice(0, 10) || "—"}</td>
                        <td><span className="design-name">{a.design}</span></td>
                        <td className="nw">{a.batchNumber ? <span className="chip mono">{a.batchNumber}</span> : <span className="dim">—</span>}</td>
                        <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(a.qtyBoxes)}</td>
                        <td className="num">
                          {can("stages", "edit") ? (
                            <>
                              <NumberInput
                                value={boxesById[a.id] ?? String(cap)}
                                onChange={(e) => setBoxesById((p) => ({ ...p, [a.id]: e.target.value }))}
                                placeholder="0"
                                disabled={cap <= 0 || !!busy}
                                style={{ width: 84, textAlign: "right" }}
                                aria-label={`${a.design} boxes to return to free stock`}
                              />
                              {n < a.qtyBoxes && cap > 0 && (
                                <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: 2 }}>
                                  of {fmt(a.qtyBoxes)} — {fmt(a.qtyBoxes - n)} stay allocated
                                </div>
                              )}
                              {locked > 0 && (
                                <div style={{ fontSize: "var(--t-xs)", marginTop: 2, color: "var(--c-amber)" }}>
                                  {fmt(locked)} already palletised — unpack first
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="dim">—</span>
                          )}
                        </td>
                        <td className="muted nw">{a.performedBy || "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          {can("stages", "edit") && (
                            <button
                              type="button"
                              className="btn"
                              disabled={!!busy || cap <= 0}
                              title={cap <= 0 ? "Every box of this line is already palletised" : "Return these boxes to free stock"}
                              onClick={() => void release(a)}
                            >
                              Deallocate
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">{total > 0 ? `${fmt(total)} boxes allocated` : ""}</span>
          <button className="btn" onClick={onClose} disabled={!!busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
