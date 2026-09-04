# Design System Prompt — "Warm Stone Ops" (BOFFO house style)

Paste this whole prompt into the agent building the other app. Replace the two items marked `⬅ SWAP` (brand font, brand accent) if the target app has its own brand; everything else stays as-is.

---

You are implementing a light-theme "ops dashboard" design system. Follow these specs exactly — define the tokens first as CSS custom properties on `:root`, then style every component from tokens only. Never hard-code a color inside a component rule.

## 1. Color tokens

Warm stone neutrals (NOT cool blue-grays):

```css
:root {
  /* Surfaces */
  --bg:        #f7f5f2;   /* app background */
  --panel:     #ffffff;   /* cards, tables, header */
  --panel-2:   #f4f1ec;   /* secondary surface: table heads, button fills */
  --elevated:  #ece7e0;   /* pressed/raised */
  --border:    #e9e4dc;   /* default 1px border */
  --border-2:  #dcd4c8;   /* stronger border: buttons, chips */
  --hover:     #f3efe9;   /* universal hover fill */

  /* Text (warm, WCAG AA on --panel-2) */
  --fg:     #17110c;   /* primary text */
  --fg-2:   #463d33;   /* secondary text, button labels, td default */
  --muted:  #695d50;   /* labels, subs, meta */
  --dim:    #86796a;   /* placeholders, chevrons */
  --faint:  #d4cbbe;   /* disabled indicators */

  /* Brand accent ⬅ SWAP hue if rebranding, keep the 3-token structure */
  --accent:      oklch(0.71 0.17 55);          /* orange #EF7F1A — fills, borders, indicators ONLY */
  --accent-fg:   #170f0b;                      /* text ON accent — near-black (white fails contrast on this orange) */
  --accent-soft: oklch(0.71 0.17 55 / 0.12);   /* selected-state fill, focus ring */
  --accent-ink:  oklch(0.56 0.15 55);          /* accent-colored TEXT on light surfaces (darkened to ≥4.5:1) */

  /* Status accents (darkened for light-bg readability) */
  --c-amber:  oklch(0.62 0.16 70);    /* pending / first stage */
  --c-blue:   oklch(0.55 0.16 245);   /* in progress */
  --c-violet: oklch(0.55 0.20 295);   /* mid stage */
  --c-cyan:   oklch(0.55 0.13 210);   /* late stage */
  --c-green:  oklch(0.55 0.16 150);   /* done / OK */
  --c-red:    oklch(0.58 0.20 25);    /* danger / overdue */
}
```

Dark sidebar rail (the only dark surface):

```css
--sidebar-bg: #171110;                    /* warm near-black */
--sb-fg:     #f5f1ec;  --sb-muted: #b3a89e;  --sb-dim: #8a7d70;
--sb-hover:  rgba(255,255,255,0.06);
--sb-active: #2a211a;
--sb-border: rgba(255,255,255,0.09);
```

**Rules:** bright `--accent` is reserved for fills/borders/indicators — accent-colored *text* always uses `--accent-ink`. Live/online dots stay green (status semantic, not brand).

## 2. Typography

- ONE font family app-wide. `⬅ SWAP: 'Zoho Puvi'` (self-hosted woff2, weights 400/500/600/700) → fallback `system-ui, sans-serif`. No second family; "mono" contexts use the same family with `font-variant-numeric: tabular-nums` (class `.mono`).
- Body: `font-size: 12.5px; letter-spacing: -0.005em; font-feature-settings: 'cv11','ss01','tnum'; -webkit-font-smoothing: antialiased;`
- Scale tokens: `--t-xs/sm/md/lg: 12.5px` (body flat), `--t-xl: 18px`, `--t-2xl: 22px`, `--t-3xl: 30px`, `--t-4xl: 42px`.
- Page title: 24px / 700 / letter-spacing -0.02em. Section title: 18px / 600 / -0.01em. Numbers (KPIs, qty, ids): `.mono` with tabular-nums, right-aligned in tables.

## 3. Buttons

Base (`.btn` 28px, header/page variant `.hbtn` 30px — identical chrome):

```css
.btn {
  height: 28px; padding: 0 11px;
  display: inline-flex; align-items: center; gap: 6px;
  border: 1px solid var(--border-2); border-radius: 6px;
  background: var(--panel-2); color: var(--fg-2);
  font-size: 12.5px; white-space: nowrap;
}
.btn:hover    { background: var(--hover); color: var(--fg); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn.primary  { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600; }
.btn.active   { color: var(--fg); border-color: var(--accent); background: var(--accent-soft); }  /* selected */
.btn.sm       { height: 22px; padding: 0 8px; border-radius: 5px; }   /* dense table rows */
.btn.icon     { width: 30px; padding: 0; justify-content: center; }   /* icon-only square */
```

**Rules:** exactly ONE `.primary` per view (accent fill, near-black text, weight 600). Everything else is the quiet panel-2 button. Selected/toggled state = accent border + `--accent-soft` fill — this same treatment marks "chosen" everywhere (buttons, nav items, list rows). Filter-bar buttons shrink to 26px/radius 5. No negative-phrased buttons.

## 4. Inputs (never flat)

Every text-like input, select, date and textarea gets the house skin globally:

```css
input, select, textarea {
  height: 35px; padding: 0 11px;
  background: var(--panel); color: var(--fg);
  border: 1px solid var(--border); border-radius: 9px;
  font: inherit; appearance: none;
  transition: border-color .15s, box-shadow .15s;
}
:hover  { border-color: var(--accent); }
:focus  { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
```

Selects get an inline-SVG chevron (`background-image`, right 10px center) since `appearance:none` removes the native arrow. Error state: `border-color: var(--c-red)` + red-tinted focus ring. Form fields: grey background = auto/derived, white = typable; required marker in-box; date fields default to today. Global keyboard focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`.

## 5. Grid / data table

```css
.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tbl th {
  text-align: left; font-weight: 700; font-size: 12.5px;
  letter-spacing: .04em; text-transform: uppercase; color: var(--fg-2);
  padding: 8px 10px; white-space: nowrap;
  border-bottom: 1px solid var(--border); background: var(--panel-2);
  position: sticky; top: 0; z-index: 1;
}
.tbl td {
  padding: 5px 10px; height: 36px;             /* uniform min row height */
  border-bottom: 1px solid var(--border);      /* row separators only, NO column rules */
  color: var(--fg-2); vertical-align: middle;
}
.tbl tr:hover td { background: var(--hover); }
.tbl tr:last-child td { border-bottom: 0; }
.tbl td.num { font-family: inherit; font-variant-numeric: tabular-nums; text-align: right; color: var(--fg); }
.tbl td.nw  { white-space: nowrap; }
.tbl .clip  { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } /* cap on the SPAN, not the td; add title= */
.tbl td select, .tbl td .btn, .tbl td input { height: 26px; }  /* in-cell controls never grow the row */
```

**Grid UX rules:** one-line rows always (`.nw` + `.clip`); whole row clickable → detail page (`cursor:pointer`); default sort newest-first; column show/hide + reorder behind an icon-only picker that commits only on Apply; Created/Modified hidden by default; footer pager in a fixed bar pinned to the viewport bottom (`position:fixed; left: var(--sidebar-w); background: var(--panel); border-top: 1px solid var(--border)`), with scroll room reserved so the last row isn't hidden.

Tables live inside a card: `background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: clip; box-shadow: 0 1px 2px rgba(15,20,25,0.03);`

## 6. Links

- Bare `<a>` inherits color, no underline (`a { color: inherit; text-decoration: none; }`).
- Text that navigates (record names, "view" actions — often a `<button>`):

```css
.linkish {
  color: var(--accent-ink);
  background: none; border: 0; padding: 0; font: inherit;
  text-decoration: none; cursor: pointer;
}
.linkish:hover, .linkish:focus-visible { text-decoration: underline; }
```

Underline on hover only, never resting. In a clickable row, the whole row is the hit target but only the record name is `.linkish` (and underlines on row hover) — the row reads as one link. No breadcrumbs anywhere.

## 7. Highlight / selected states

One aesthetic for "this is chosen", reused everywhere:
- fill `var(--accent-soft)` + border `var(--accent)` + text `var(--fg)` (weight 600 in nav/lists).
- Applies to: toggled `.btn.active`, filter chips, nav rail items, combobox selected option, current page in the pager.
- Sidebar active item additionally gets a 2px accent bar on its left edge.
- Hover is always `var(--hover)` fill (light) or `--sb-hover` (dark rail) — hover and selected are visually distinct.
- Card/tile hover: `border-color: var(--accent)` + `background: var(--hover)`.

## 8. Status chips, stage badges, dots

The tint formula — for any status color `C` in oklch: **background `C / 0.10`, border `C / 0.30`, text = C darkened to L ≈ 0.40–0.42** (never the bright value; text must hit 4.5:1 on white).

```css
/* Attribute chip (ids, sizes, categories) — tabular-nums, tiny radius */
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 7px; font-size: 12.5px; line-height: 16px;
  border-radius: 3px; font-variant-numeric: tabular-nums;
  background: var(--panel-2); border: 1px solid var(--border-2); color: var(--fg-2);  /* neutral default */
}
/* Stage / status badge */
.stage {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12.5px; padding: 2px 8px; border-radius: 3px; border: 1px solid;
}
.stage.amber  { color: var(--c-amber);  border-color: oklch(0.62 0.16 70 / .30);  background: oklch(0.62 0.16 70 / .10); }
.stage.blue   { color: var(--c-blue);   border-color: oklch(0.55 0.16 245 / .30); background: oklch(0.55 0.16 245 / .10); }
.stage.violet { color: var(--c-violet); border-color: oklch(0.55 0.20 295 / .30); background: oklch(0.55 0.20 295 / .10); }
.stage.cyan   { color: var(--c-cyan);   border-color: oklch(0.55 0.13 210 / .30); background: oklch(0.55 0.13 210 / .10); }
.stage.green  { color: var(--c-green);  border-color: oklch(0.55 0.16 150 / .30); background: oklch(0.55 0.16 150 / .10); }
.stage.red    { color: var(--c-red);    border-color: oklch(0.58 0.20 25 / .30);  background: oklch(0.58 0.20 25 / .10); }

/* Status dot (inline indicators, priority) */
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dot.green { background: var(--c-green); }   /* etc. per --c-* */
.dot.high  { background: var(--c-red); box-shadow: 0 0 0 3px oklch(0.58 0.20 25 / .15); }  /* urgent halo */

/* Neutral pill */
.pill { display: inline-flex; align-items: center; gap: 6px; height: 18px; padding: 0 7px;
        border-radius: 3px; font-size: 12.5px; border: 1px solid var(--border-2);
        background: var(--panel-2); color: var(--fg-2); }
```

Map lifecycle to hue in order: amber → blue → violet → cyan → green (red = danger/exception only). Chips are squarish (3px radius) — do NOT make them full-round pills.

## 9. Page & shell furniture

- Shell: CSS grid, fixed dark sidebar (232px, collapsible to a 60px icon rail) + 52px sticky header; `.main` is the single scroll container.
- Page head: title 24px/700 left, muted sub under it, **all actions right-aligned** (`margin-left: auto`), primary button rightmost.
- Filter bar: white rounded bar (radius 7, padding 6/8) holding 26px-high controls (buttons/selects/search/dates) with radius 5.
- Sidebar: uppercase 11.5px letterspaced group titles in `--sb-dim`; rows radius 5; whole rail weight 600 (light-on-dark reads thinner).
- KPI tile: card + muted 12.5px label, 24px tabular-nums value, unit in 13px muted.
- Progress bar: 4px track `--border-2`, fill `--accent`, radius 2.
- Kanban: equal columns, `.col` card with bordered head (name 600 + mono count chip at right), 8px gap card list; cards on `--panel-2` with `--border-2`, radius 6.

## 10. Meta rules

- Every control shares this one aesthetic — never invent a bespoke one-off variant.
- Deletion of chrome over addition: no shadows except the faint card shadow and dropdown shadows (`0 8px 28px rgba(0,0,0,0.28)`).
- No Tailwind/shadcn required — plain CSS with these tokens is the implementation.
- Modal headers = title (+ record identity at most), no instruction sentences.
- UI never names infrastructure (no backend/product words in subtitles).
