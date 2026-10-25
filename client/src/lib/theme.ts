/* ============================================================
   Theme preference (CR-378, BOFFO Glass). Per-device, never server-side:
   localStorage "boffo.theme" ∈ dark | light | system (default dark).
   applyTheme() writes <html data-theme="dark|light">; the attribute only
   matters under the glass skin (data-skin="glass", set app-wide by main.tsx).
   Called once at module scope in main.tsx so the first paint is right; the
   rail user menu (CR-379) calls setThemePref().
   ============================================================ */
export type ThemePref = "dark" | "light" | "system";
const KEY = "boffo.theme";
const mq = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch {
    return "dark";
  }
}

export function resolveTheme(pref = getThemePref()): "dark" | "light" {
  return pref === "system" ? (mq.matches ? "dark" : "light") : pref;
}

export function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme();
}

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* best-effort */
  }
  applyTheme();
}

// System mode follows the OS live.
mq.addEventListener("change", applyTheme);
