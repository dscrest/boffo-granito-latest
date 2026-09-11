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
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "@/lib/usePersistedState";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import {
  loadAllowDupBatches,
  setAllowDupBatches,
  loadBatchSeries,
  setBatchSeries,
  loadDefaultView,
  setDefaultView,
  type BatchSeries,
  type DefaultView,
} from "./settingsApi";

interface SettingItem {
  label: string;
  icon: string;
  route: string;
  /** Secondary line on the card — what the list actually holds. */
  desc: string;
}

interface SettingGroup {
  /** Rail label, and the pane's uppercase eyebrow. */
  title: string;
  icon: string;
  /** Pane headline — names the work, not the group (e.g. "Reference lists"). */
  heading: string;
  sub: string;
  /** "prefs" renders <Preferences/> instead of the item cards. */
  kind?: "prefs";
  items: SettingItem[];
  /** Optional right-aligned pane action. */
  action?: { label: string; route: string };
}

const GROUPS: SettingGroup[] = [
  {
    title: "Users & Roles",
    icon: "users",
    heading: "People and access",
    sub: "Who can sign in, and what each role is allowed to do.",
    items: [
      { label: "Users", icon: "users", route: "/users", desc: "Accounts and sign-in" },
      { label: "Roles", icon: "shield-check", route: "/roles", desc: "Permission sets" },
    ],
  },
  {
    title: "Setup & Configuration",
    icon: "settings",
    heading: "Company setup",
    sub: "Values the whole app trades in — money, terms and vehicles.",
    items: [
      { label: "Currencies", icon: "chart", route: "/currencies", desc: "Rates and default currency" },
      { label: "Payment Terms", icon: "invoice", route: "/masters?m=payment_term", desc: "Credit and advance terms" },
      { label: "Vehicles", icon: "truck", route: "/masters?m=vehicle", desc: "Trucks and drivers" },
    ],
  },
  {
    title: "Product Masters",
    icon: "tile",
    heading: "Reference lists",
    sub: "Values used across products, orders and batches. Editing a list updates every record that references it.",
    action: { label: "New list value", route: "/masters" },
    items: [
      { label: "Finish", icon: "palette", route: "/masters?m=finish", desc: "Surface treatments" },
      { label: "Category", icon: "tile", route: "/masters?m=category", desc: "Product classification" },
      { label: "Glaze", icon: "palette", route: "/masters?m=glaze", desc: "Glaze recipes and codes" },
      { label: "Box Brand", icon: "flag", route: "/masters?m=brand", desc: "Product and carton branding" },
      { label: "Customer Brand", icon: "flag", route: "/masters?m=party_brand", desc: "Private-label brands" },
      { label: "Grade", icon: "check", route: "/masters?m=grade", desc: "Quality grades" },
      { label: "Cut Piece Size", icon: "tile", route: "/masters?m=cut_piece_size", desc: "Panel cut-piece dimensions" },
      { label: "Size Master", icon: "tile", route: "/sizes", desc: "Nominal dimensions and box packing" },
    ],
  },
  {
    title: "Data Operations",
    icon: "docs",
    heading: "Import and export",
    sub: "Move data in and out in bulk.",
    items: [
      { label: "Export", icon: "docs", route: "/data-operations", desc: "Download records as a file" },
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

function Preferences() {
  const [allowDup, setAllowDup] = useState<boolean | null>(null);
  const [view, setView] = useState<DefaultView | null>(null);
  const [busy, setBusy] = useState(false);
  // Batch series — staged locally, committed with Save (form-ux: Save-only).
  const [series, setSeries] = useState<BatchSeries | null>(null);
  const [draft, setDraft] = useState<BatchSeries | null>(null);
  useEffect(() => {
    void loadAllowDupBatches().then(setAllowDup);
    void loadDefaultView().then(setView);
    void loadBatchSeries().then((s) => { setSeries(s); setDraft(s); });
  }, []);

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
            checked={allowDup === true}
            disabled={busy || allowDup === null}
            onChange={(e) => void onToggle(e.target.checked)}
          />
          <span>Allow duplicate batch numbers</span>
        </label>
        <label className="settings-item" style={{ cursor: busy || view === null ? "wait" : "pointer" }}>
          <span>Default view</span>
          <select
            value={view ?? "sheet"}
            disabled={busy || view === null}
            onChange={(e) => void onView(e.target.value as DefaultView)}
          >
            <option value="sheet">Sheet</option>
            <option value="kanban">Kanban</option>
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
        <div className="dim" style={{ fontSize: "var(--t-xs)", marginTop: -6 }}>
          Prefix · separator · start number. Batches mint per item, restarting each month. Changing
          the prefix or separator starts a fresh series; existing batch numbers keep their format.
        </div>
      </div>
    </div>
  );
}

export function SettingsHome() {
  const navigate = useNavigate();
  // Persisted so the settings-page Back buttons land on the group you left.
  const [active, setActive] = usePersistedState("settings-active-group", GROUPS[0].title);
  const [query, setQuery] = useState("");

  // ?? guards a stale persisted title after a group rename.
  const group = GROUPS.find((g) => g.title === active) ?? GROUPS[0];

  // A search spans every group, not just the selected one — otherwise you have
  // to already know which group holds the thing you're looking for.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return GROUPS.flatMap((g) =>
      g.items
        .filter((it) => (it.label + " " + it.desc).toLowerCase().includes(q))
        .map((it) => ({ group: g, item: it })),
    );
  }, [query]);

  const card = (it: SettingItem, sub: string) => (
    <button key={it.route} className="set-card" onClick={() => navigate(it.route)} title={`Open ${it.label}`}>
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
          {GROUPS.map((g) => (
            <button
              key={g.title}
              className={`set-group ${!matches && g.title === active ? "active" : ""}`}
              onClick={() => {
                setActive(g.title);
                setQuery(""); // picking a group means you've stopped searching
              }}
            >
              <Icon name={g.icon} size={14} className="ic" />
              <span>{g.title}</span>
            </button>
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
            ) : (
              <div className="set-cards">{group.items.map((it) => card(it, it.desc))}</div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
