/* ============================================================
   Imperative confirm modal — mirrors Toast's module-level pub/sub.

   Anywhere in the app:
     if (!(await confirmDialog({ message: "Delete this?", danger: true }))) return;

   <ConfirmHost/> (mounted once in App) renders the designed modal.
   Enter = confirm, Esc / backdrop / Cancel = dismiss. Falls back to the
   native confirm() only if the host isn't mounted (should never happen).
   ============================================================ */
import { useEffect, useState } from "react";

export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface Req extends ConfirmOpts {
  id: number;
  resolve: (ok: boolean) => void;
}

let _id = 0;
const listeners = new Set<(r: Req) => void>();

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (listeners.size === 0) {
      // Host not mounted — degrade to native rather than hang.
      resolve(window.confirm(opts.message));
      return;
    }
    const r: Req = { id: ++_id, resolve, ...opts };
    listeners.forEach((l) => l(r));
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);

  useEffect(() => {
    // One at a time: ignore new requests while a dialog is already open.
    const add = (r: Req) => setReq((cur) => cur ?? r);
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        req.resolve(false);
        setReq(null);
      } else if (e.key === "Enter") {
        req.resolve(true);
        setReq(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 200, alignItems: "center" }}
      onMouseDown={(e) => e.target === e.currentTarget && done(false)}
    >
      <div className="modal-panel confirm-modal" role="alertdialog" aria-modal="true" aria-label={req.title || "Confirm"}>
        <div className="confirm-head">
          <span className={`confirm-ico${req.danger ? " danger" : ""}`} aria-hidden="true">
            {req.danger ? "!" : "?"}
          </span>
          <span className="confirm-ttl">{req.title || (req.danger ? "Delete" : "Confirm")}</span>
        </div>
        <div className="confirm-msg">{req.message}</div>
        <div className="confirm-foot">
          <button className="btn" onClick={() => done(false)}>
            {req.cancelLabel || "Cancel"}
          </button>
          <button className={`hbtn ${req.danger ? "danger" : "primary"}`} onClick={() => done(true)} autoFocus>
            {req.confirmLabel || (req.danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
