/* ============================================================
   InfoTag — the house "(i)" (user mandate 2026-10-22): a cell shows a
   count or one short detail; the details open in a proper floating card,
   never an inline expansion row and never a list wrapped into the cell.
   Portaled + fixed (same anchoring as MoreMenu) so no overflow:clip card
   or table wrapper clips it; closes on outside click / Escape.
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export function InfoTag({ label, title, children, width = 320 }: { label?: ReactNode; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || cardRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const h = cardRef.current?.offsetHeight ?? 0;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
      setPos({ left, top });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, width]);

  return (
    <span ref={ref} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {label != null && <span>{label}</span>}
      <button type="button" className="btn x" style={{ width: 22, height: 22, padding: 0 }} title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="info" size={13} />
      </button>
      {open && createPortal(
        <div ref={cardRef} className="hdr-menu" role="dialog" aria-label={title} style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, zIndex: 1000, visibility: pos ? "visible" : "hidden" }}>
          <div className="hdr-menu-head">{title}</div>
          <div style={{ padding: "10px 12px", fontSize: "var(--t-sm)", display: "grid", gap: 6, maxHeight: 360, overflow: "auto" }}>{children}</div>
        </div>,
        document.body,
      )}
    </span>
  );
}
