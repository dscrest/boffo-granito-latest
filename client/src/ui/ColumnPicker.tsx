/* ============================================================
   ColumnPicker — reusable column show/hide + reorder control.
   A "Columns" button → dropdown of checkboxes with drag-to-reorder
   rows; BOTH the show/hide checkboxes and the new order are staged
   locally and committed together via Apply (Escape / click-outside
   discards). Apply-only is deliberate — do not revert to immediate.
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
    `defaultHidden` applies only on first load (no stored prefs yet).
    `D` lets callers pass richer defs (e.g. detail-page field defs) and get
    them back from `ordered`/`visible` without losing their extra props. */
export function useColumns<D extends ColumnDef>(storageKey: string, defs: D[], defaultHidden: string[] = []) {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => {
    const p = loadPrefs(storageKey);
    if (p.hidden.length === 0 && p.order.length === 0 && !localStorage.getItem(storageKey) && defaultHidden.length) {
      return { hidden: defaultHidden, order: [] };
    }
    return p;
  });

  const persist = (next: ColumnPrefs) => localStorage.setItem(storageKey, JSON.stringify(next));

  /* Stored order ∩ current defs, then any new defs appended in code order —
     schema drift (added/removed columns) never breaks saved prefs. */
  const ordered = useMemo(() => {
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const seen = new Set<string>();
    const out: D[] = [];
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

  /* Functional updaters so ColumnPicker can commit a batch of staged
     checkbox toggles + the new order together on Apply without lost updates. */
  const toggle = (key: string) =>
    setPrefs((p) => {
      const h = new Set(p.hidden);
      h.has(key) ? h.delete(key) : h.add(key);
      const next = { ...p, hidden: [...h] };
      persist(next);
      return next;
    });

  /** Apply a full display order (ColumnPicker's drag + Apply). */
  const move = (keys: string[]) =>
    setPrefs((p) => {
      const next = { ...p, order: keys };
      persist(next);
      return next;
    });

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
  onClear,
  label,
  icon = "columns",
  title = "Columns — show / hide / reorder",
}: {
  columns: ColumnDef[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  /** When provided, rows are drag-reorderable; Apply commits the staged order. */
  onMove?: (keys: string[]) => void;
  /** When provided, a "Clear" button resets to the empty/default selection. */
  onClear?: () => void;
  /** Optional text next to the icon (icon-only when omitted, as in grids). */
  label?: string;
  icon?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /* Order + hidden set are staged here while the menu is open; the parent's
     onMove/onToggle fire only on Apply (Apply-only mode = onMove present). */
  const [draft, setDraft] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  /* With an Apply button (onMove), checkbox changes stage into draftHidden and
     commit on Apply; without one, they toggle immediately as before. */
  const staged = !!onMove;

  const toggleOpen = () => {
    if (!open) {
      setDraft(columns.map((c) => c.key));
      setDraftHidden(new Set(hidden));
    }
    setDragKey(null);
    setOpen((v) => !v);
  };

  const toggleDraftHidden = (key: string) =>
    setDraftHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

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

  const byKey = new Map(columns.map((c) => [c.key, c]));
  const rows = onMove ? draft.map((k) => byKey.get(k)).filter((c): c is ColumnDef => !!c) : columns;
  const orderChanged = draft.join(" ") !== columns.map((c) => c.key).join(" ");
  const hiddenChanged =
    staged && (draftHidden.size !== hidden.size || [...draftHidden].some((k) => !hidden.has(k)));
  const dirty = onMove && (orderChanged || hiddenChanged);

  /* Commit staged hidden-set diff (batched via functional onToggle) + order. */
  const apply = () => {
    if (staged) columns.forEach((c) => draftHidden.has(c.key) !== hidden.has(c.key) && onToggle(c.key));
    onMove?.(draft);
    setOpen(false);
  };

  /* Live preview: as the dragged row passes over another, move it there. */
  const dragTo = (overKey: string) => {
    if (!dragKey || dragKey === overKey) return;
    setDraft((d) => {
      const from = d.indexOf(dragKey);
      const to = d.indexOf(overKey);
      if (from < 0 || to < 0) return d;
      const next = [...d];
      next.splice(from, 1);
      next.splice(to, 0, dragKey);
      return next;
    });
  };

  return (
    <div className="hdr-pop" ref={ref}>
      <button
        className="btn"
        onClick={toggleOpen}
        title={title}
        aria-label={title}
        style={label ? { gap: 6 } : undefined}
      >
        <Icon name={icon} size={14} />
        {label && <span>{label}</span>}
      </button>
      {open && (
        <div className="hdr-menu" style={{ width: onMove ? 236 : 200, padding: 6 }}>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {rows.map((c) => (
              <label
                key={c.key}
                className="row"
                draggable={!!onMove}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragKey(c.key);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  dragTo(c.key);
                }}
                onDragEnd={() => setDragKey(null)}
                style={{
                  gap: 8,
                  padding: "5px 8px",
                  cursor: "pointer",
                  borderRadius: 5,
                  opacity: dragKey === c.key ? 0.4 : 1,
                  background: dragKey === c.key ? "var(--hover)" : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={staged ? !draftHidden.has(c.key) : !hidden.has(c.key)}
                  onChange={() => (staged ? toggleDraftHidden(c.key) : onToggle(c.key))}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                {onMove && (
                  <span
                    aria-hidden
                    title={`Drag to reorder ${c.label}`}
                    style={{ cursor: "grab", color: "var(--dim)", fontSize: 13, letterSpacing: 1, userSelect: "none" }}
                  >
                    ⋮⋮
                  </span>
                )}
              </label>
            ))}
          </div>
          {(onMove || onClear) && (
            <div
              className="row"
              style={{ justifyContent: "flex-end", gap: 6, padding: "8px 4px 2px", borderTop: "1px solid var(--border)", marginTop: 6 }}
            >
              {onClear && (
                <button
                  className="btn"
                  style={{ marginRight: "auto" }}
                  onClick={() => {
                    onClear();
                    setOpen(false);
                  }}
                >
                  Clear
                </button>
              )}
              {onMove && (
                <button className="btn primary" disabled={!dirty} onClick={apply}>
                  Apply
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
