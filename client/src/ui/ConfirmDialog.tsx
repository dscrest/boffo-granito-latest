/* ============================================================
   Imperative confirm / prompt modal — mirrors Toast's module-level pub/sub.

   Confirm (boolean):
     if (!(await confirmDialog({ message: "Are you sure you want to delete X?", danger: true }))) return;

   Prompt (string | null) — same designed modal, with a text field. Used for
   the reject-reason ask so it matches the delete confirm instead of a native
   window.prompt:
     const reason = await promptDialog({ title: "Reject", message: "Reason for rejecting SO-123",
                                         confirmLabel: "Reject", danger: true, required: true });
     if (reason == null) return; // cancelled

   Message convention for destructive actions: always
     "Are you sure you want to delete <subject>? This cannot be undone."
   Name the subject (record no., item name, or "N selected rows") — a
   generic "delete this?" hides which row is about to go, which is exactly
   what the confirm exists to prevent.

   <ConfirmHost/> (mounted once in App) renders the designed modal.
   Enter = confirm, Esc / backdrop / Cancel = dismiss. Falls back to the
   native confirm()/prompt() only if the host isn't mounted (should never happen).
   ============================================================ */
import { useEffect, useState } from "react";

export interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PromptOpts extends ConfirmOpts {
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}
interface Req extends PromptOpts {
  id: number;
  kind: "confirm" | "prompt";
  resolve: (v: boolean | string | null) => void;
}

let _id = 0;
const listeners = new Set<(r: Req) => void>();

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (listeners.size === 0) {
      resolve(window.confirm(opts.message));
      return;
    }
    const r: Req = { id: ++_id, kind: "confirm", resolve: (v) => resolve(v === true), ...opts };
    listeners.forEach((l) => l(r));
  });
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    if (listeners.size === 0) {
      resolve(window.prompt(opts.message, opts.defaultValue ?? ""));
      return;
    }
    const r: Req = {
      id: ++_id,
      kind: "prompt",
      resolve: (v) => resolve(typeof v === "string" ? v : null),
      ...opts,
    };
    listeners.forEach((l) => l(r));
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    // One at a time: ignore new requests while a dialog is already open.
    const add = (r: Req) => setReq((cur) => cur ?? r);
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  // Seed the input when a prompt opens.
  useEffect(() => {
    if (req?.kind === "prompt") setText(req.defaultValue ?? "");
  }, [req]);

  const isPrompt = req?.kind === "prompt";
  const blocked = isPrompt && req?.required === true && text.trim() === "";

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        req.resolve(isPrompt ? null : false);
        setReq(null);
      } else if (e.key === "Enter" && !blocked) {
        req.resolve(isPrompt ? text.trim() : true);
        setReq(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, isPrompt, blocked, text]);

  if (!req) return null;
  const cancel = () => {
    req.resolve(isPrompt ? null : false);
    setReq(null);
  };
  const confirm = () => {
    if (blocked) return;
    req.resolve(isPrompt ? text.trim() : true);
    setReq(null);
  };

  return (
    <div
      className="modal-backdrop"
      style={{ zIndex: 200, alignItems: "center" }}
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
    >
      <div className="modal-panel card confirm-modal" role="alertdialog" aria-modal="true" aria-label={req.title || "Confirm"}>
        <div className="confirm-head">
          <span className={`confirm-ico${req.danger ? " danger" : ""}`} aria-hidden="true">
            {req.danger ? "!" : "?"}
          </span>
          <span className="confirm-ttl">{req.title || (req.danger ? "Delete" : "Confirm")}</span>
        </div>
        <div className="confirm-msg">
          {req.message}
          {isPrompt && (
            <input
              type="text"
              autoFocus
              value={text}
              placeholder={req.placeholder}
              onChange={(e) => setText(e.target.value)}
              style={{ marginTop: 10, width: "100%" }}
            />
          )}
        </div>
        <div className="confirm-foot">
          <button className="btn" onClick={cancel}>
            {req.cancelLabel || "Cancel"}
          </button>
          <button className={`hbtn ${req.danger ? "danger" : "primary"}`} onClick={confirm} disabled={blocked} autoFocus={!isPrompt}>
            {req.confirmLabel || (req.danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
