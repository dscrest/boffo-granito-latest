/* ============================================================
   Combobox — searchable single-select. Type to filter by label
   or hint (e.g. customer code). Click-outside closes. Used for the
   customer pickers in QuoteForm / OrderForm (Books-parity gap 10).
   Reuses shared CSS (.combo-*) and the native form-field <select>
   look so it drops into the existing form grids unchanged.
   ============================================================ */
import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selected = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          (o.hint || "").toLowerCase().includes(needle),
      )
    : options;

  return (
    <div className="combo" ref={ref}>
      <input
        className="combo-input"
        value={open ? q : selected?.label || ""}
        placeholder={selected ? selected.label : placeholder}
        onFocus={() => {
          setQ("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="combo-pop">
          {filtered.length === 0 && <div className="combo-empty">No match</div>}
          {filtered.map((o) => (
            <div
              key={o.value}
              className={`combo-opt ${o.value === value ? "sel" : ""}`}
              // onMouseDown fires before the input blur, so the pick registers.
              onMouseDown={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
