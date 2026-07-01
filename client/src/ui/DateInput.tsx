/* ============================================================
   DateInput — native <input type="date"> that opens its calendar on
   any click in the field, not just the calendar icon. (Native inputs
   only open the picker from the icon; clicking the text just focuses
   it.) showPicker() needs a user gesture; guarded for old browsers.
   ============================================================ */
import type { InputHTMLAttributes } from "react";

export function DateInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="date"
      {...props}
      onClick={(e) => {
        try {
          e.currentTarget.showPicker();
        } catch {
          /* showPicker unsupported — native icon still opens the picker */
        }
        props.onClick?.(e);
      }}
    />
  );
}
