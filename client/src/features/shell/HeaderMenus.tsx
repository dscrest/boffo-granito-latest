/* ============================================================
   Header menus — Notification bell + User avatar dropdown.
   Both live in the app header (App.tsx). Each owns its open
   state and closes on outside-click / Esc.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { list } from "@/lib/dataOps";
import { actorName, describeChange, parseDbTime } from "@/lib/format";
import { signOut, storedAuth, type SessionUser } from "@/lib/auth";

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
  const [lastSeen, setLastSeen] = useState<string>(() => sessionStorage.getItem(SEEN_KEY) || "");
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
            const verb = OP_VERB[op] || op.toLowerCase() || "changed";
            // The verb is already in the sentence — keep only what describeChange adds beyond it.
            const detail = describeChange(str(r.operation), str(r.payload_summary)).replace(/^(Created|Updated|Deleted)\s*/, "");
            const summary = detail && detail !== "—" ? detail : r.entity_rowid ? `#${str(r.entity_rowid)}` : "";
            return {
              id: str(r.ROWID),
              occurredAt: str(r.occurred_at),
              when: rel(str(r.occurred_at)),
              text: `${actorName(str(r.actor))} ${verb} ${str(r.table_name)}${summary ? ` · ${summary}` : ""}`,
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
    if (next) {
      fetchItems();
      // Mark everything seen as of now.
      const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
      sessionStorage.setItem(SEEN_KEY, stamp);
      setLastSeen(stamp);
    }
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
                    className="hdr-menu-row"
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
          <div className="hdr-menu-head">Recent activity</div>
          {loading && items.length === 0 ? (
            <div className="hdr-menu-empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="hdr-menu-empty">No recent activity</div>
          ) : (
            <div className="hdr-menu-list">
              {items.map((n) => (
                <div className="hdr-menu-row" key={n.id}>
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

/* ---------------- User avatar menu ---------------- */

export function UserMenu({ user }: { user: SessionUser | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, open, () => setOpen(false));

  const initials = (user?.name || "BG")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="hdr-pop" ref={ref}>
      <div
        className="avatar"
        role="button"
        tabIndex={0}
        title={user ? `${user.name} (${user.role || "no role"})` : "Account"}
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
      >
        {initials}
      </div>
      {open && (
        <div className="hdr-menu" style={{ width: 220, right: 0 }}>
          <div className="hdr-menu-user">
            <div className="hdr-menu-user-name">{user?.name || "Signed in"}</div>
            <div className="hdr-menu-user-sub">{user?.email || ""}</div>
            <div className="hdr-menu-user-sub">{user?.role || "no role"}</div>
          </div>
          <button className="hdr-menu-item" onClick={() => signOut()}>
            <Icon name="log-out" size={13} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
