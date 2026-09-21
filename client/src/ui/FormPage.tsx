/* ============================================================
   FormPage — the ONE shell for every create/edit form page
   (CR-219/220): page-head (title + sub) · the form's sections ·
   sticky footer (note, Cancel, Save). No modal, no ✕.

   useFormSave owns the two behaviours a page needs that a modal
   got for free from its parent: Save awaits the write and ignores a
   second click (no double create), and Cancel confirms only once
   the user has actually edited something (call touch() in setters).
   ============================================================ */
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { confirmDialog } from "@/ui/ConfirmDialog";

// ponytail: sidebar/back navigation away from a dirty form is unguarded (HashRouter has no useBlocker) — add a nav guard if drafts get lost.
export function useFormSave(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);
  return {
    busy,
    touch: () => {
      touched.current = true;
    },
    /** Runs `save` once; a failed save resolves too, leaving the form (and everything typed) on screen. */
    run: async (save: () => void | Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await save();
      } finally {
        setBusy(false);
      }
    },
    cancel: async () => {
      if (touched.current && !(await confirmDialog({ message: "Discard unsaved changes?", danger: true }))) return;
      onClose();
    },
  };
}

export function FormPage({
  title,
  sub,
  note,
  busy,
  saveDisabled,
  narrow,
  onCancel,
  onSave,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  /** Footer left slot: mandatory-field legend, validation error, live totals. */
  note?: ReactNode;
  busy?: boolean;
  saveDisabled?: boolean;
  /** Small forms: cap the width instead of stretching a few fields across the screen. */
  narrow?: boolean;
  onCancel: () => void;
  /** Omit to render no Save (e.g. while the record is loading / not found). */
  onSave?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`form-page${narrow ? " narrow" : ""}`}>
      <div className="page-head">
        <div>
          <div className="title">{title}</div>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
      </div>
      {children}
      <div className="session-foot">
        <span className="df-req-note">{note}</span>
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {onSave && (
          <button className="hbtn primary" onClick={onSave} disabled={busy || saveDisabled}>
            <Icon name="check" size={13} />
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
    </div>
  );
}
