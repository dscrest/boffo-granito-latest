/* ============================================================
   SettingsHome — a two-pane settings workspace: a persistent group
   rail on the left, one pane of work at a time on the right. Replaces
   the old flat card grid (2026-09-03), where all five groups competed
   for attention at once and there was no way to find a setting by name.
   Reached from the header gear (admin-only route).

   Still config-driven, mirroring the MASTERS/LINKS style in Masters.tsx;
   markup reuses existing app classes (eyebrow, title, sub, card, hbtn).
   Items navigate to their existing routes — this page is layout only,
   it owns no data and makes no API calls of its own.
   ============================================================ */
import { ZOHO } from "@/features/masters/zohoApi";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isAdmin } from "@/lib/auth";
import { hubPick } from "@/features/masters/hubPick";
import { hubRailLabel, MastersPane, visibleHubGroups } from "@/features/masters/Masters";
import { usePersistedState } from "@/lib/usePersistedState";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { OrgProfile } from "./OrgProfile";
import { useMasters } from "@/features/masters/useMasters";
import {
  loadAllowDupBatches,
  setAllowDupBatches,
  loadBatchSeries,
  setBatchSeries,
  loadDefaultView,
  setDefaultView,
  loadDefaultDesignOwner,
  setDefaultDesignOwner,
  type BatchSeries,
  type DefaultView,
} from "./settingsApi";

export interface SettingItem {
  label: string;
  icon: string;
  route: string;
  /** Secondary line on the card — what the list actually holds. */
  desc: string;
  /** CR-408: words people search by that the label / desc don't say (godown, truck, login…). Never shown. */
  keywords?: string;
  /** CR-408: a Preferences row — clicking opens that pane here instead of navigating. */
  pane?: string;
}

export interface SettingGroup {
  /** Rail label, and the pane's uppercase eyebrow. */
  title: string;
  icon: string;
  /** Pane headline — names the work, not the group (e.g. "Reference lists"). */
  heading: string;
  sub: string;
  /** "prefs" renders <Preferences/>; "masters" (CR-439) is the Masters menu — rail sub-items
      Item / Panel / Export, pane = <MastersPane/>; its `items` are the ⌘K / search index only;
      "org" (CR-445) renders <OrgProfile/>. */
  kind?: "prefs" | "masters" | "org";
  items: SettingItem[];
  /** Optional right-aligned pane action. */
  action?: { label: string; route: string };
}

const GROUPS: SettingGroup[] = [
  {
    title: "Organization",
    icon: "flag",
    heading: "Organization profile",
    sub: "Logo, company name, tax and bank details used on every document.",
    kind: "org",
    items: [],
  },
  {
    title: "Users & Roles",
    icon: "users",
    heading: "People and access",
    sub: "Who can sign in, and what each role is allowed to do.",
    items: [
      { label: "Users", icon: "users", route: "/users", desc: "Accounts and sign-in", keywords: "login staff people password email" },
      { label: "Roles", icon: "shield-check", route: "/roles", desc: "Permission sets", keywords: "access rights admin" },
    ],
  },
  {
    // CR-436: Setup & Configuration + Item Master + Panel Master collapsed into ONE group.
    // CR-439: the masters render INSIDE this workspace (rail Masters ▸ Item / Panel / Export,
    // pane = horizontal tabs); these tiles are the search / ⌘K index only — a hit deep-links
    // /masters?g=<group>&m=<master>, which is this same page. Keywords = synonyms.
    title: "Masters",
    icon: "columns",
    heading: "Reference lists",
    sub: "Item, panel and export masters — editing a list updates every record that references it.",
    kind: "masters",
    items: [
      // CR-439: tile order follows the Masters rail — Item · Panel · Export
      // Item Master
      { label: "Items", icon: "tile", route: "/masters?g=item&m=items", desc: "The item (design) master", keywords: "design sku product" },
      { label: "Size Master", icon: "tile", route: "/masters?g=item&m=sizes", desc: "Nominal dimensions and box packing", keywords: "dimensions mm pcs per box weight" },
      { label: "Finish", icon: "palette", route: "/masters?g=item&m=finish", desc: "Surface treatments" },
      { label: "Category", icon: "tile", route: "/masters?g=item&m=category", desc: "Product classification" },
      { label: "Glaze", icon: "palette", route: "/masters?g=item&m=glaze", desc: "Glaze recipes and codes" },
      { label: "Box Brand", icon: "flag", route: "/masters?g=item&m=brand", desc: "Product and carton branding" },
      { label: "Customer Brand", icon: "flag", route: "/masters?g=item&m=party_brand", desc: "Private-label brands, per customer" },
      { label: "Grade", icon: "check", route: "/masters?g=item&m=grade", desc: "Quality grades" },
      // CR-394 Design Master lookups
      { label: "Surface Application", icon: "palette", route: "/masters?g=item&m=surface_application", desc: "Applications on the tile surface" },
      { label: "Punch Type", icon: "tile", route: "/masters?g=item&m=punch", desc: "Punch patterns, with image" },
      { label: "Series", icon: "docs", route: "/masters?g=item&m=series", desc: "Marketing series names" },
      { label: "Catalogue", icon: "docs", route: "/masters?g=item&m=catalogue", desc: "Catalogue names" },
      // Panel Master
      { label: "Panel Items", icon: "tile", route: "/masters?g=panel&m=panel_items", desc: "Items used on showcase panels", keywords: "panel craft cut pieces" },
      { label: "Cut Piece Size", icon: "tile", route: "/masters?g=panel&m=cut_piece_size", desc: "Panel cut-piece dimensions", keywords: "panel cut dimensions" },
      { label: "MDF", icon: "tile", route: "/masters?g=panel&m=mdf", desc: "Board sizes, thicknesses and weights", keywords: "board thickness panel weight" }, // CR-344
      { label: "Panels", icon: "tile", route: "/masters?g=panel&m=panels", desc: "Showcase panel designs", keywords: "panel master showcase" },
      // Export Master
      { label: "Pallet Master", icon: "palette", route: "/masters?g=export&m=pallets", desc: "Pallet formats per size", keywords: "pallet packing boxes" },
      { label: "Container Master", icon: "truck", route: "/masters?g=export&m=containers", desc: "What one container of a size holds", keywords: "container 20ft 40ft" },
      { label: "Vehicles", icon: "truck", route: "/masters?g=export&m=vehicle", desc: "Trucks and drivers", keywords: "truck lorry driver transport" },
      { label: "Payment Terms", icon: "invoice", route: "/masters?g=export&m=payment_term", desc: "Credit and advance terms", keywords: "payment days" },
      { label: "Adjustment Reason", icon: "check", route: "/masters?g=export&m=adjustment_reason", desc: "Why stock was adjusted", keywords: "stock adjustment" }, // CR-308
      { label: "Currencies", icon: "chart", route: "/masters?g=export&m=currencies", desc: "Rates and default currency", keywords: "money exchange inr usd" },
      // CR-329 · CR-409: warehouses hold locations (A1 … F12)
      { label: "Warehouses & Locations", icon: "package", route: "/masters?g=export&m=warehouses", desc: "Godowns and the locations inside them", keywords: "warehouse godown location rack bay bin stock store primary" },
      { label: "Label Templates", icon: "printer", route: "/masters?g=export&m=label_templates", desc: "Box stickers: barcode, batch and compliance labels", keywords: "label sticker barcode ean print box" }, // CR-502
    ],
  },
  {
    title: "Data Operations",
    icon: "docs",
    heading: "Import and export",
    sub: "Move data in and out in bulk.",
    items: [
      { label: "Export", icon: "docs", route: "/data-operations", desc: "Download records as a file", keywords: "csv excel download backup" },
      { label: ZOHO.label, icon: "refresh", route: "/settings/zoho", desc: `Customer sync with the organisation's ${ZOHO.label}`, keywords: "zoho crm books sync import customers" },
    ],
  },
  {
    title: "Preferences",
    icon: "columns",
    heading: "Preferences",
    sub: "How the app behaves for everyone in this organisation.",
    kind: "prefs",
    items: [],
  },
];

/* CR-408: the Preferences rows are settings too — searchable, and a hit opens the
   Preferences pane (they have no route of their own). Keep in step with <Preferences/>. */
/* CR-445: the Organization fields are searchable too — a hit opens that pane. */
const ORG_ITEMS: SettingItem[] = [
  { label: "Logo", icon: "flag", route: "/settings", pane: "Organization", desc: "The company logo on the app and every document", keywords: "brand image organisation organization profile" },
  { label: "Company name", icon: "flag", route: "/settings", pane: "Organization", desc: "Brand and legal name", keywords: "organisation organization profile title" },
  { label: "Tax details", icon: "flag", route: "/settings", pane: "Organization", desc: "GSTIN, PAN and IEC printed on documents", keywords: "gst gstin pan iec tax" },
  { label: "Address & contact", icon: "flag", route: "/settings", pane: "Organization", desc: "Address, phone, email and website on the letterhead", keywords: "organisation organization profile" },
  { label: "Bank details", icon: "flag", route: "/settings", pane: "Organization", desc: "Beneficiary, bank, account, IFSC and SWIFT on quotes", keywords: "account ifsc swift" },
];

const PREF_ITEMS: SettingItem[] = [
  { label: "Allow duplicate batch numbers", icon: "columns", route: "/settings", pane: "Preferences", desc: "Whether two batches may share a number", keywords: "batch duplicate" },
  { label: "Default design owner", icon: "columns", route: "/settings", pane: "Preferences", desc: "The customer a new item's Design Owner starts on", keywords: "item owner customer boffo" },
  { label: "Batch series", icon: "columns", route: "/settings", pane: "Preferences", desc: "Prefix, separator and start number of batch numbers", keywords: "numbering prefix format" },
];

export interface SettingHit {
  group: SettingGroup;
  item: SettingItem;
}

/** CR-408: every whitespace token of `q` must appear somewhere in label + desc + keywords
    ("ware loc" and "godown" both find Warehouses & Locations). Spans all groups and the
    Preferences rows. Pure — the rail and the header ⌘K palette share it. */
export function searchSettings(q: string): SettingHit[] {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const hay = (it: SettingItem) => `${it.label} ${it.desc} ${it.keywords ?? ""}`.toLowerCase();
  const prefs = GROUPS.find((g) => g.kind === "prefs")!;
  const orgGroup = GROUPS.find((g) => g.kind === "org")!;
  return [
    ...GROUPS.flatMap((g) => g.items.map((item) => ({ group: g, item }))),
    ...ORG_ITEMS.map((item) => ({ group: orgGroup, item })),
    ...PREF_ITEMS.map((item) => ({ group: prefs, item })),
  ].filter(({ item }) => {
    const h = hay(item);
    return tokens.every((t) => h.includes(t));
  });
}

function Preferences() {
  const [allowDup, setAllowDup] = useState<boolean | null>(null);
  const [view, setView] = useState<DefaultView | null>(null);
  const [busy, setBusy] = useState(false);
  // Batch series — staged locally, committed with Save (form-ux: Save-only).
  const [series, setSeries] = useState<BatchSeries | null>(null);
  const [draft, setDraft] = useState<BatchSeries | null>(null);
  // CR-392: the Customer a new item's Design Owner starts on (spec: "default will be boffo").
  const [owner, setOwner] = useState<string | null>(null);
  const { customers } = useMasters();
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
    void loadDefaultView().then(setView);
    void loadBatchSeries().then((s) => { setSeries(s); setDraft(s); });
    void loadDefaultDesignOwner().then(setOwner);
  }, []);

  const onOwner = async (v: string) => {
    const prev = owner;
    setBusy(true);
    setOwner(v);
    const res = await setDefaultDesignOwner(v);
    setBusy(false);
    if (!res.ok) {
      setOwner(prev);
      toast.error(res.error || "Could not save setting");
      return;
    }
    toast.success(v ? "New items start on that design owner" : "New items start with no design owner");
  };

  // Which view the board pages (Production, Packing, Loading, Panel Orders) open
  // on. Each user can still switch view per page for their session.
  const onView = async (v: DefaultView) => {
    const prev = view;
    setBusy(true);
    setView(v);
    const res = await setDefaultView(v);
    setBusy(false);
    if (!res.ok) {
      setView(prev);
      toast.error(res.error || "Could not save setting");
      return;
    }
    toast.success(v === "sheet" ? "Pages open on Sheet" : "Pages open on Kanban");
  };

  const onToggle = async (v: boolean) => {
    setBusy(true);
    setAllowDup(v);
    const res = await setAllowDupBatches(v);
    setBusy(false);
    if (!res.ok) {
      setAllowDup(!v);
      toast.error(res.error || "Could not save setting");
      return;
    }
    toast.success(v ? "Duplicate batch numbers allowed" : "Duplicate batch numbers blocked");
  };

  const seriesDirty =
    !!series && !!draft &&
    (draft.prefix !== series.prefix || draft.separator !== series.separator || draft.start !== series.start);
  const now = new Date();
  const preview = draft
    ? `${draft.prefix || "B"}${draft.separator || "/"}${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}${draft.separator || "/"}${String(Math.max(1, draft.start || 1)).padStart(3, "0")}`
    : "";
  const onSaveSeries = async () => {
    if (!draft || !seriesDirty || busy) return;
    setBusy(true);
    const res = await setBatchSeries(draft);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save the batch series");
      return;
    }
    const saved = await loadBatchSeries();
    setSeries(saved);
    setDraft(saved);
    toast.success(`Batch series saved — next batches mint like ${preview}`);
  };

  return (
    <div className="card">
      <div className="card-body settings-list">
        <label className="settings-item" style={{ cursor: busy || allowDup === null ? "wait" : "pointer" }}>
          <input
            type="checkbox"
            className="switch"
            checked={allowDup === true}
            disabled={busy || allowDup === null}
            onChange={(e) => void onToggle(e.target.checked)}
          />
          <span>Allow duplicate batch numbers</span>
        </label>
        {/* CR-418: "Default view" (Sheet | Kanban) hidden — Kanban is hidden app-wide, Sheet is the only view. */}
        <label className="settings-item" style={{ cursor: busy || owner === null ? "wait" : "pointer" }}>
          <span>Default design owner</span>
          <select
            value={owner ?? ""}
            disabled={busy || owner === null}
            onChange={(e) => void onOwner(e.target.value)}
            title="The customer a new item's Design Owner is prefilled with"
          >
            <option value="">— none —</option>
            {customers.filter((c) => c.active || c.id === owner).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {/* Batch series — the auto-minted production batch number format.
            Per item, restarts monthly at the start number. */}
        <div className="settings-item" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span>Batch series</span>
          <input
            type="text"
            value={draft?.prefix ?? ""}
            disabled={busy || draft === null}
            maxLength={10}
            onChange={(e) => setDraft((d) => d && { ...d, prefix: e.target.value })}
            style={{ width: 70 }}
            aria-label="Batch series prefix"
            title="Series prefix"
          />
          <input
            type="text"
            value={draft?.separator ?? ""}
            disabled={busy || draft === null}
            maxLength={3}
            onChange={(e) => setDraft((d) => d && { ...d, separator: e.target.value })}
            style={{ width: 44, textAlign: "center" }}
            aria-label="Batch series separator"
            title="Separator"
          />
          <input
            type="number"
            min={1}
            value={draft?.start ?? 1}
            disabled={busy || draft === null}
            onChange={(e) => setDraft((d) => d && { ...d, start: Math.max(1, Number(e.target.value) || 1) })}
            style={{ width: 70, textAlign: "right" }}
            aria-label="Batch series start number"
            title="Start number — each item's series restarts here every month"
          />
          <span className="mono dim" title="Next batch for an item with no batches this month">{preview}</span>
          {seriesDirty && (
            <button className="hbtn primary" disabled={busy} onClick={() => void onSaveSeries()}>
              <Icon name="check" size={13} /> Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsHome() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Persisted so the settings-page Back buttons land on the group you left.
  const [active, setActive] = usePersistedState("settings-active-group", GROUPS[0].title);
  const [query, setQuery] = useState("");
  // CR-439: non-admins reach this page only through /masters (role holds the "masters" nav id —
  // old-route redirects such as /sizes) and see the Masters menu alone. CR-440: no sidebar leaf.
  const admin = isAdmin();
  const groups = admin ? GROUPS : GROUPS.filter((g) => g.kind === "masters");
  const mastersTitle = GROUPS.find((g) => g.kind === "masters")!.title;
  const hubGroups = visibleHubGroups();
  const [sp, setSp] = useSearchParams();
  // CR-439: ?g=item|panel|export (&m=) is the Masters selection — it stays in the URL (tabs
  // deep-link, redirects / ⌘K land on it). CR-408: ?g=<group title> opens that pane once.
  const g = sp.get("g"), m = sp.get("m");
  const isHubParam = hubGroups.some((x) => x.key === g || x.masters.some((y) => y.key === m));
  const hub = isHubParam ? hubPick(hubGroups, g, m) : null;
  useEffect(() => {
    if (isHubParam) setActive(mastersTitle);
    else if (g && GROUPS.some((x) => x.title === g)) {
      setActive(g);
      setSp({}, { replace: true });
    }
  }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  // /masters (redirects, ⌘K, tiles) lands on the Masters menu — once, on arrival.
  useEffect(() => {
    if (pathname === "/masters") setActive(mastersTitle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ?? guards a stale persisted title after a group rename.
  const group = groups.find((g) => g.title === active) ?? groups[0];
  // The Masters sub-item in the rail / pane: the URL's, else the first the role may see.
  const hubGroup = hub?.group ?? hubGroups[0];
  const openHub = (key: string) => {
    const g = hubGroups.find((x) => x.key === key) ?? hubGroups[0];
    setActive(mastersTitle);
    setQuery("");
    if (g) setSp({ g: g.key, m: g.masters[0].key }, { replace: true });
  };

  // A search spans every group, not just the selected one — otherwise you have
  // to already know which group holds the thing you're looking for. CR-408: token
  // match + keywords + the Preferences rows (searchSettings, shared with ⌘K).
  const matches = useMemo(
    () => (query.trim() ? searchSettings(query).filter((h) => admin || h.group.kind === "masters") : null),
    [query, admin],
  );

  // A Preferences hit opens that pane here; everything else navigates to its page.
  const open = (it: SettingItem) => {
    setQuery("");
    if (it.pane) {
      setActive(it.pane);
      return;
    }
    navigate(it.route);
  };
  const card = (it: SettingItem, sub: string) => (
    <button key={`${it.route} ${it.label}`} className="set-card" onClick={() => open(it)} title={`Open ${it.label}`}>
      <div className="set-card-text">
        <div className="set-card-label">{it.label}</div>
        <div className="set-card-desc">{sub}</div>
      </div>
      <Icon name="chev-r" size={14} className="set-card-chev" />
    </button>
  );

  return (
    <div className="set-wrap">
      <aside className="set-rail">
        <div className="title">Settings</div>
        <div className="sub">Users, configuration, masters</div>

        <input
          type="search"
          className="set-search"
          placeholder="Search settings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="set-groups">
          {groups.map((g) => (
            <Fragment key={g.title}>
              <button
                className={`set-group ${!matches && g.title === active ? (g.kind === "masters" ? "open" : "active") : ""}`}
                onClick={() => {
                  if (g.kind === "masters") return openHub(hubGroup?.key ?? "");
                  setActive(g.title);
                  setQuery(""); // picking a group means you've stopped searching
                  if (hub) setSp({}, { replace: true });
                }}
              >
                <Icon name={g.icon} size={14} className="ic" />
                <span>{g.title}</span>
                {g.kind === "masters" && <Icon name={g.title === active ? "chev-d" : "chev-r"} size={13} className="ic" />}
              </button>
              {/* CR-439: sub-menu — Item / Panel / Export, open while Masters is the active group */}
              {g.kind === "masters" && g.title === active && !matches && (
                <div className="set-subgroups">
                  {hubGroups.map((h) => (
                    <button key={h.key} className={`set-group ${h.key === hubGroup?.key ? "active" : ""}`} onClick={() => openHub(h.key)}>
                      <Icon name={h.icon} size={14} className="ic" />
                      <span>{hubRailLabel(h)}</span>
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </aside>

      <section className="set-pane">
        {matches ? (
          <>
            <div className="set-pane-head">
              <div>
                <div className="eyebrow">Search</div>
                <div className="title">
                  {matches.length} result{matches.length === 1 ? "" : "s"}
                </div>
                <div className="sub">Matching “{query.trim()}” across all settings.</div>
              </div>
            </div>
            {matches.length === 0 ? (
              <div className="muted" style={{ padding: "24px 2px" }}>
                Nothing matches “{query.trim()}”.
              </div>
            ) : (
              <div className="set-cards">
                {matches.map(({ group: g, item }) => card(item, `${g.title} · ${item.desc}`))}
              </div>
            )}
          </>
        ) : group.kind === "masters" && hubGroup ? (
          <MastersPane group={hubGroup} />
        ) : (
          <>
            <div className="set-pane-head">
              <div>
                <div className="eyebrow">{group.title}</div>
                <div className="title">{group.heading}</div>
                <div className="sub">{group.sub}</div>
              </div>
              {group.action && (
                <button className="hbtn primary" onClick={() => navigate(group.action!.route)}>
                  {group.action.label}
                </button>
              )}
            </div>
            {group.kind === "prefs" ? (
              <Preferences />
            ) : group.kind === "org" ? (
              <OrgProfile />
            ) : (
              <div className="set-cards">{group.items.map((it) => card(it, it.desc))}</div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
