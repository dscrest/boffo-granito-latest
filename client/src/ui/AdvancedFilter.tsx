/* ============================================================
   AdvancedFilter — Zoho-Books-style advanced search for grids.
   A magnifier button (with active-criteria count) opens a modal
   of label-left field rows; criteria AND together and AND with
   the grid's inline quick-search. Multi-value fields use a
   dropdown of checkboxes (Books-style), not inline boxes.
   Client-side only — pure applyFilters() runs over loaded rows.
   Session state: criteria live in the page's useState, not storage.
   ============================================================ */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { NumberInput } from "./NumberInput";

export type FilterFieldType = "text" | "select" | "multiselect" | "daterange" | "numrange";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FilterField<T = any> {
  key: string;
  label: string;
  type: FilterFieldType;
  /** select / multiselect choices (value doubles as label). */
  options?: string[];
  /** Raw row value: string for text/select/multiselect/daterange, number for numrange. */
  get: (row: T) => string | number;
}

export interface DateRange {
  from?: string;
  to?: string;
}
export interface NumRange {
  min?: string;
  max?: string;
}
/** key → active criterion; absent key = field not filtered. */
export type FilterCriteria = Record<string, string | string[] | DateRange | NumRange>;

const isBlank = (c: unknown): boolean => {
  if (c == null || c === "") return true;
  if (Array.isArray(c)) return c.length === 0;
  if (typeof c === "object") return Object.values(c).every((v) => !v);
  return false;
};

/** Count of criteria that actually constrain something (drives the button chip). */
export function activeCount(criteria: FilterCriteria): number {
  return Object.values(criteria).filter((c) => !isBlank(c)).length;
}

/** AND all active criteria over `rows`. Pure — usable in useMemo. */
export function applyFilters<T>(rows: T[], criteria: FilterCriteria, fields: FilterField<T>[]): T[] {
  const active = fields.filter((f) => !isBlank(criteria[f.key]));
  if (active.length === 0) return rows;
  return rows.filter((row) =>
    active.every((f) => {
      const c = criteria[f.key];
      const v = f.get(row);
      switch (f.type) {
        case "text":
          return String(v).toLowerCase().includes(String(c).toLowerCase());
        case "select":
          return String(v) === String(c);
        case "multiselect":
          return (c as string[]).includes(String(v));
        case "daterange": {
          const { from, to } = c as DateRange;
          const day = String(v).slice(0, 10); // Catalyst datetime → date prefix
          if (!day) return false;
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        }
        case "numrange": {
          const { min, max } = c as NumRange;
          const n = Number(v) || 0;
          if (min !== undefined && min !== "" && n < Number(min)) return false;
          if (max !== undefined && max !== "" && n > Number(max)) return false;
          return true;
        }
      }
    }),
  );
}

/* ---- Books-style multi-select: an input-look button opening a checkbox dropdown ---- */
function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // close the dropdown, not the modal
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={value.length ? value.join(", ") : `Select ${label.toLowerCase()}`}
        style={{
          width: "100%",
          height: 35,
          padding: "0 28px 0 11px",
          textAlign: "left",
          background: "var(--panel-2)",
          color: value.length ? "var(--fg)" : "var(--dim)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          fontSize: "var(--t-md)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          position: "relative",
        }}
      >
        {value.length ? value.join(", ") : `Select ${label.toLowerCase()}`}
        <Icon
          name="chev-r"
          size={11}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%) rotate(90deg)", color: "var(--dim)" }}
        />
      </button>
      {open && (
        <div className="hdr-menu" style={{ left: 0, right: 0, top: "calc(100% + 4px)", padding: 4, maxHeight: 200, overflowY: "auto" }}>
          {options.map((o) => (
            <label key={o} className="row" style={{ gap: 8, padding: "6px 8px", cursor: "pointer", fontWeight: 400, borderRadius: 6 }}>
              <input
                type="checkbox"
                checked={value.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
                /* .modal-panel input styles every input as a full-width text box — undo for checkboxes */
                style={{ width: 14, height: 14, flex: "0 0 auto", padding: 0, appearance: "auto" }}
              />
              <span>{o}</span>
            </label>
          ))}
          {options.length === 0 && <div className="dim" style={{ padding: "6px 8px" }}>No values</div>}
        </div>
      )}
    </div>
  );
}

/* ---- one field's input inside the modal ---- */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FilterField;
  value: FilterCriteria[string] | undefined;
  onChange: (v: FilterCriteria[string]) => void;
}) {
  switch (field.type) {
    case "text":
      return (
        <input
          type="text"
          value={(value as string) || ""}
          placeholder={`Contains…`}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <Combobox
          value={(value as string) || ""}
          options={[{ value: "", label: "" }, ...(field.options || []).map((o) => ({ value: o, label: o }))]}
          onChange={(v) => onChange(v)}
          placeholder={`Search ${field.label.toLowerCase()}…`}
        />
      );
    case "multiselect":
      return <MultiSelect label={field.label} options={field.options || []} value={(value as string[]) || []} onChange={onChange} />;
    case "daterange": {
      const r = (value as DateRange) || {};
      return (
        <div className="row" style={{ gap: 8 }}>
          <input type="date" value={r.from || ""} onChange={(e) => onChange({ ...r, from: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          <span className="dim" style={{ flex: "0 0 auto" }}>–</span>
          <input type="date" value={r.to || ""} onChange={(e) => onChange({ ...r, to: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
        </div>
      );
    }
    case "numrange": {
      const r = (value as NumRange) || {};
      return (
        <div className="row" style={{ gap: 8 }}>
          <NumberInput  value={r.min ?? ""} placeholder="Min" onChange={(e) => onChange({ ...r, min: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
          <span className="dim" style={{ flex: "0 0 auto" }}>–</span>
          <NumberInput  value={r.max ?? ""} placeholder="Max" onChange={(e) => onChange({ ...r, max: e.target.value })} style={{ flex: 1, minWidth: 0 }} />
        </div>
      );
    }
  }
}

/* Zoho-style row: right-aligned label on the left, control on the right. */
function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "132px 1fr", gap: 12, alignItems: "center" }}>
      <span className="muted" style={{ textAlign: "right", fontSize: "var(--t-md)" }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function FilterModal({
  title,
  fields,
  criteria,
  onApply,
  onClose,
}: {
  title: string;
  fields: FilterField[];
  criteria: FilterCriteria;
  onApply: (c: FilterCriteria) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<FilterCriteria>(criteria);
  const panelRef = useModalA11y(onClose);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel filter-modal" ref={panelRef} role="dialog" aria-modal="true" aria-label={`Search ${title}`} style={{ maxWidth: 900 }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <Icon name="search" size={14} />
          <span style={{ fontWeight: 600, fontSize: "var(--t-lg)" }}>Search {title}</span>
          <button className="btn x" onClick={onClose} title="Close" style={{ marginLeft: "auto" }}>
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", columnGap: 36, rowGap: 14 }}>
            {fields.map((f) => (
              <FieldRow key={f.key} label={f.label}>
                <FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
              </FieldRow>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              setDraft({});
              onApply({});
              onClose();
            }}
          >
            Clear
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onApply(draft);
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** Magnifier button + modal. Keep `criteria` in the page's state and filter
    rows with applyFilters() — see DesignMaster for the reference wiring. */
export function AdvancedFilterButton({
  title,
  fields,
  criteria,
  onChange,
}: {
  title: string;
  fields: FilterField[];
  criteria: FilterCriteria;
  onChange: (c: FilterCriteria) => void;
}) {
  const [open, setOpen] = useState(false);
  const n = activeCount(criteria);
  return (
    <>
      <button className={`btn${n > 0 ? " active" : ""}`} onClick={() => setOpen(true)} title={`Advanced search${n ? ` — ${n} active` : ""}`}>
        <Icon name="search" size={12} /> Search
        {n > 0 && <span className="chip" style={{ marginLeft: 4 }}>{n}</span>}
      </button>
      {open && (
        <FilterModal title={title} fields={fields} criteria={criteria} onApply={onChange} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
