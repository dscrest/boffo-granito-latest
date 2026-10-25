# Design System — "BOFFO Glass" (CR-378, 2026-10-22)

**Owner file: `client/src/styles/glass.css`.** This document explains; it never restates a value. If a
number here and the CSS disagree, the CSS is right — fix the doc. Portable: paste sections 1–10 into the
agent building another app and swap the two `⬅ SWAP` items (brand accent, wallpaper).

**Status: app-wide** (same day — the three-area trial lasted one review). `main.tsx` sets
`<html data-skin="glass">` before the first paint; print sheets and the login screen keep their own palettes.
Removing the attribute restores the slate/indigo base (`theme.css`, `DESIGN-SYSTEM-PROMPT.md` lineage).

**Concept** (from the Pane + Kairo references): a soft wallpaper, a floating dark rail, a transparent
toolbar with a search pill, translucent cards with an inner rim and a deep shadow, pill-shaped controls,
a "lens" highlight for whatever is selected, tinted pills for status, display-font titles and stat values.
Dark by default; light and system are one header click away.

---

## 1. Mechanics

- `<html data-skin="glass">` turns the skin on. `main.tsx` sets it at module scope before `createRoot`;
  every rule in `glass.css` is prefixed `[data-skin="glass"]`.
- `<html data-theme="dark|light">` picks the palette. `lib/theme.ts`: preference in `localStorage["boffo.theme"]`
  (`dark` | `light` | `system`, default **dark**), `system` follows `prefers-color-scheme` live, `applyTheme()`
  runs at module scope in `main.tsx` so the first paint is already right. The rail user menu (CR-379,
  `.rail-user` at the bottom of the sidebar) offers Light / Dark / Match system with a ✓ on the current one.
- **Cascade rule:** `[data-skin="glass"]` counts as a class and `glass.css` loads last, so prefixing the
  existing selector verbatim always wins its `styles.css` / `theme.css` twin. No `!important`, no `@layer`.
- **Re-theme by tokens, not by rules.** `theme.css` aliases every legacy name (`--panel`, `--fg`, `--muted`,
  `--hover`, `--c-*`…) to a short list of primaries; `glass.css` overrides only those primaries (`--bg`,
  `--bg-card`, `--bg-secondary`, `--border*`, `--text-*`, `--accent*`, `--blue*`, `--ok/--warn/--danger*`,
  `--radius-*`, `--shadow-*`) plus the rail tokens (`--sidebar-bg`, `--sb-*`) and `--sidebar-w`/`--header-h`.
  ~3 000 existing rules re-theme without edits; component rules exist only for glass-specific geometry.

## 2. Tokens (`--g-*`, defined per theme on `[data-skin="glass"][data-theme=…]`)

| Group | Tokens | Rule |
|---|---|---|
| Page | `--g-bg`, wallpaper `--g-wall-a/-b/-c/-d` | `body::before` paints the fixed wallpaper (base gradient + two radial blobs). ⬅ SWAP the blobs for a brand mood |
| Text | `--g-text`, `--g-text-2` (72 %), `--g-text-3` (55 %) | body · labels/td · hints, placeholders, eyebrow-strength |
| Glass | `--g-glass` (cards) · `--g-glass-chrome` · `--g-glass-thick` (popovers, modals, sticky heads, footer) · `--g-glass-solid` (toasts, reduced-transparency fallback) | translucency steps from "sits on the wallpaper" to "sits on moving content" |
| Rim + depth | `--g-rim-hi/-mid/-lo`, `--g-depth`, `--g-shadow`, `--g-shadow-lift` | every glass surface = tint + 1px `--g-rim-lo` border + `--g-depth` inset + `--g-shadow`; popovers lift |
| Fill | `--g-fill`, `--g-fill-2`, `--g-fill-hover` | inputs, quiet buttons, badges, seg tracks, hover rows |
| Hairline | `--g-sep` | the only border colour inside glass |
| Lens | `--g-lens`, `--g-lens-glow` | the selected state, everywhere (nav item, seg button, settings group, `.btn.active`) |
| Accent | `--g-accent`, `--g-accent-ink`, `--g-accent-soft` | fills · accent-coloured text/links · selected tint + focus ring. ⬅ SWAP (indigo today, matches the accepted system) |
| Hues | `--g-blue/-purple/-pink/-orange/-green/-teal/-yellow/-danger` | status + identity tints; dark values are bright, light values are darkened to read on white |
| Rail | `--g-rail`, `--g-rail-text/-2/-3`, `--g-rail-fill/-2`, `--g-rail-sep`, `--g-rail-lens/-glow` | the sidebar stays **dark in both themes** (the logo needs a dark ground, as Kairo does); the light block overrides `--g-rail` to `rgb(12 13 20 / .94)` (CR-423) because `.82` reads grey over the pale wallpaper; it also lifts `--g-rail-text-2/-3` to `rgb(245 246 252 / .88)` / `.64` (CR-435) so menu labels and group titles read white, not grey, on that darker rail |
| Geometry | `--g-r-xl` 28 · `--g-r-lg` 22 · `--g-r-md` 16 · `--g-r-sm` 12 · `--g-r-pill` | rail/modals · cards · tiles, popovers · inputs · buttons, chips, seg |
| Blur | `--g-blur`, `--g-blur-thick`, `--g-sat` | see the glass budget below |
| Motion | `--g-ease` (`cubic-bezier(.22,.8,.24,1)`) | 200 ms hover/selection transitions; none under `prefers-reduced-motion` |
| Tint | `--g-tint` | chip / stage background strength (16 % dark, 14 % light) |

**Glass budget.** `backdrop-filter` only where content moves underneath: sticky `.tbl th`, the floating
`.grid-footer`, `.hdr-menu`, search results, `.combo-pop`, modal backdrop + panels, the sticky form footer.
Never on `.card`, `.main` or `.app` — a filter there becomes the containing block of the fixed grid footer and
`overflow: clip` slices it. Cards, tiles and the rail get the glass look from tint + rim + depth alone (nothing
scrolls under them, so blur would be invisible GPU cost). `prefers-reduced-transparency` → every glass token
becomes `--g-glass-solid` and every blur is dropped.

## 3. Typography

No new families: `--font` Inter (body 13px / 1.45), `--font-display` Space Grotesk (page titles
`clamp(26px, 1.4vw + 14px, 36px)` / 700 / −.03em; card titles 14/600; stat values 24/700 tabular),
`--font-mono` JetBrains Mono (codes, counts, `.num`). Self-hosted from `public/fonts`; never hotlink.
Table heads are 12/600 `--g-text-3`, sentence case, no letter-spacing (Kairo), not the uppercase house head.

## 4. Shell

- **Wallpaper** `body::before` fixed, z −1, no animation.
- **Rail** `.app > .sidebar` floats (`margin: 14px 0 14px 14px`, radius `--g-r-xl`, `--g-rail`); grid unchanged
  (`--sidebar-w` 246 = 232 + inset; collapsed 74). Items are 36px pills; active = rail lens, no left bar; counts
  are mono pills. **Foot = the user chip** (CR-379) `.rail-user-chip`: `--g-rail-fill` tile, radius `--g-r-md`,
  `.av.lg` initials + `.presence.online` dot, name / role, ⌄; hover `--g-rail-fill-2`. Its menu `.rail-menu`
  (an `.hdr-menu`, radius `--g-r-lg`, 8px padding) opens **above** the chip; rows are label-left, icon or ✓
  right (`.tail`, ✓ in `--g-accent-ink`), `.hdr-menu-sep` hairlines, `.danger` row in `--g-danger`. The nav
  (`.sidebar > .group`) is the scroller, so the chip never moves. Logo untouched.
- **Toolbar** `.header` transparent, no border; search = 40px pill with the ⌘K chip; bell = 38px circle
  (gear, theme and avatar moved into the rail user menu, CR-379).
- **Grid footer** floats (`left: var(--sidebar-w) + 18px`, radius `--g-r-lg`, `--g-glass-thick` + blur);
  `.main:has(.grid-footer)::after` reserves 78px.
- **Popovers** (`.hdr-menu`, search results, `.combo-pop`): `--g-glass-thick` + thick blur, radius `--g-r-md`,
  6px padding, 10px-radius items. **Modals**: radius `--g-r-xl`, transparent head/foot with hairlines, gel icon
  tile. **Toasts**: opaque `--g-glass-solid` (user mandate 2026-07-20), bottom-right.

## 5. Controls — one aesthetic

| Control | Glass treatment |
|---|---|
| `.btn` / `.hbtn` | 32px pill, 12.5/600, `--g-fill`, inner 1px rim; hover `--g-fill-2`. `.primary` = accent **gel** (top highlight gradient over the accent, inset rim, soft glow, white text) — exactly ONE per view. `.danger` = same gel on `--g-danger`. `.active` = lens. `.btn.x` / `.pc-ibtn` = 32px circle. Toolbar / footer / in-cell = 30px |
| inputs, select, textarea, `.combo-input` | 34px, `--g-fill`, radius `--g-r-sm`, no border, inner rim; hover `--g-fill-2`; focus = 3px `--g-accent-soft` ring; error = inset danger rim. Search boxes, toolbar selects and the pager size are 30px pills; `.set-search` 36px |
| `.seg` + `.seg-btn(.on)` + `.badge` | pill track `--g-fill` with 26px pill buttons; `.on` = lens; the `.badge` count is a mono pill (Customers: All / Active / Inactive) |
| `input.switch` | 40×24 iOS switch (`appearance: none`), accent when checked |
| `.card` | `--g-glass` + rim + depth + shadow, radius `--g-r-lg`; `.card-head` hairline, display-font title |
| `.kpi`, `.stage-tile` | same glass, radius `--g-r-md`; label 12/600 text-3; value 24/700 display |
| `.tbl` | `th` sticky on `--g-glass-thick` + blur, 12/600 text-3; `td` 9×12 padding, `--g-sep` rules only; hover `--g-fill-hover`; `tr.sel` accent tint + 2px accent bar |
| `.fbar` | lives **inside** the grid card (Kairo): transparent, bottom hairline, 30px pill controls |
| `.ident` + `.ini.hue-N` + `.ident-text` | initials tile (32px, radius 10, hue 18 % tint + 28 % rim) beside name 600 / mono code 11.5 text-3. Hue = name hash mod 6 |
| `.nd-chip.tone-*` (`ui/Chip`) | 22px pill, text = tone, bg = tone at `--g-tint`; dark tones are lightened in glass.css — never hex in TSX |
| `.chip`, `.pill`, `.stage.<color>`, `.prio.<level>`, `.badge` | all pills; `.stage` and `.prio` tint from `currentColor` / their hue |
| `.dot`, `.live-dot`, `.presence.online/away/busy` | 7px dots; live/online carry a 3px halo |
| `.av`, `.av.lg`, `.av-stack` | gradient initials circles with a rim |
| `.set-wrap/.set-rail/.set-group/.set-card` | wrap = glass card radius `--g-r-xl`; rail transparent + right hairline; groups are 38px pills (active = lens); cards are `--g-fill` tiles that lift on hover |
| `.form-section`, `.dtabs`, `.session-foot` | fill + hairline sections; tabs underline in accent; sticky footer on `--g-glass-thick` + blur |
| `.linkish`, `.main a` | `--g-accent-ink`, underline on hover only |

## 6. Selected / hover

One "chosen" treatment everywhere = the **lens** (`--g-lens` gradient + `--g-lens-glow`): nav item, seg
button, settings group, `.btn.active`, toolbar toggles. Hover is always a quiet fill (`--g-fill-hover` /
`--g-fill-2`) — hover and selected never look alike. Rows: hover fill; selected row = accent tint + left bar.

## 7. Status colour rule

Background = hue at `--g-tint`, text = the hue itself in dark, the darkened hue in light (every light hue in
`glass.css` is pre-darkened for ≥ 4.5:1 on `--g-glass-solid`). Lifecycle maps amber → blue → violet → cyan →
green exactly as the house (`--c-*` are re-pointed, so `StageBadge`, dots and charts follow for free).
Red/`--g-danger` is exception-only. Live/online dots are green — status, not brand.

## 8. Page head

Eyebrow (11/650, `.08em`, accent-ink) above a display title, a 13px `--g-text-2` sub under it, actions
right-aligned with the single `.primary` rightmost. No breadcrumbs. Settings keeps its two-pane head.

## 9. Charts

`ui/charts.tsx` passes `var(--c-…)` / `var(--accent-ink)` straight into the SVG attributes, so recharts
follows a theme toggle live — no colour resolution, no subscription.

## 10. Meta rules

- Never a bespoke one-off; every new glass control is a pill or a glass surface from §5.
- Deletion over addition: a glass surface has one border (`--g-rim-lo`) and one hairline (`--g-sep`).
- No Tailwind / shadcn; plain CSS from the tokens.
- The UI never names infrastructure; modal headers stay title + identity only.
- Toasts stay opaque; the rail stays dark; the logo stays as it is.
- Accent presets and wallpaper presets are **not built** (one accent, one wallpaper per theme) — add a
  `data-accent` / `data-wall` token block only when someone asks for a second one.

## 11. Adding a page or component

1. Build it from the house classes (§5) and `--g-*` tokens; no literal colours in TSX.
2. Walk it in dark, light and system. Anything still slate-coloured is reading a literal in `styles.css` —
   add an override under `[data-skin="glass"]` in glass.css §11b (hue-tinted chips use the `--hue` +
   `color-mix(currentColor …)` pattern), never edit the component's colour inline.
3. If the page has a fixed grid footer, confirm it still floats above the last row (nothing on `.card`
   may carry `filter`/`transform`/`backdrop-filter`). Sticky sheet heads/footers must be opaque
   (`--g-glass-solid` / `--g-glass-thick`).
4. The kit page `#/glass-kit` is the reference for every control and state.
