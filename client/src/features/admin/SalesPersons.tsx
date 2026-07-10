/* ============================================================
   Sales Persons (Settings) — admin master of the reps shown on
   Quotations / Sales Orders. Each Sales Person wraps an existing
   AppUser (required link → access perms flow through the user's
   role). Follows the master-page UI convention: row-click edits.
   Backed by the generic /data-ops/SalesPerson CRUD; the user picker
   reads /data-ops/auth/users.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { Combobox } from "@/ui/Combobox";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { apiGet } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import {
  listSalesPersons,
  createSalesPerson,
  updateSalesPerson,
  deleteSalesPerson,
  type SalesPersonRow,
} from "@/features/masters/salespersonApi";

interface AppUserOption {
  rowid: string;
  email: string;
  name: string;
}

interface Draft {
  rowid: string | null; // null = new
  name: string;
  email: string;
  phone: string;
  region: string;
  active: boolean;
  app_user: string; // AppUser ROWID (required)
}

const EMPTY: Draft = { rowid: null, name: "", email: "", phone: "", region: "", active: true, app_user: "" };

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

  const userOptions = useMemo(
    () => users.map((u) => ({ value: u.rowid, label: u.name || u.email, hint: u.email })),
    [users],
  );

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

  const onPickUser = (rowid: string) => {
    if (!draft) return;
    const u = users.find((x) => x.rowid === rowid);
    setDraft({
      ...draft,
      app_user: rowid,
      // Default name/email from the user the first time, if blank.
      name: draft.name || (u?.name ?? ""),
      email: draft.email || (u?.email ?? ""),
    });
  };

  const onSave = async () => {
    if (!draft) return;
    if (!draft.app_user) {
      toast.error("Pick a linked user");
      return;
    }
    if (!draft.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    try {
      const input = {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        region: draft.region,
        active: draft.active,
        app_user: draft.app_user,
      };
      if (draft.rowid) {
        await updateSalesPerson(draft.rowid, input);
        toast.success("Sales person updated");
      } else {
        await createSalesPerson(input);
        toast.success("Sales person created");
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
    if (!(await confirmDialog({ message: `Are you sure you want to delete sales person "${draft.name}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    try {
      await deleteSalesPerson(draft.rowid);
      toast.success("Sales person removed");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Sales Persons</div>
          <div className="sub">{loading ? "Loading…" : "Shown on quotations & sales orders"}</div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
          <button className="hbtn primary" onClick={() => setDraft({ ...EMPTY })}>
            <Icon name="plus" size={13} />
            New sales person
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      {draft && (
        <div className="card form-section" style={{ marginBottom: 12, padding: 16, borderLeft: "3px solid var(--accent)" }}>
          <div className="form-section-title" style={{ marginBottom: 14 }}>
            <Icon name={draft.rowid ? "settings" : "plus"} size={13} className="ic" />
            {draft.rowid ? `Edit ${draft.name}` : "New sales person"}
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span className="lbl">
                Linked user<span className="req"> *</span>
              </span>
              <Combobox
                value={draft.app_user}
                options={userOptions}
                onChange={onPickUser}
                placeholder="Search a sign-in user…"
              />
            </label>
            <label className="form-field">
              <span className="lbl">
                Name<span className="req"> *</span>
              </span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Display name on documents" />
            </label>
            <label className="form-field">
              <span className="lbl">Email</span>
              <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
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
              <span className="lbl">Status</span>
              <select value={draft.active ? "1" : "0"} onChange={(e) => setDraft({ ...draft, active: e.target.value === "1" })}>
                <option value="1">Active</option>
                <option value="0">Inactive (hidden from pickers)</option>
              </select>
            </label>
          </div>
          <div className="right" style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <span className="df-req-note">* Indicates a mandatory field</span>
            {draft.rowid && (
              <button className="btn" style={{ color: "var(--c-red)" }} disabled={busy} onClick={() => void onDelete()}>
                Delete
              </button>
            )}
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
                      <EmptyState icon="users" title="No sales persons" hint="Click New sales person to add one." />
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
