/* ============================================================
   Deallocate Stock (CR-263) — the reverse of Allocate Stock, per order
   line: every allocation row (batch · boxes · date · by) with a ✕ that
   returns those boxes to free stock. Server `deallocate-stock/:rowid`
   refuses a row whose boxes are already palletised. Scoped to ONE line
   (orderItemId) from the Items table, or to the whole order from More.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { can } from "@/lib/auth";
import { cachedAllocEntries, deallocateStock, listProductionLogs, type AllocEntry } from "@/features/stages/productionApi";

export function DeallocateStockModal({
  title,
  salesOrderId,
  orderItemId,
  onDone,
  onClose,
}: {
  title: string;
  salesOrderId: string;
  /** One line only; undefined = every allocation on the order. */
  orderItemId?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const scope = (a: AllocEntry) => a.salesOrderId === salesOrderId && (!orderItemId || a.orderItemId === orderItemId);
  const [allocs, setAllocs] = useState<AllocEntry[] | null>(() => cachedAllocEntries().filter(scope));
  const [busy, setBusy] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    void listProductionLogs().then((r) => r.ok && setAllocs(r.allocEntries.filter(scope)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderId, orderItemId, tick]);

  const release = async (a: AllocEntry) => {
    if (!(await confirmDialog({ title: "Deallocate stock", message: `Return ${fmt(a.qtyBoxes)} boxes of ${a.design}${a.batchNumber ? ` (batch ${a.batchNumber})` : ""} to free stock?`, confirmLabel: "Deallocate", danger: true }))) return;
    setBusy(a.id);
    const res = await deallocateStock(a.id);
    setBusy("");
    if (!res.ok) {
      toast.error(res.error || "Could not deallocate");
      return;
    }
    toast.success(`${fmt(a.qtyBoxes)} boxes returned to free stock`);
    setTick((t) => t + 1);
    onDone();
  };

  const rows = allocs ?? [];
  const total = rows.reduce((s, a) => s + a.qtyBoxes, 0);
  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
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
                    <th>By</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td className="mono muted nw">{a.createdTime.slice(0, 10) || "—"}</td>
                      <td><span className="design-name">{a.design}</span></td>
                      <td className="nw">{a.batchNumber ? <span className="chip mono">{a.batchNumber}</span> : <span className="dim">—</span>}</td>
                      <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(a.qtyBoxes)}</td>
                      <td className="muted nw">{a.performedBy || "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {can("stages", "edit") && (
                          <button type="button" className="btn ord-rm" disabled={!!busy} title="Deallocate — return these boxes to free stock" onClick={() => void release(a)}>✕</button>
                        )}
                      </td>
                    </tr>
                  ))}
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
