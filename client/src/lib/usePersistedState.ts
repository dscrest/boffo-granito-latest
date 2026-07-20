/* ============================================================
   useState that survives a route change. List screens keep their filter /
   search / tab in local state; opening a record unmounts the list (sibling
   detail route), wiping that state, so navigating back lost the filter. Backing
   it with sessionStorage keeps it for the tab's lifetime and clears on close.
   ============================================================ */
import { useEffect, useState } from "react";

export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw != null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial; // corrupt/blocked storage → fall back to the default
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full/blocked — persistence is best-effort */
    }
  }, [key, value]);
  return [value, setValue];
}
