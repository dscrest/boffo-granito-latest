/* ============================================================
   Roles (Settings) — admin-only role management (Role table) via the
   data-ops /auth/roles endpoints. Row-click opens the editor with the
   per-module permission checkbox matrix + approval rights. The Admin
   role is locked server-side; it renders read-only here.
   Settings pages themselves stay Admin-only routes, so no matrix row.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { PermAction, PermModule } from "@/lib/auth";

interface RoleRow {
  rowid: string;
  name: string;
  matrix: Record<string, string[]>;
  approve: string[];
  users: number;
  locked: boolean;
}

interface Draft {
  rowid: string | null; // null = new role
  name: string;
  locked: boolean;
  users: number;
  matrix: Record<string, Set<string>>;
  approve: Set<string>;
}

const MODULES: { key: PermModule; label: string }[] = [
  { key: "quotes", label: "Quotes" },
  { key: "orders", label: "Sales Orders" },
  { key: "customers", label: "Customers" },
  { key: "items", label: "Items & Masters" },
  { key: "stages", label: "Production / Stages" },
  { key: "invoices", label: "Invoices" },
  { key: "reports", label: "Reports" },
];
const ACTIONS: { key: PermAction; label: string }[] = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "export", label: "Export" },
];
const APPROVABLES: { key: string; label: string }[] = [
  { key: "Quote", label: "Quotations" },
  { key: "SalesOrder", label: "Sales Orders" },
  { key: "Production", label: "Production Requests" },
];

function toDraft(r: RoleRow): Draft {
  const matrix: Record<string, Set<string>> = {};
  for (const m of MODULES) matrix[m.key] = new Set(r.matrix[m.key] ?? []);
  return { rowid: r.rowid, name: r.name, locked: r.locked, users: r.users, matrix, approve: new Set(r.approve) };
}

function emptyDraft(): Draft {
  const matrix: Record<string, Set<string>> = {};
  for (const m of MODULES) matrix[m.key] = new Set();
  return { rowid: null, name: "", locked: false, users: 0, matrix, approve: new Set() };
}

function payload(d: Draft) {
  const modules: Record<string, string[]> = {};
  for (const m of MODULES) {
    const acts = ACTIONS.map((a) => a.key).filter((a) => d.matrix[m.key].has(a));
    if (acts.length) modules[m.key] = acts;
  }
  return { modules, approve: APPROVABLES.map((a) => a.key).filter((k) => d.approve.has(k)) };
}

/* One-line summary for the grid, e.g. "Quotes (all), Customers (view, edit)". */
function summarize(r: RoleRow): string {
  if (r.locked) return "Full access";
  const parts = MODULES.filter((m) => (r.matrix[m.key] ?? []).length).map((m) => {
    const acts = r.matrix[m.key];
    return acts.length === ACTIONS.length ? `${m.label} (all)` : `${m.label} (${acts.join(", ")})`;
  });
  return parts.length ? parts.join(", ") : "No access";
}

export function RolesAdmin() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ roles: RoleRow[] }>("data-ops/auth/roles");
      setRoles(r.roles);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roles");
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
      const body = { name: draft.name.trim(), matrix: payload(draft) };
      if (draft.rowid) {
        await apiPatch(`data-ops/auth/roles/${draft.rowid}`, body);
        toast.success("Role updated — users get the new permissions on their next sign-in or reload");
      } else {
        await apiPost("data-ops/auth/roles", body);
        toast.success("Role created");
      }
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!draft?.rowid) return;
    if (!(await confirmDialog({ message: `Delete the role “${draft.name}”?`, danger: true }))) return;
    setBusy(true);
    try {
      await apiDelete(`data-ops/auth/roles/${draft.rowid}`);
      toast.success("Role deleted");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const setCell = (mod: PermModule, act: PermAction, on: boolean) => {
    if (!draft || draft.locked) return;
    const next = new Set(draft.matrix[mod]);
    if (on) {
      next.add(act);
      if (act !== "view") next.add("view"); // any right implies seeing the module
    } else {
      next.delete(act);
      if (act === "view") next.clear(); // no view = no access at all
    }
    setDraft({ ...draft, matrix: { ...draft.matrix, [mod]: next } });
  };

  const setRow = (mod: PermModule, on: boolean) => {
    if (!draft || draft.locked) return;
    const next = on ? new Set<string>(ACTIONS.map((a) => a.key)) : new Set<string>();
    setDraft({ ...draft, matrix: { ...draft.matrix, [mod]: next } });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? roles.filter((r) => r.name.toLowerCase().includes(q)) : roles;
  }, [roles, query]);

  const valid = draft && draft.name.trim().length > 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Roles</div>
          <div className="sub">{loading ? "Loading…" : "Per-module permissions and approval rights"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setDraft(emptyDraft())}>
            <Icon name="plus" size={13} />
            New role
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {draft && (
        <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="form-section-title" style={{ marginBottom: 14 }}>
            <Icon name={draft.rowid ? "settings" : "plus"} size={13} className="ic" />
            {draft.locked ? `${draft.name} (locked)` : draft.rowid ? `Edit ${draft.name}` : "New role"}
          </div>
          {draft.locked ? (
            <div className="muted" style={{ marginBottom: 8 }}>
              The Admin role always has full access to everything and cannot be edited or deleted.
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label className="form-field">
                  <span className="lbl">
                    Role name<span className="req"> *</span>
                  </span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Manager"
                  />
                </label>
              </div>

              <div style={{ overflow: "auto", marginTop: 10 }}>
                <table className="tbl" style={{ maxWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a.key} style={{ textAlign: "center", width: 70 }}>{a.label}</th>
                      ))}
                      <th style={{ textAlign: "center", width: 56 }}>All</th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((m) => {
                      const acts = draft.matrix[m.key];
                      const all = ACTIONS.every((a) => acts.has(a.key));
                      return (
                        <tr key={m.key}>
                          <td>{m.label}</td>
                          {ACTIONS.map((a) => (
                            <td key={a.key} style={{ textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={acts.has(a.key)}
                                onChange={(e) => setCell(m.key, a.key, e.target.checked)}
                                aria-label={`${m.label}: ${a.label}`}
                              />
                            </td>
                          ))}
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={all}
                              onChange={(e) => setRow(m.key, e.target.checked)}
                              aria-label={`${m.label}: all actions`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14 }}>
                <div className="lbl" style={{ marginBottom: 6 }}>Can approve</div>
                <div style={{ display: "flex", gap: 18 }}>
                  {APPROVABLES.map((a) => (
                    <label key={a.key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={draft.approve.has(a.key)}
                        onChange={(e) => {
                          const next = new Set(draft.approve);
                          if (e.target.checked) next.add(a.key);
                          else next.delete(a.key);
                          setDraft({ ...draft, approve: next });
                        }}
                      />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {!draft.locked && <span className="df-req-note">* Indicates a mandatory field</span>}
            {draft.rowid && !draft.locked && (
              <button
                className="btn"
                disabled={busy || draft.users > 0}
                title={draft.users > 0 ? "Reassign its users first" : "Delete role"}
                onClick={() => void onDelete()}
                style={{ color: "var(--c-red)" }}
              >
                Delete
              </button>
            )}
            <button className="btn" onClick={() => setDraft(null)}>
              {draft.locked ? "Close" : "Cancel"}
            </button>
            {!draft.locked && (
              <button className="hbtn primary" disabled={!valid || busy} onClick={() => void onSave()}>
                <Icon name="check" size={13} />
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search roles…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && roles.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: "center" }}>#</th>
                  <th>Role</th>
                  <th style={{ width: 70, textAlign: "center" }}>Users</th>
                  <th style={{ width: 160 }}>Approves</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.rowid}
                    tabIndex={0}
                    onClick={() => setDraft(toDraft(r))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.target === e.currentTarget) setDraft(toDraft(r));
                    }}
                    style={{ cursor: "pointer" }}
                    title={r.locked ? "View role" : "Edit role"}
                  >
                    <td className="muted mono" style={{ textAlign: "center" }}>{i + 1}</td>
                    <td>
                      <span className="chip">{r.name}</span>
                      {r.locked && <Icon name="shield-check" size={12} style={{ marginLeft: 6, verticalAlign: -2 }} />}
                    </td>
                    <td className="mono" style={{ textAlign: "center" }}>{r.users}</td>
                    <td>
                      {r.locked
                        ? "Quotations, Sales Orders"
                        : APPROVABLES.filter((a) => r.approve.includes(a.key)).map((a) => a.label).join(", ") || (
                            <span className="dim">—</span>
                          )}
                    </td>
                    <td className="muted">{summarize(r)}</td>
                  </tr>
                ))}
                {!loading && roles.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon="users" title="No roles" hint="Click New role to add one." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
