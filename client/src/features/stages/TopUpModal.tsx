/* ============================================================
   Top-up dialog — fills an In-Palletization line's open pallet from a
   Ready-for-Palletization line of the SAME item (usually a different
   batch). One donor per confirm → POST /pal-topup: the moved boxes join
   the target's physical pallet under a shared pallet_group (Mix Batch),
   so Record Palletised later prints them as ONE combined pallet slip.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { fmt } from "@/lib/format";
import { useModalA11y } from "@/ui/useModalA11y";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import type { PalPlanLine } from "./palPlansApi";

export function TopUpModal({
  target,
  donors,
  busy,
  onConfirm,
  onClose,
}: {
  /** The In-Palletization line whose pallet is being topped up. */
  target: PalPlanLine;
  /** Same-item Ready-for-Palletization lines that can donate boxes. */
  donors: PalPlanLine[];
  busy: boolean;
  onConfirm: (donorLineId: string, boxes: number) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [pallets, setPallets] = useState<PalletRow[]>([]);
  const [donorId, setDonorId] = useState(donors.length === 1 ? donors[0].id : "");
  const [boxesDraft, setBoxesDraft] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let alive = true;
    void listPallets().then((r) => {
      if (alive && r.ok) setPallets(r.pallets);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Physical-pallet capacity (boxes_per_pallet, same as the Palletise dialog) —
  // the space left on the target's OPEN pallet is the natural top-up amount.
  const cap = pallets.find((p) => p.id === target.palletId)?.boxesPerPallet || 0;
  const space = cap > 0 ? (target.boxes % cap === 0 ? 0 : cap - (target.boxes % cap)) : 0;

  const donor = donors.find((d) => d.id === donorId);
  useEffect(() => {
    if (donor) setBoxesDraft(String(Math.min(donor.boxes, space || donor.boxes)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donorId, space]);

  const boxes = donor ? Math.min(Math.max(0, Math.floor(Number(boxesDraft) || 0)), donor.boxes) : 0;

  const submit = () => {
    if (!donor || boxes <= 0) {
      setShowErrors(true);
      return;
    }
    onConfirm(donor.id, boxes);
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 640 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>Top up pallet · {target.itemCode}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div style={{ marginBottom: 10 }}>
            <div className="design-name">{target.designLabel}</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {[target.customerName, target.soNumber, target.palletName].filter(Boolean).join("  ·  ") || "—"}
            </div>
            <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {target.batchNumber && (
                <span className="chip mono" style={{ fontSize: 13 }}>Batch {target.batchNumber}</span>
              )}
              <span className="chip" style={{ fontSize: 13 }}>{fmt(target.boxes)} box on pallet</span>
              {cap > 0 && (
                <span className="chip" style={{ fontSize: 13 }} title={`${fmt(cap)} boxes fill one ${target.palletName} pallet`}>
                  {space > 0 ? `${fmt(space)} box space on the open pallet` : "open pallet is full"}
                </span>
              )}
            </div>
          </div>

          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Item</th>
                <th>Batch</th>
                <th className="num" style={{ textAlign: "right" }}>Available</th>
                <th className="num" style={{ textAlign: "right" }}>Boxes to move</th>
              </tr>
            </thead>
            <tbody>
              {donors.map((d) => {
                const isSel = d.id === donorId;
                return (
                  <tr key={d.id} onClick={() => setDonorId(d.id)} style={{ cursor: "pointer", background: isSel ? "var(--accent-soft)" : undefined }}>
                    <td>
                      <input
                        type="radio"
                        name="topup-donor"
                        checked={isSel}
                        onChange={() => setDonorId(d.id)}
                        aria-label={`Top up from ${d.itemCode}`}
                        style={{ margin: 0 }}
                      />
                    </td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{d.itemCode}</span>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{d.soNumber || "—"}</div>
                    </td>
                    <td>
                      {d.batchNumber ? (
                        <span className="chip mono" style={{ fontSize: 13 }}>Batch {d.batchNumber}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td className="num">{fmt(d.boxes)}</td>
                    <td className="num">
                      {isSel ? (
                        <NumberInput
                          value={boxesDraft}
                          onChange={(e) => setBoxesDraft(e.target.value)}
                          placeholder="0"
                          style={{ width: 84, textAlign: "right" }}
                          aria-label="Boxes to top up"
                          className={showErrors && boxes <= 0 ? "error" : undefined}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && (!donor || boxes <= 0) ? (
              <span className="field-err">{!donor ? "Pick the item to top up from" : "Enter the boxes to move"}</span>
            ) : donor && boxes > 0 ? (
              `${fmt(boxes)} boxes → ${target.palletName || "the pallet"}${donor.batchNumber !== target.batchNumber ? " (mixed batches)" : ""}`
            ) : (
              "Pick an item and the boxes to move"
            )}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={submit}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : "Top up"}
          </button>
        </div>
      </div>
    </div>
  );
}
