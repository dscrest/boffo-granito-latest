/* ============================================================
   Allocate Stock for a panel order (CR-312) — ONE modal, both directions.
   Each requirement row carries the pieces this order has BOOKED; type a
   higher figure to book free pieces, a lower one to release them, 0 to
   release all (reallocating = release here, book on the other order).
   Cap per row = min(need, booked + free) — free is on hand not booked by
   ANY open order; the server re-checks need + free before the single
   write (/panel-order-allocate, absolute set). Skin = the SO Allocate
   Stock modal (df-modal).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { NumberInput } from "@/ui/NumberInput";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { allocatePanelOrder, type Allocation, type Requirement } from "./panelOrdersApi";

export function AllocateCutStockModal({
  orderId,
  title,
  reqs,
  onDone,
  onClose,
}: {
  orderId: string;
  /** Record identity under the title (PNL number · customer). */
  title: string;
  /** The order's requirement rows with `allocated` (this order) and `free` (nobody's) filled. */
  reqs: Requirement[];
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [booked, setBooked] = useState<Allocation>(() => Object.fromEntries(reqs.map((r) => [r.key, r.allocated])));
  const [saving, setSaving] = useState(false);

  /** What this order may hold: what it already holds + what nobody holds, never above its need. */
  const capOf = (r: Requirement) => Math.min(r.need, r.allocated + r.free);
  const set = (r: Requirement, v: number) => setBooked((prev) => ({ ...prev, [r.key]: Math.max(0, Math.min(capOf(r), Math.floor(v) || 0)) }));
  const bookAll = () => setBooked(Object.fromEntries(reqs.map((r) => [r.key, capOf(r)])));
  const releaseAll = () => setBooked(Object.fromEntries(reqs.map((r) => [r.key, 0])));
  const total = reqs.reduce((s, r) => s + (booked[r.key] ?? 0), 0);
  const needTotal = reqs.reduce((s, r) => s + r.need, 0);
  const changed = reqs.some((r) => (booked[r.key] ?? 0) !== r.allocated);

  const submit = async () => {
    if (saving || !changed) return;
    setSaving(true);
    const res = await allocatePanelOrder(orderId, booked);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not update the booking");
      return;
    }
    toast.success(`${fmt(total)} of ${fmt(needTotal)} pcs booked to this order`);
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
          {reqs.length === 0 && <div className="dim" style={{ padding: 8 }}>No cut pieces required — these panels have no designs yet.</div>}
          {reqs.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: "var(--t-sm)" }}>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={bookAll} disabled={saving}>Book all available</button>
                <button type="button" className="linkish" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={releaseAll} disabled={saving}>Release all</button>
                <span className="dim" style={{ marginLeft: "auto" }}>Free = on hand not booked by any order</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Design</th>
                    <th>Cut Piece Size</th>
                    <th className="num" style={{ textAlign: "right" }}>Need</th>
                    <th className="num" style={{ textAlign: "right" }}>Free</th>
                    <th className="num" style={{ textAlign: "right", width: 120 }}>Booked</th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((r) => {
                    const cap = capOf(r);
                    return (
                      <tr key={r.key}>
                        <td><span className="design-name">{r.designName}</span></td>
                        <td className="mono">{r.cutSizeName || <span className="dim">—</span>}</td>
                        <td className="num mono">{fmt(r.need)}</td>
                        <td className="num mono" style={r.free === 0 && r.allocated < r.need ? { color: "var(--c-red)" } : undefined} title={cap < r.need ? `Only ${fmt(cap)} of ${fmt(r.need)} can be booked — cut ${fmt(r.need - cap)} more` : undefined}>
                          {fmt(r.free)}
                        </td>
                        <td className="num">
                          <NumberInput
                            min={0}
                            value={booked[r.key] ?? 0}
                            onChange={(e) => set(r, Number(e.target.value))}
                            placeholder="0"
                            style={{ width: 100, textAlign: "right" }}
                            aria-label={`${r.designName} ${r.cutSizeName} pieces booked`}
                            disabled={saving}
                          />
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
          <span className="df-req-note">{reqs.length ? `${fmt(total)} of ${fmt(needTotal)} pcs booked` : ""}</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving || !changed} onClick={() => void submit()}>
            {saving ? <BoffoLoader size="sm" /> : <><Icon name="check" size={13} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
