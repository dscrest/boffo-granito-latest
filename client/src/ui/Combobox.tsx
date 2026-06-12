/* ============================================================
   Combobox — searchable single-select. Type to filter by label
   or hint (e.g. customer code). Click-outside closes. Used for the
   customer pickers in QuoteForm / OrderForm (Books-parity gap 10).
   Reuses shared CSS (.combo-*) and the native form-field <select>
   look so it drops into the existing form grids unchanged.
   ============================================================ */
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

/** Max options rendered in the popup; the rest hide behind "keep typing". */
const MAX_VISIBLE = 50;

export interface ComboOption {
  value: string;
  label: string;
  /** Secondary text shown dimmed + included in the filter (e.g. party code). */
  hint?: string;
}

export function Combobox({
  value,
  options,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  // Searches label, hint AND value (value will carry the SKU for item pickers).
  const hay = (o: ComboOption) => `${o.label} ${o.hint || ""} ${o.value}`.toLowerCase();
  const matches = needle ? options.filter((o) => hay(o).includes(needle)) : options;
  if (needle) {
    // Prefix matches first, so the list narrows toward what's being typed.
    matches.sort((a, b) => Number(hay(b).startsWith(needle)) - Number(hay(a).startsWith(needle)));
  }
  // Cap the popup — huge lists are unusable and slow; typing narrows further.
  const filtered = matches.slice(0, MAX_VISIBLE);
  const hidden = matches.length - filtered.length;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setQ("");
        setOpen(true);
        setActive(0);
        return;
      }
      if (filtered.length === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + delta + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      if (open && active >= 0 && active < filtered.length) {
        e.preventDefault();
        pick(filtered[active].value);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  return (
    <div className="combo" ref={ref}>
      <input
        className="combo-input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={open && active >= 0 ? `${listboxId}-opt-${active}` : undefined}
        value={open ? q : selected?.label || ""}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setQ("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="combo-pop" role="listbox" id={listboxId}>
          {filtered.length === 0 && <div className="combo-empty">No match</div>}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`combo-opt ${o.value === value ? "sel" : ""} ${i === active ? "active" : ""}`}
              // onMouseDown fires before the input blur, so the pick registers.
              onMouseDown={() => pick(o.value)}
            >
              <span>{o.label}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </div>
          ))}
          {hidden > 0 && (
            <div className="combo-empty">{hidden} more match{hidden > 1 ? "es" : ""} — keep typing to narrow</div>
          )}
        </div>
      )}
    </div>
  );
}
