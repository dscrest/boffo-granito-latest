/* ============================================================
   ColumnPicker — reusable column show/hide + reorder control.
   A "Columns" button → dropdown of checkboxes with ↑/↓ movers.
   Hidden set AND column order persist per table in localStorage
   (same key; legacy plain-array values migrate as the hidden set).
   Reuses the .hdr-menu dropdown styles.
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ColumnDef<T = any> {
  key: string;
  label: string;
  /** Cell renderer — required for data-driven grids (ordered rendering). */
  render?: (row: T) => ReactNode;
  /** td className (e.g. "num mono") and shared th/td style (e.g. right-align). */
  className?: string;
  style?: CSSProperties;
  /** Set false for columns that shouldn't offer header sorting. */
  sortable?: boolean;
}

interface ColumnPrefs {
  hidden: string[];
  order: string[];
}

function loadPrefs(storageKey: string): ColumnPrefs {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { hidden: [], order: [] };
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return { hidden: v.map(String), order: [] }; // legacy: hidden-only array
    return { hidden: (v.hidden || []).map(String), order: (v.order || []).map(String) };
  } catch {
    return { hidden: [], order: [] };
  }
}

/** Show/hide + reorder state for a grid's columns, persisted per table.
    `defaultHidden` applies only on first load (no stored prefs yet). */
export function useColumns<T>(storageKey: string, defs: ColumnDef<T>[], defaultHidden: string[] = []) {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => {
    const p = loadPrefs(storageKey);
    if (p.hidden.length === 0 && p.order.length === 0 && !localStorage.getItem(storageKey) && defaultHidden.length) {
      return { hidden: defaultHidden, order: [] };
    }
    return p;
  });

  const save = (next: ColumnPrefs) => {
    setPrefs(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };

  /* Stored order ∩ current defs, then any new defs appended in code order —
     schema drift (added/removed columns) never breaks saved prefs. */
  const ordered = useMemo(() => {
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const seen = new Set<string>();
    const out: ColumnDef<T>[] = [];
    for (const k of prefs.order) {
      const d = byKey.get(k);
      if (d && !seen.has(k)) {
        out.push(d);
        seen.add(k);
      }
    }
    for (const d of defs) if (!seen.has(d.key)) out.push(d);
    return out;
  }, [defs, prefs.order]);

  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden]);
  const visible = useMemo(() => ordered.filter((c) => !hidden.has(c.key)), [ordered, hidden]);

  const toggle = (key: string) => {
    const h = new Set(prefs.hidden);
    h.has(key) ? h.delete(key) : h.add(key);
    save({ ...prefs, hidden: [...h] });
  };

  /** Move a column up (-1) or down (+1) in the display order. */
  const move = (key: string, delta: -1 | 1) => {
    const keys = ordered.map((c) => c.key);
    const i = keys.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    save({ ...prefs, order: keys });
  };

  const show = (key: string) => !hidden.has(key);
  return { ordered, visible, hidden, toggle, move, show };
}

/** Legacy hook — hidden set only. Prefer useColumns for new/converted grids. */
export function useHiddenColumns(storageKey: string) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadPrefs(storageKey).hidden));
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
  onMove,
}: {
  columns: ColumnDef[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  /** When provided, each row gets ↑/↓ reorder buttons. */
  onMove?: (key: string, delta: -1 | 1) => void;
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

  const mover = (c: ColumnDef, delta: -1 | 1, disabled: boolean, glyph: string, label: string) => (
    <button
      type="button"
      className="btn"
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        onMove?.(c.key, delta);
      }}
      title={`${label} ${c.label}`}
      aria-label={`${label} ${c.label}`}
      style={{ padding: "0 5px", lineHeight: "16px", fontSize: 10, opacity: disabled ? 0.35 : 1 }}
    >
      {glyph}
    </button>
  );

  return (
    <div className="hdr-pop" ref={ref}>
      <button
        className="btn"
        onClick={() => setOpen((v) => !v)}
        title="Columns — show / hide / reorder"
        aria-label="Columns — show / hide / reorder"
      >
        <Icon name="columns" size={14} />
      </button>
      {open && (
        <div className="hdr-menu" style={{ width: onMove ? 236 : 200, padding: 6, maxHeight: 320, overflow: "auto" }}>
          {columns.map((c, i) => (
            <label key={c.key} className="row" style={{ gap: 8, padding: "5px 8px", cursor: "pointer" }}>
              <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => onToggle(c.key)} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
              {onMove && (
                <span className="row" style={{ gap: 2 }}>
                  {mover(c, -1, i === 0, "↑", "Move up")}
                  {mover(c, 1, i === columns.length - 1, "↓", "Move down")}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
