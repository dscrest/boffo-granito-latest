/* ============================================================
   Users (Settings) — admin-only management of app sign-in accounts
   (AppUser table) via the data-ops /auth/users endpoints. Follows
   the master-page UI convention: row-click opens the editor.
   Roles control feature visibility + update/delete rights.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";

interface UserRow {
  rowid: string;
  email: string;
  name: string;
  active: boolean;
  role: string | null;
  roleName: string;
  createdTime: string;
  modifiedTime: string;
}

interface RoleOption {
  rowid: string;
  name: string;
  can_update: boolean;
  can_delete: boolean;
}

interface Draft {
  rowid: string | null; // null = new user
  email: string;
  name: string;
  password: string; // blank on edit = keep current
  role: string;
  active: boolean;
}

const EMPTY: Draft = { rowid: null, email: "", name: "", password: "", role: "", active: true };

const dash = <span className="dim">—</span>;

// Toggleable + reorderable columns.
const USER_COLUMNS: ColumnDef<UserRow>[] = [
  { key: "email", label: "Email", className: "mono", render: (u) => <span style={{ color: "var(--fg)" }}>{u.email}</span> },
  { key: "name", label: "Name", render: (u) => u.name || dash },
  {
    key: "role",
    label: "Role",
    render: (u) => (u.roleName ? <span className="chip">{u.roleName}</span> : <span className="dim">no role</span>),
  },
  {
    key: "status",
    label: "Status",
    render: (u) =>
      u.active ? (
        <span className="chip" style={{ color: "var(--c-green)" }}>active</span>
      ) : (
        <span className="chip" style={{ color: "var(--dim)" }}>disabled</span>
      ),
  },
  { key: "created", label: "Created", className: "muted mono", render: (u) => fmtDateTime(u.createdTime) },
  { key: "modified", label: "Modified", className: "muted mono", render: (u) => fmtDateTime(u.modifiedTime) },
];

export function UsersAdmin() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [roleF, setRoleF] = useState("");
  const { ordered, visible, hidden, toggle, move } = useColumns("usersTableColumns", USER_COLUMNS, ["created", "modified"]);

  const load = async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        apiGet<{ users: UserRow[] }>("data-ops/auth/users"),
        apiGet<{ roles: RoleOption[] }>("data-ops/auth/roles"),
      ]);
      setUsers(u.users);
      setRoles(r.roles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSave = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.rowid) {
        await apiPatch(`data-ops/auth/users/${draft.rowid}`, {
          name: draft.name,
          role: draft.role || null,
          active: draft.active,
          ...(draft.password ? { password: draft.password } : {}),
        });
        toast.success("User updated");
      } else {
        await apiPost("data-ops/auth/users", {
          email: draft.email,
          name: draft.name,
          password: draft.password,
          role: draft.role || null,
        });
        toast.success("User created");
      }
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleF && (u.role || "") !== roleF) return false;
      if (!q) return true;
      return `${u.email} ${u.name}`.toLowerCase().includes(q);
    });
  }, [users, query, roleF]);
  const pager = usePagination(filtered.length, "usersPageSize", `${query}|${roleF}`);

  const valid =
    draft &&
    (draft.rowid
      ? // edit: password optional, but if set must be >= 6 chars
        draft.password.length === 0 || draft.password.length >= 6
      : draft.email.includes("@") && draft.password.length >= 6);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Users</div>
          <div className="sub">{loading ? "Loading…" : "Roles control feature access"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="plus" size={13} />
            New user
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {draft && (
        <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="form-section-title" style={{ marginBottom: 14 }}>
            <Icon name={draft.rowid ? "settings" : "plus"} size={13} className="ic" />
            {draft.rowid ? `Edit ${draft.email}` : "New user"}
          </div>
          <div className="form-grid">
            {!draft.rowid && (
              <label className="form-field">
                <span className="lbl">
                  Email<span className="req"> *</span>
                </span>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="user@company.com"
                />
              </label>
            )}
            <label className="form-field">
              <span className="lbl">Name</span>
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="form-field">
              <span className="lbl">
                {draft.rowid ? "New password (blank = unchanged)" : "Password"}
                {!draft.rowid && <span className="req"> *</span>}
              </span>
              <input
                type="password"
                value={draft.password}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                placeholder="min 6 characters"
              />
            </label>
            <label className="form-field">
              <span className="lbl">Role</span>
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                <option value="">— no role (no access) —</option>
                {roles.map((r) => (
                  <option key={r.rowid} value={r.rowid}>
                    {r.name}
                    {r.can_delete ? " (full)" : r.can_update ? " (no delete)" : " (read-only)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span className="lbl">Status</span>
              <select
                value={draft.active ? "1" : "0"}
                onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })}
              >
                <option value="1">Active</option>
                <option value="0">Disabled (cannot sign in)</option>
              </select>
            </label>
          </div>
          <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <span className="df-req-note">* Indicates a mandatory field</span>
            <button className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="hbtn primary" disabled={!valid || busy} onClick={() => void onSave()}>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <select value={roleF} onChange={(e) => setRoleF(e.target.value)} title="Filter by role">
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.rowid} value={r.rowid}>
              {r.name}
            </option>
          ))}
        </select>
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search email, name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && users.length === 0 ? (
            <SkeletonRows rows={4} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  {visible.map((c) => (
                    <th key={c.key} style={c.style}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.slice(filtered).map((u) => (
                  <tr
                    key={u.rowid}
                    tabIndex={0}
                    onClick={() =>
                      setDraft({
                        rowid: u.rowid,
                        email: u.email,
                        name: u.name,
                        password: "",
                        role: u.role || "",
                        active: u.active,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget)
                        setDraft({ rowid: u.rowid, email: u.email, name: u.name, password: "", role: u.role || "", active: u.active });
                    }}
                    style={{ cursor: "pointer" }}
                    title="Edit user"
                  >
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(u)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && users.length === 0 && (
                  <tr>
                    <td colSpan={visible.length}>
                      <EmptyState icon="users" title="No users" hint="Click New user to add one." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && users.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
