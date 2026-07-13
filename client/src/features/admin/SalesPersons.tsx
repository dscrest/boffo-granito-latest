/* ============================================================
   Sales Persons (Settings) — the reps shown on Quotations / Sales
   Orders. AUTO-MANAGED: every AppUser gets a SalesPerson row,
   synced on each login (name/email/active mirror the user). Only
   the rep-specific fields (mobile, region) are editable here.
   Backed by the generic /data-ops/SalesPerson CRUD; user names
   resolve via /data-ops/auth/users.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import {
  listSalesPersons,
  updateSalesPerson,
  type SalesPersonRow,
} from "@/features/masters/salespersonApi";

interface AppUserOption {
  rowid: string;
  email: string;
  name: string;
}

interface Draft {
  rowid: string;
  name: string;
  email: string;
  phone: string;
  region: string;
  active: boolean;
  app_user: string; // AppUser ROWID (auto-linked)
}

const dash = <span className="dim">—</span>;

export function SalesPersonsAdmin() {
  const [rows, setRows] = useState<SalesPersonRow[]>([]);
  const [users, setUsers] = useState<AppUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusF, setStatusF] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [sp, u] = await Promise.all([
        listSalesPersons(),
        apiGet<{ users: AppUserOption[] }>("data-ops/auth/users"),
      ]);
      if (!sp.ok) throw new Error(sp.error || "Failed to load sales persons");
      setRows(sp.salesPersons);
      setUsers(u.users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const userName = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.rowid, u.name || u.email));
    return m;
  }, [users]);

  // Toggleable + reorderable columns (# pinned outside the map). Defined in
  // the component because "Linked user" resolves names via the users map.
  const spColumns = useMemo<ColumnDef<SalesPersonRow>[]>(
    () => [
      { key: "name", label: "Name", render: (s) => <span style={{ color: "var(--fg)" }}>{s.name}</span> },
      { key: "email", label: "Email", render: (s) => s.email || dash },
      { key: "mobile", label: "Mobile", render: (s) => s.phone || dash },
      { key: "region", label: "Region", render: (s) => s.region || dash },
      {
        key: "linkedUser",
        label: "Linked user",
        render: (s) =>
          userName.get(s.appUserId) ? <span className="chip">{userName.get(s.appUserId)}</span> : <span className="dim">unlinked</span>,
      },
      {
        key: "status",
        label: "Status",
        render: (s) =>
          s.active ? (
            <span className="chip" style={{ color: "var(--c-green)" }}>active</span>
          ) : (
            <span className="chip" style={{ color: "var(--dim)" }}>inactive</span>
          ),
      },
      { key: "created", label: "Created", className: "muted mono", render: (s) => fmtDateTime(s.createdTime) },
      { key: "modified", label: "Modified", className: "muted mono", render: (s) => fmtDateTime(s.modifiedTime) },
    ],
    [userName],
  );
  const { ordered, visible, hidden, toggle, move } = useColumns("salesPersonsTableColumns", spColumns, ["created", "modified"]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((s) => {
      if (statusF && (statusF === "active") !== s.active) return false;
      if (!q) return true;
      return `${s.name} ${s.email} ${s.region}`.toLowerCase().includes(q);
    });
  }, [rows, query, statusF]);
  const pager = usePagination(filtered.length, "salesPersonsPageSize", `${query}|${statusF}`);

  // Auto-managed: only the rep-specific fields (mobile, region) are saved here;
  // name/email/active/link mirror the AppUser via the login sync.
  const onSave = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await updateSalesPerson(draft.rowid, {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        region: draft.region,
        active: draft.active,
        app_user: draft.app_user,
      });
      toast.success("Sales person updated");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Sales Persons</div>
          <div className="sub">{loading ? "Loading…" : "Auto-managed from Users — one rep per app user"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {draft && (
        <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="form-section-title" style={{ marginBottom: 14 }}>
            <Icon name="settings" size={13} className="ic" />
            {`Edit ${draft.name}`}
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span className="lbl">Linked user (auto)</span>
              <input value={userName.get(draft.app_user) || draft.email || "—"} disabled />
            </label>
            <label className="form-field">
              <span className="lbl">Name (from user)</span>
              <input value={draft.name} disabled />
            </label>
            <label className="form-field">
              <span className="lbl">Email (from user)</span>
              <input type="email" value={draft.email} disabled />
            </label>
            <label className="form-field">
              <span className="lbl">Mobile</span>
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+91…" />
            </label>
            <label className="form-field">
              <span className="lbl">Region</span>
              <input value={draft.region} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="Territory / market" />
            </label>
            <label className="form-field">
              <span className="lbl">Status (from user)</span>
              <input value={draft.active ? "Active" : "Inactive"} disabled />
            </label>
          </div>
          <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <span className="df-req-note">Name, email &amp; status follow the linked app user</span>
            <button className="btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button className="hbtn primary" disabled={busy} onClick={() => void onSave()}>
              <Icon name="check" size={13} />
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} title="Filter by status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Search name, email, region…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={4} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: "center" }}>#</th>
                  {visible.map((c) => (
                    <th key={c.key} style={c.style}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.slice(filtered).map((s, i) => (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    onClick={() =>
                      setDraft({
                        rowid: s.id,
                        name: s.name,
                        email: s.email,
                        phone: s.phone,
                        region: s.region,
                        active: s.active,
                        app_user: s.appUserId,
                      })
                    }
                    style={{ cursor: "pointer" }}
                    title="Edit sales person"
                  >
                    <td className="muted mono" style={{ textAlign: "center" }}>{pager.from + i}</td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(s)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1}>
                      <EmptyState icon="users" title="No sales persons" hint="Reps appear automatically when app users sign in." />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
