/* ============================================================
   Record Supply for a sample order (CR-316) — ONE modal: a date, an
   optional note and, per line, how many pieces go out now (default =
   whatever remains; 0 = skip the line). Partial supplies are fine — the
   header status is re-derived on the server. Cut-piece lines deduct cut
   stock (409 when free stock is short); Full tiles are record-only.
   Skin = the SO Allocate Stock modal (df-modal); busy = BoffoLoader.
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { NumberInput } from "@/ui/NumberInput";
import { DateInput } from "@/ui/DateInput";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { todayISO } from "@/lib/dates";
import { recordSampleSupply, remaining, SAMPLE_PIECE_LABEL, SAMPLE_STATUS_LABEL, type SampleOrderRow } from "./sampleOrdersApi";

export function RecordSupplyModal({ order, onDone, onClose }: { order: SampleOrderRow; onDone: () => void; onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  const open = order.lines.filter((l) => remaining(l) > 0);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(open.map((l) => [l.id, remaining(l)])));
  const [saving, setSaving] = useState(false);

  const set = (id: string, cap: number, v: number) => setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(cap, Math.floor(v) || 0)) }));
  const total = open.reduce((s, l) => s + (qty[l.id] ?? 0), 0);

  const submit = async () => {
    if (saving || total === 0) return;
    setSaving(true);
    const res = await recordSampleSupply(order.id, { date, note: note.trim() || undefined, lines: open.map((l) => ({ line: l.id, qty: qty[l.id] ?? 0 })) });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not record the supply");
      return;
    }
    toast.success(`${fmt(total)} pcs supplied${res.data?.status ? ` · ${SAMPLE_STATUS_LABEL[res.data.status]}` : ""}`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Record Supply</div>
            <div className="dim mono" style={{ fontSize: "var(--t-sm)" }}>{order.orderNumber || "Sample Order"} · {order.customerName}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div className="form-rows" style={{ marginBottom: 10 }}>
            <label className="form-field">
              <span className="lbl">Supplied On</span>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="form-field span2">
              <span className="lbl">Note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Courier, hand-carried, who took it…" />
            </label>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Piece</th>
                  <th className="num" style={{ textAlign: "right" }}>Requested</th>
                  <th className="num" style={{ textAlign: "right" }}>Supplied</th>
                  <th className="num" style={{ textAlign: "right" }}>Remaining</th>
                  <th className="num" style={{ textAlign: "right", width: 120 }}>Supply Now</th>
                </tr>
              </thead>
              <tbody>
                {open.map((l) => {
                  const cap = remaining(l);
                  return (
                    <tr key={l.id}>
                      <td><span className="design-name">{l.designName}</span></td>
                      <td className="mono">{l.pieceKind === "Cut" ? l.cutSizeName || "Cut piece" : SAMPLE_PIECE_LABEL.Full}</td>
                      <td className="num mono">{fmt(l.qty)}</td>
                      <td className="num mono">{fmt(l.suppliedQty)}</td>
                      <td className="num mono">{fmt(cap)}</td>
                      <td className="num">
                        <NumberInput
                          min={0}
                          value={qty[l.id] ?? 0}
                          onChange={(e) => set(l.id, cap, Number(e.target.value))}
                          placeholder="0"
                          style={{ width: 100, textAlign: "right" }}
                          aria-label={`${l.designName} pieces supplied now`}
                          disabled={saving}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
            Cut pieces come off cut stock; a full tile is recorded here only — write the opened box off on Stock Adjustments.
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">{fmt(total)} pcs going out</span>
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="hbtn primary" disabled={saving || total === 0} onClick={() => void submit()}>
            {saving ? <BoffoLoader size="sm" /> : <><Icon name="check" size={13} /> Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}
