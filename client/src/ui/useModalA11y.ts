/* ============================================================
   useModalA11y — focus management for modal panels.
   Focuses the first focusable element on mount, traps Tab focus
   inside the panel, closes on Escape, and restores focus to the
   previously active element on unmount. SSR-safe.
   ============================================================ */
import { useEffect, useRef } from "react";

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function useModalA11y(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Last control that held focus *inside* the panel. When focus slips to
  // <body> (clicking empty modal space, or an element unmounting after a
  // Combobox pick), the next Tab resumes forward from here instead of
  // snapping back to the first field.
  const lastInside = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      panelRef.current
        ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            // FOCUSABLE's element clauses re-include natively-focusable controls
            // even when tabindex="-1" opts them out (close ✕, per-row remove,
            // line description) — honour it so they stay out of the Tab cycle.
            // offsetParent===null skips hidden controls (e.g. the inactive mode).
            (el) => el.tabIndex !== -1 && el.offsetParent !== null,
          )
        : [];

    focusables()[0]?.focus();

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (panelRef.current?.contains(t) && t.tabIndex !== -1) lastInside.current = t;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (els.length === 0) return;
      // Reference point = where focus is now (if still inside the panel),
      // else the last control that had focus inside it. Move to the nearest
      // tab stop *after* the reference in document order (before it, for
      // Shift+Tab) so movement is always forward — never a jump to the top.
      // Position-based (not index-of) so a reference that isn't itself a tab
      // stop (a tabindex=-1 textarea / read-only field) still steps correctly.
      const active = document.activeElement as HTMLElement | null;
      const cand = active && panelRef.current?.contains(active) ? active : lastInside.current;
      // Ignore a detached reference (a control that unmounted, e.g. a removed
      // line) — compareDocumentPosition is unreliable on disconnected nodes.
      const ref = cand && document.contains(cand) ? cand : null;
      e.preventDefault();
      let target: HTMLElement | undefined;
      if (e.shiftKey) {
        const before = ref
          ? els.filter((el) => ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
          : els;
        target = before.length ? before[before.length - 1] : els[els.length - 1];
      } else {
        const after = ref
          ? els.filter((el) => ref.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
          : els;
        target = after.length ? after[0] : els[0];
      }
      target?.focus();
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, []);

  return panelRef;
}
