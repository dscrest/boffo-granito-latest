/* ============================================================
   DateInput — styled replacement for <input type="date"> (the native
   popup can't be themed; house rule: no flat controls). Drop-in:
   value is "yyyy-MM-dd" or "", onChange fires {target:{value}} so
   existing `(e) => set(e.target.value)` call sites work unchanged.
   Shows dd/mm/yyyy, accepts typed dd/mm/yyyy (or d-m-yyyy) on
   blur/Enter. Popover is position:fixed and closes on outside
   mousedown / scroll, so it works inside modals and scroll
   containers and never exists in the DOM when closed.
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function toDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function parseDMY(s: string): string | null {
  const m = /^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$/.exec(s || "");
  if (!m) return null;
  const [d, mo, y] = [+m[1], +m[2], +m[3]];
  const dt = new Date(y, mo - 1, d); // local; never parse iso strings (UTC shift)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value?: string;
  min?: string;
  max?: string;
  onChange?: (e: { target: { value: string } }) => void;
};

export function DateInput({ value = "", onChange, min, max, style, disabled, ...rest }: DateInputProps) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null); // null = closed
  const [text, setText] = useState(toDMY(value));
  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setText(toDMY(value)); }, [value]);

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setPos(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", close, true); };
  }, [pos]);

  const emit = (iso: string) => onChange?.({ target: { value: iso } });
  const commitText = () => {
    if (text.trim() === "") { if (value) emit(""); return; }
    const iso = parseDMY(text);
    if (iso && (!min || iso >= min) && (!max || iso <= max)) emit(iso);
    else setText(toDMY(value)); // revert bad input
  };

  const openCal = () => {
    if (disabled || !ref.current) return;
    if (pos) return setPos(null);
    const m = /^(\d{4})-(\d{2})/.exec(value || "");
    setView(m ? { y: +m[1], m: +m[2] - 1 } : { y: now.getFullYear(), m: now.getMonth() });
    const r = ref.current.getBoundingClientRect();
    const below = r.bottom + 316 <= window.innerHeight;
    setPos({ left: Math.min(r.left, window.innerWidth - 268), top: below ? r.bottom + 4 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 4 });
  };

  const shift = (n: number) => setView((v) => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const pick = (iso: string) => { emit(iso); setPos(null); };

  // 6×7 grid starting Sunday; adjacent-month days included
  const first = new Date(view.y, view.m, 1);
  const start = new Date(view.y, view.m, 1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const todayIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate());

  const navBtn: CSSProperties = { border: "none", background: "none", cursor: "pointer", padding: 4, borderRadius: "var(--radius-sm)", color: "var(--muted)", display: "flex", alignItems: "center" };
  const sel: CSSProperties = { fontSize: 12, height: 24, padding: "0 20px 0 6px", backgroundPosition: "right 5px center" };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", width: style?.width }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => { if (e.key === "Enter") { commitText(); setPos(null); } if (e.key === "Escape") setPos(null); }}
        style={{ ...style, width: style?.width ? "100%" : style?.width, paddingRight: 28 }}
        {...rest}
      />
      <button
        type="button" tabIndex={-1} title="Pick date" disabled={disabled} onClick={openCal}
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: disabled ? "default" : "pointer", padding: 2, color: "var(--muted)", display: "flex" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>
      {pos && (
        <div style={{
          position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, zIndex: 1000,
          width: 260, padding: 12, background: "var(--panel)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)",
          fontSize: 13, color: "var(--fg)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <select value={view.m} onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))} style={sel}>
              {MONTHS.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
            <select value={view.y} onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))} style={sel}>
              {Array.from({ length: 21 }, (_, i) => now.getFullYear() - 10 + i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div style={{ flex: 1 }} />
            <button type="button" style={navBtn} onClick={() => shift(-1)} title="Previous month"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15,18 9,12 15,6" /></svg>
            </button>
            <button type="button" style={navBtn} onClick={() => shift(1)} title="Next month"
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--panel-2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6" /></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, textAlign: "center" }}>
            {DOW.map((d, i) => <div key={i} style={{ fontSize: 11, fontWeight: 600, color: "var(--dim)", padding: 4 }}>{d}</div>)}
            {days.map((d) => {
              const iso = isoOf(d.getFullYear(), d.getMonth(), d.getDate());
              const inMonth = d.getMonth() === view.m;
              const selected = iso === value;
              const out = Boolean((min && iso < min) || (max && iso > max));
              return (
                <button key={iso} type="button" disabled={out} onClick={() => pick(iso)} style={{
                  border: iso === todayIso && !selected ? "1px solid var(--accent)" : "1px solid transparent",
                  background: selected ? "var(--accent)" : "none",
                  color: selected ? "var(--accent-fg)" : out ? "var(--dim)" : inMonth ? "var(--fg)" : "var(--dim)",
                  borderRadius: "var(--radius-sm)", padding: "5px 0", cursor: out ? "default" : "pointer", fontSize: 13,
                  fontWeight: selected ? 600 : 400,
                }}
                  onMouseEnter={(e) => { if (!selected && !out) e.currentTarget.style.background = "var(--accent-soft)"; }}
                  onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "none"; }}
                >{d.getDate()}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <button type="button" style={{ ...navBtn, color: "var(--accent)", fontSize: 13, fontWeight: 500 }} onClick={() => pick("")}>Clear</button>
            <button type="button" style={{ ...navBtn, color: "var(--accent)", fontSize: 13, fontWeight: 500 }} onClick={() => pick(todayIso)}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
