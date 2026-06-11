/* ============================================================
   Toast notifications — tiny module-level pub/sub, no context.

   Anywhere in the app:  toast.success("Saved"); toast.error(msg);
   <ToastHost/> (mounted once in App) renders the stack bottom-right
   and auto-dismisses after a few seconds. Click a toast to dismiss.
   ============================================================ */
import { useEffect, useState } from "react";

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

const TOAST_MS = 4500;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (t: ToastItem) => {
      setItems((p) => [...p, t]);
      window.setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), TOAST_MS);
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind}`}
          onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}
