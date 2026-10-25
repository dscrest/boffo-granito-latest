/* ============================================================
   Shell menus — Notification bell (header) + the rail user chip
   with its settings menu (bottom of the sidebar, CR-379).
   Each owns its open state and closes on outside-click / Esc.
   ============================================================ */
import { Fragment, useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { useModalA11y } from "@/ui/useModalA11y";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { list } from "@/lib/dataOps";
import { actorName, describeChange, opLabel, parseDbTime, tableLabel } from "@/lib/format";
import { useLocation, useNavigate } from "react-router-dom";
import { signOut, storedAuth, type SessionUser } from "@/lib/auth";
import { AUTO_TOURS, startTour } from "@/features/tour/Tour";

const str = (v: unknown) => (v == null ? "" : String(v));

/** Close `onClose` when clicking outside `ref` or pressing Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

/* ---------------- Notification bell ---------------- */

interface Notif {
  id: string;
  when: string; // relative label
  occurredAt: string;
  text: string;
  /** In-app route (e.g. "#/quotes/123") — personal notifications only. */
  link?: string;
}

const SEEN_KEY = "boffo_notif_seen";

const OP_VERB: Record<string, string> = { INSERT: "created", UPDATE: "updated", DELETE: "deleted" };

/** "yyyy-MM-dd HH:mm:ss" (stored UTC) → short relative label. parseDbTime
    applies the UTC assumption — parsing as local read ~5.5h old on IST. */
function rel(occurredAt: string): string {
  const t = parseDbTime(occurredAt);
  if (isNaN(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(false);
  // Read-marker: rows newer than this are unread (bold). Set by "Mark all read" only.
  const [lastSeen, setLastSeen] = useState<string>(() => localStorage.getItem(SEEN_KEY) || "");
  const markAllRead = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    localStorage.setItem(SEEN_KEY, stamp);
    setLastSeen(stamp);
  };
  const unread = (n: Notif) => n.occurredAt > lastSeen;
  useDismiss(ref, open, () => setOpen(false));

  // Personal notifications (approval verdicts etc.) for the signed-in user.
  const [personal, setPersonal] = useState<Notif[]>([]);
  const myRowid = storedAuth()?.user?.rowid || "";

  const fetchPersonal = () =>
    myRowid
      ? list("Notification", { order: "ROWID desc", limit: 30 }).then((res) =>
          (res.rows || [])
            .filter((r) => str(r.recipient) === myRowid)
            .slice(0, 10)
            .map((r) => ({
              id: `n${str(r.ROWID)}`,
              occurredAt: str(r.occurred_at),
              when: rel(str(r.occurred_at)),
              text: str(r.text),
              link: str(r.link) || undefined,
            })),
        )
      : Promise.resolve([] as Notif[]);

  const fetchItems = () => {
    setLoading(true);
    void fetchPersonal().then(setPersonal);
    void list("OperationLog", { order: "ROWID desc", limit: 30 })
      .then((res) => {
        const rows = (res.rows || [])
          .filter((r) => str(r.status) === "success")
          .slice(0, 10)
          .map((r) => {
            const op = str(r.operation).toUpperCase();
            const verb = OP_VERB[op] || opLabel(op).toLowerCase() || "changed";
            // The verb is already in the sentence — keep only what describeChange adds beyond it.
            const detail = describeChange(str(r.operation), str(r.payload_summary)).replace(/^(Created|Updated|Deleted)\s*/, "");
            const summary = detail && detail !== "—" ? detail : r.entity_rowid ? `#${str(r.entity_rowid)}` : "";
            return {
              id: str(r.ROWID),
              occurredAt: str(r.occurred_at),
              when: rel(str(r.occurred_at)),
              text: `${actorName(str(r.actor))} ${verb} ${tableLabel(str(r.table_name))}${summary ? ` · ${summary}` : ""}`,
            };
          });
        setItems(rows);
      })
      .finally(() => setLoading(false));
  };

  // Track the newest op/notification timestamp so the unseen dot can show
  // without opening. Personal notifications count toward the dot too.
  const [newest, setNewest] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const check = () => {
      // Background tabs must not poll: all projects in the Catalyst org share
      // one Dev-env FUNCTIONS concurrency pool, and idle boffo tabs were
      // starving the SKU app into 429s (2026-09-01).
      if (document.visibilityState !== "visible") return;
      void list("OperationLog", { order: "ROWID desc", limit: 1 }).then((res) => {
        if (!alive) return;
        const ts = str((res.rows || [])[0]?.occurred_at);
        if (ts) setNewest((n) => (ts > n ? ts : n));
      });
      void fetchPersonal().then((rows) => {
        if (!alive) return;
        const ts = rows[0]?.occurredAt || "";
        if (ts) setNewest((n) => (ts > n ? ts : n));
      });
    };
    check();
    const t = setInterval(check, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasUnseen = Boolean(newest && newest > lastSeen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchItems();
  };

  return (
    <div className="hdr-pop" ref={ref}>
      <button className="hbtn" title="Notifications" aria-label="Notifications" onClick={toggle}>
        <Icon name="bell" size={13} />
        {hasUnseen && <span className="dot red" style={{ width: 5, height: 5, marginLeft: -3 }} />}
      </button>
      {open && (
        <div className="hdr-menu" style={{ width: 320 }}>
          {personal.length > 0 && (
            <>
              <div className="hdr-menu-head">For you</div>
              <div className="hdr-menu-list">
                {personal.map((n) => (
                  <div
                    className={`hdr-menu-row${unread(n) ? " unread" : ""}`}
                    key={n.id}
                    style={n.link ? { cursor: "pointer" } : undefined}
                    onClick={() => {
                      if (n.link) {
                        location.hash = n.link.replace(/^#/, "#");
                        setOpen(false);
                      }
                    }}
                    title={n.link ? "Open" : undefined}
                  >
                    <div className="hdr-menu-row-text">{n.text}</div>
                    <div className="hdr-menu-row-time">{n.when}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="hdr-menu-head" style={{ display: "flex", alignItems: "center" }}>
            Recent activity
            {hasUnseen && (
              <button type="button" className="back-link" style={{ marginLeft: "auto" }} onClick={markAllRead}>
                Mark all read
              </button>
            )}
          </div>
          {loading && items.length === 0 ? (
            <div className="hdr-menu-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="hdr-menu-empty">No recent activity</div>
          ) : (
            <div className="hdr-menu-list">
              {items.map((n) => (
                <div className={`hdr-menu-row${unread(n) ? " unread" : ""}`} key={n.id}>
                  <div className="hdr-menu-row-text">{n.text}</div>
                  <div className="hdr-menu-row-time">{n.when}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
/* ---------------- Rail user chip + menu (CR-379) ----------------
   Pinned at the bottom of the sidebar: avatar · name · role · ⌄. The menu
   opens ABOVE the chip (styles.css .rail-menu): Settings (Admin) · Keyboard
   shortcuts · tours · Light / Dark / Match system · Sign out. */

const THEME_LABEL: Record<ThemePref, string> = { light: "Light", dark: "Dark", system: "Match system" };

function MenuRow({ icon, check, danger, onClick, children }: {
  icon?: string;
  check?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" role="menuitem" className={`hdr-menu-item${danger ? " danger" : ""}`} onClick={onClick}>
      {children}
      <span className="tail">{check ? <Icon name="check" size={14} className="chk" /> : icon ? <Icon name={icon} size={14} /> : null}</span>
    </button>
  );
}

// ponytail: the only shortcuts the app has (GlobalSearch, useDismiss, GridFooter) — extend this list when one is added.
const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl K", "Search anywhere"],
  ["↑ ↓ Enter", "Move through search results, open one"],
  ["Esc", "Close a menu, search or dialog"],
  ["Tab · Enter", "Walk a grid head and sort a column"],
];

function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const panelRef = useModalA11y(onClose);
  return (
    <div className="modal-backdrop" style={{ zIndex: 200, alignItems: "center" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel card" ref={panelRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ maxWidth: 380 }}>
        <div className="card-head"><div className="card-title">Keyboard shortcuts</div></div>
        <dl className="keys">
          {SHORTCUTS.map(([k, what]) => (
            <Fragment key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function UserMenu({ user }: { user: SessionUser | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState(false);
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const navigate = useNavigate();
  useDismiss(ref, open, () => setOpen(false));
  // Page tours replay from here too — only offered on a page that has one.
  const pageTour = AUTO_TOURS[useLocation().pathname];
  const isAdmin = user?.role === "Admin";

  const initials = (user?.name || "BG")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="rail-user" ref={ref} data-tour="usermenu">
      {open && (
        <div className="hdr-menu rail-menu" role="menu">
          {isAdmin && <MenuRow icon="settings" onClick={run(() => navigate("/settings"))}>Settings</MenuRow>}
          <MenuRow icon="keyboard" onClick={run(() => setKeys(true))}>Keyboard shortcuts</MenuRow>
          <MenuRow icon="flag" onClick={run(() => startTour())}>Take a tour</MenuRow>
          {pageTour && <MenuRow icon="flag" onClick={run(() => startTour(pageTour))}>Page guide</MenuRow>}
          <div className="hdr-menu-sep" />
          {(["light", "dark", "system"] as ThemePref[]).map((p) => (
            <MenuRow key={p} check={pref === p} onClick={() => { setThemePref(p); setPref(p); }}>
              {THEME_LABEL[p]}
            </MenuRow>
          ))}
          <div className="hdr-menu-sep" />
          <MenuRow icon="log-out" danger onClick={() => signOut()}>Sign out</MenuRow>
        </div>
      )}
      <button
        type="button"
        className="rail-user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        title={user ? `${user.name} (${user.role || "no role"})` : "Account"}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="av lg">
          {initials}
          <span className="presence online" />
        </span>
        <span className="rail-user-text">
          <b>{user?.name || "Signed in"}</b>
          <small>{user?.role || "no role"}</small>
        </span>
        <Icon name="chev-d" size={14} className="chev" />
      </button>
      {keys && <ShortcutsSheet onClose={() => setKeys(false)} />}
    </div>
  );
}
