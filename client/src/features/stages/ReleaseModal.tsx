/* ============================================================
   Release (CR-361) / Discard (CR-369) — reverse palletization work for
   ONE line, with a quantity and a reason (mandatory for EVERY role since
   CR-369 — user decision 2026-10-22). The server decides the direction
   from the line itself:
     · loaded (Open box)   → boxes leave the container, back to Ready for Loading
     · palletized (no box) → boxes leave the palletization, back to FREE STOCK
                             (the order's allocation is returned)
     · planned / in palletization (no box) → "Discard": same as above
   Opened from the row's "+" menu on /packing, /palletizing, /palletized
   and /loading.
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { Note } from "@/ui/States";
import { toast } from "@/ui/Toast";
import { useModalA11y } from "@/ui/useModalA11y";
import { fmt } from "@/lib/format";
import { boxLabel, releasePalLine, type LoadBox, type PalPlanLine } from "./palPlansApi";

export function ReleaseModal({ line, box, onDone, onClose }: {
  line: PalPlanLine;
  /** The Open container the line sits in; absent = an un-boxed palletized line. */
  box?: LoadBox;
  onDone: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const [boxesDraft, setBoxesDraft] = useState(String(line.boxes));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const boxes = Math.floor(Number(boxesDraft) || 0);
  const boxesOk = boxes >= 1 && boxes <= line.boxes;
  const reasonOk = reason.trim().length > 0; // CR-369: every role
  const toStock = !box;
  const verb = !box && line.status !== "ReadyToLoad" ? "Discard" : "Release"; // CR-369

  const submit = async () => {
    if (!boxesOk || !reasonOk) { setShowErrors(true); return; }
    setBusy(true);
    const res = await releasePalLine(line.id, boxes, reason.trim());
    setBusy(false);
    if (!res.ok) { toast.error(res.error || "Could not release"); return; }
    toast.success(`${verb === "Discard" ? "Discarded" : "Released"} ${fmt(boxes)} boxes of ${line.itemCode} to ${toStock ? "free stock" : "Ready for Loading"}`);
    onDone();
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div ref={panelRef} role="dialog" aria-modal="true" className="modal-panel card df-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="package" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{verb} · {line.itemCode}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>

        <div className="df-body">
          <div style={{ marginBottom: 10 }}>
            <div className="design-name">{line.designLabel}</div>
            <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
              {[line.customerName, line.soNumber, line.batchNumber ? `Batch ${line.batchNumber}` : "", box ? boxLabel(box) : ""].filter(Boolean).join("  ·  ") || "—"}
            </div>
          </div>

          <div className="form-rows one">
            <label className="form-field">
              <span className="lbl">Boxes <span className="req">*</span></span>
              <NumberInput
                value={boxesDraft}
                onChange={(e) => setBoxesDraft(e.target.value)}
                className={showErrors && !boxesOk ? "error" : undefined}
                style={{ width: 120, textAlign: "right" }}
                aria-label={`Boxes to ${verb.toLowerCase()}`}
              />
            </label>
            <label className="form-field">
              <span className="lbl">Reason <span className="req">*</span></span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={showErrors && !reasonOk ? "error" : undefined}
                placeholder={`Why these boxes are ${verb === "Discard" ? "discarded" : "released"} (required)`}
                rows={2}
              />
            </label>
          </div>

          <Note style={{ marginTop: 10 }}>
            {toStock
              ? "Boxes leave this palletization and return to free stock; the order's allocation is returned."
              : `Boxes leave ${boxLabel(box!)} and return to Ready for Loading.`}
          </Note>
        </div>

        <div className="df-foot">
          <span className="df-req-note">
            {showErrors && !boxesOk ? <span className="field-err">Enter 1 to {fmt(line.boxes)} boxes</span>
              : showErrors && !reasonOk ? <span className="field-err">A reason is required</span>
              : `of ${fmt(line.boxes)} boxes`}
          </span>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="hbtn primary" disabled={busy} onClick={() => void submit()}>
            <Icon name="check" size={13} />
            {busy ? `${verb === "Discard" ? "Discarding" : "Releasing"}…` : verb}
          </button>
        </div>
      </div>
    </div>
  );
}
