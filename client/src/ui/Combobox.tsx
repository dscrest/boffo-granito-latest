/* ============================================================
   Combobox — searchable single-select. Type to filter by label
   or hint (e.g. customer code). Click-outside closes. Used for the
   customer pickers in QuoteForm / OrderForm (Books-parity gap 10).
   Reuses shared CSS (.combo-*) and the native form-field <select>
   look so it drops into the existing form grids unchanged.
   ============================================================ */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

/** Max options rendered in the popup; the rest hide behind "keep typing". */
const MAX_VISIBLE = 50;

export interface ComboOption {
  value: string;
  label: string;
  /** Secondary text shown dimmed + included in the filter (e.g. party code). */
  hint?: string;
  /** Small pill after the label (e.g. "2 of 5 items left"). Display-only, not filtered. */
  badge?: string;
}

export function Combobox({
  value,
  options,
  onChange,
  placeholder = "Search…",
  invalid = false,
  onCreate,
  className,
  ariaLabel,
  maxVisible = MAX_VISIBLE,
  clearable = true,
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Adds the `.error` class (red border) — drives required-field validation. */
  invalid?: boolean;
  /** When set, typing a value with no exact match offers a "Create …" row. */
  onCreate?: (label: string) => void;
  /** Extra class on the root (e.g. "dial" — narrow control, wide popup). */
  className?: string;
  ariaLabel?: string;
  /** Popup row cap; raise for short lists that should scroll in full. */
  maxVisible?: number;
  /** Show an X to reset the selection to "". On by default; pass false on a
      required field that must never be emptied (save-time `invalid` still
      guards the rest). */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  // Popup is portaled to <body> so no ancestor overflow (scrollable modals)
  // clips it; position is tracked from the control's viewport rect.
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Track the control's viewport position while open (scroll/resize follow it).
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  // Normalize away separator noise (- · / , and runs of space) so a name typed
  // with hyphens matches a haystack built with middle-dots (e.g. item picker).
  const norm = (s: string) => s.toLowerCase().replace(/[-·/,]+/g, " ").replace(/\s+/g, " ").trim();
  const needle = norm(q);
  const tokens = needle ? needle.split(" ") : [];
  // Searches label, hint AND value (value will carry the SKU for item pickers).
  const hay = (o: ComboOption) => norm(`${o.label} ${o.hint || ""} ${o.value}`);
  // Token match: every typed word must appear (order-independent), not one run.
  const matches = tokens.length
    ? options.filter((o) => { const h = hay(o); return tokens.every((t) => h.includes(t)); })
    : options;
  if (needle) {
    // Prefix matches first, so the list narrows toward what's being typed.
    matches.sort((a, b) => Number(hay(b).startsWith(needle)) - Number(hay(a).startsWith(needle)));
  }
  // Cap the popup — huge lists are unusable and slow; typing narrows further.
  const filtered = matches.slice(0, maxVisible);
  const hidden = matches.length - filtered.length;

  // "Create …" row appears when typed text matches no option exactly.
  const canCreate = !!onCreate && !!needle && !options.some((o) => norm(o.label) === needle);
  const navLen = filtered.length + (canCreate ? 1 : 0);

  /** After a pick, move focus to the next form control (Books-style) so
      typing can continue — e.g. customer → quote date, line item → qty.
      Skips textareas (the optional description box) on purpose. */
  const focusNext = () => {
    const input = ref.current?.querySelector("input");
    if (!input) return;
    const scope = ref.current?.closest<HTMLElement>("[role=dialog]") ?? document.body;
    const els = [...scope.querySelectorAll<HTMLElement>("input, select, button")].filter(
      (el) => !(el as HTMLInputElement).disabled && el.tabIndex !== -1 && el.offsetParent !== null,
    );
    const i = els.indexOf(input);
    if (i >= 0) els[i + 1]?.focus();
  };

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
    focusNext();
  };

  const showClear = clearable && !!value;
  const clear = () => {
    onChange("");
    setQ("");
    setActive(-1);
    ref.current?.querySelector("input")?.focus();
  };

  const doCreate = () => {
    onCreate!(q.trim());
    setOpen(false);
    setActive(-1);
    focusNext();
  };

  /** Select the arrow-highlighted row (option or the "Create …" row). */
  const pickActive = () => {
    if (active < filtered.length) pick(filtered[active].value);
    else doCreate();
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
      if (navLen === 0) return;
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + delta + navLen) % navLen);
    } else if (e.key === "Enter" || e.key === " ") {
      // Space selects only after arrow navigation highlighted a row
      // (typing resets `active` to -1, so a mid-word space still types).
      if (open && active >= 0 && active < navLen) {
        e.preventDefault();
        pickActive();
      } else if (e.key === "Enter" && open && active < 0 && needle) {
        // Enter on typed text commits without arrow-navigating: create it when
        // it's new, otherwise pick the top match. (No-op when nothing's typed.)
        e.preventDefault();
        if (canCreate) doCreate();
        else if (filtered.length > 0) pick(filtered[0].value);
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
    <div className={`combo${className ? ` ${className}` : ""}${showClear ? " has-clear" : ""}`} ref={ref}>
      <input
        className={invalid ? "combo-input error" : "combo-input"}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={open && active >= 0 ? `${listboxId}-opt-${active}` : undefined}
        value={open ? q : selected?.label || ""}
        placeholder={selected ? selected.label : placeholder}
        // Clear the query on focus but DON'T open — else the modal's mount
        // auto-focus pops the popup open before any interaction. A click,
        // typing, or ArrowDown opens it.
        onFocus={() => setQ("")}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        // Tab (or any focus move) closes the popup; option rows preventDefault
        // on mousedown, so a mouse pick never blurs the input mid-click.
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      {showClear && (
        <button
          type="button"
          className="combo-clear"
          aria-label="Clear selection"
          tabIndex={-1}
          // mousedown (before the input blur) so the pick/close race is avoided.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            clear();
          }}
        >
          ×
        </button>
      )}
      {open && rect && createPortal(
        <div
          className="combo-pop"
          role="listbox"
          id={listboxId}
          ref={popRef}
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width }}
        >
          {filtered.length === 0 && !canCreate && <div className="combo-empty">No match</div>}
          {filtered.map((o, i) => (
            <div
              // value alone can repeat (e.g. dial codes +1 USA / +1 Canada)
              key={`${o.value} ${o.hint ?? ""}`}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`combo-opt ${o.value === value ? "sel" : ""} ${i === active ? "active" : ""}`}
              // onMouseDown fires before the input blur; preventDefault keeps
              // focus in the form so tab order survives a mouse pick.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.value);
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {o.label}
                {o.badge && <span className="chip qstatus q-partial">{o.badge}</span>}
              </span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </div>
          ))}
          {canCreate && (
            <div
              id={`${listboxId}-opt-${filtered.length}`}
              role="option"
              aria-selected={false}
              className={`combo-opt ${active === filtered.length ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                doCreate();
              }}
            >
              <span>Create “{q.trim()}”</span>
            </div>
          )}
          {hidden > 0 && (
            <div className="combo-empty">{hidden} more match{hidden > 1 ? "es" : ""} — keep typing to narrow</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
