/* ============================================================
   ColumnPicker — reusable show/hide-columns control.
   A "Columns" button → dropdown of checkboxes. Hidden-column
   state is persisted per table in localStorage.
   Reuses the .hdr-menu dropdown styles.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";

export interface ColumnDef {
  key: string;
  label: string;
}

/** Persisted set of hidden column keys for a table. */
export function useHiddenColumns(storageKey: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      return next;
    });
  };
  /** True when a column should render. */
  const show = (key: string) => !hidden.has(key);
  return { hidden, toggle, show };
}

export function ColumnPicker({
  columns,
  hidden,
  onToggle,
}: {
  columns: ColumnDef[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="hdr-pop" ref={ref}>
      <button className="btn" onClick={() => setOpen((v) => !v)} title="Show / hide columns">
        <Icon name="settings" size={12} /> Columns
      </button>
      {open && (
        <div className="hdr-menu" style={{ width: 200, padding: 6, maxHeight: 320, overflow: "auto" }}>
          {columns.map((c) => (
            <label key={c.key} className="row" style={{ gap: 8, padding: "5px 8px", cursor: "pointer" }}>
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
