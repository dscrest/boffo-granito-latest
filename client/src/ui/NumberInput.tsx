/* ============================================================
   NumberInput — the app-wide numeric field. Renders a text input
   (inputMode="decimal" → numeric keypad on mobile) but hard-restricts
   typing to digits and a single decimal point: no letters, no e/+/-,
   no negatives, no browser up/down spinners. Drop-in for the old
   <input type="number">: it sanitizes e.target.value BEFORE calling the
   caller's onChange, so existing `onChange={e => setX(e.target.value)}`
   handlers keep working unchanged.
   ============================================================ */
import type { InputHTMLAttributes } from "react";

// Keep digits + one dot; drop everything else, collapse extra dots.
export function sanitizeNumeric(v: string): string {
  return v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
}

export function NumberInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      inputMode="decimal"
      {...props}
      type="text"
      onChange={(e) => {
        const clean = sanitizeNumeric(e.target.value);
        if (clean !== e.target.value) e.target.value = clean;
        props.onChange?.(e);
      }}
    />
  );
}

// ponytail: one runnable check on the sanitizer, dev-only so it never ships.
if (import.meta.env?.DEV) {
  console.assert(sanitizeNumeric("1e-2a.3.4") === "12.34", "NumberInput: strips e/-/letters, one dot");
  console.assert(sanitizeNumeric("-5") === "5", "NumberInput: no negatives");
  console.assert(sanitizeNumeric("0.50") === "0.50", "NumberInput: keeps trailing decimals");
}
