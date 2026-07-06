/* ============================================================
   Notification popups — tiny module-level pub/sub, no context.

   Anywhere in the app:  toast.success("Saved"); toast.error(msg);
   <ToastHost/> (mounted once in App) renders centered popups
   ("proper pop up", user mandate 2026-07-04): success/info
   auto-dismiss after a few seconds, errors dim the screen and stay
   until closed. Click a popup (or its ✕) to dismiss.
   ============================================================ */
import { useEffect, useRef, useState } from "react";

export type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
}

let _id = 0;
const listeners = new Set<(t: ToastItem) => void>();

function push(msg: string, kind: ToastKind): void {
  const t = { id: ++_id, kind, msg };
  listeners.forEach((l) => l(t));
}

export const toast = {
  success: (msg: string) => push(msg, "success"),
  error: (msg: string) => push(msg, "error"),
  info: (msg: string) => push(msg, "info"),
};

const TOAST_MS = 3000;
const ICON: Record<ToastKind, string> = { success: "✓", error: "!", info: "i" };

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const add = (t: ToastItem) => {
      setItems((p) => [...p, t]);
      // Errors stay until the user closes them; success/info auto-dismiss.
      if (t.kind !== "error") {
        window.setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), TOAST_MS);
      }
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  const hasError = items.some((t) => t.kind === "error");

  // Errors dim the screen and block pointer input — take keyboard focus too
  // (✕ or Esc dismisses), then restore it where the user was.
  useEffect(() => {
    if (hasError) {
      if (!restoreRef.current) restoreRef.current = document.activeElement as HTMLElement | null;
      hostRef.current?.querySelector<HTMLButtonElement>(".toast.error .toast-x")?.focus();
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setItems((p) => p.filter((x) => x.kind !== "error"));
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    restoreRef.current?.focus();
    restoreRef.current = null;
  }, [hasError]);

  if (items.length === 0) return null;
  const dismiss = (id: number) => setItems((p) => p.filter((x) => x.id !== id));

  return (
    <div ref={hostRef} className={`toast-host${hasError ? " has-error" : ""}`} role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : undefined} onClick={() => dismiss(t.id)}>
          <span className="toast-ico" aria-hidden="true">{ICON[t.kind]}</span>
          <span className="toast-msg">{t.msg}</span>
          <button
            className="toast-x"
            title="Close"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
