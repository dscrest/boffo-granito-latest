/* ============================================================
   RecordDetail — shared read-only record page (Books-parity).

   Generic version of the Quotes detail page, reused by Customers,
   Sales Orders, Purchase Orders and Items. Renders a back/title
   toolbar, a Fields show/hide menu, and Details | Activity Log tabs.
   `children` is the record's line-items / related table. Activity Log
   reads OperationLog filtered by `activityTable` (+ optional entityId).
   ============================================================ */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { list, type DSRow } from "@/lib/dataOps";
import { fmtDateTime, fmtLocalDateTime, fmtDuration, parseDbTime, actorName, describeChange, opLabel } from "@/lib/format";

const str = (v: unknown) => (v == null ? "" : String(v));

export interface RecordField {
  key: string;
  label: string;
  value: string;
  wide?: boolean;
}

/** OperationLog history for one table (optionally one row) — the app's audit
    trail. Shared by RecordDetail's Activity tab and ItemDetail. */
export function ActivityLog({ table, entityId }: { table: string; entityId?: string }) {
  const [acts, setActs] = useState<DSRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void list("OperationLog", { order: "ROWID desc", limit: 200 }).then((res) => {
      if (!alive) return;
      setLoading(false);
      setActs(
        (res.rows || []).filter((r) => {
          if (str(r.table_name) !== table) return false;
          return entityId ? str(r.entity_rowid) === entityId : true;
        }),
      );
    });
    return () => {
      alive = false;
    };
  }, [table, entityId]);

  return (
    <div className="card">
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Operation</th>
              <th>User</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {acts.map((r) => {
              const ok = str(r.status) === "success";
              const detail = ok ? describeChange(str(r.operation), str(r.payload_summary)) : str(r.error_text);
              return (
                <tr key={String(r.ROWID)}>
                  <td className="muted">{fmtLocalDateTime(str(r.occurred_at) || str(r.CREATEDTIME))}</td>
                  <td>{opLabel(str(r.operation))}</td>
                  <td className="muted">{actorName(str(r.actor))}</td>
                  <td className="muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={detail}>
                    {ok ? detail : <span style={{ color: "var(--c-red)" }}>{detail}</span>}
                  </td>
                </tr>
              );
            })}
            {!loading && acts.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>
                  No activity recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** StatusTransition history for one record — every status/stage flip with
    who, when, and how long the record sat in the previous status (the
    Jira-style transition view). Mounted above ActivityLog on detail pages. */
export function StatusTimeline({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [rows, setRows] = useState<DSRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void list("StatusTransition", { order: "ROWID desc", limit: 300 }).then((res) => {
      if (!alive) return;
      setLoading(false);
      setRows(
        (res.rows || []).filter(
          (r) => str(r.entity_type) === entityType && str(r.entity_rowid) === entityId,
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [entityType, entityId]);

  if (!loading && rows.length === 0) return null; // nothing to show — legacy records

  // rows are newest-first; the "time in previous status" for row i is the
  // gap to the next-older transition (i+1).
  const timeOf = (r: DSRow) => parseDbTime(str(r.occurred_at) || str(r.CREATEDTIME));
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="form-section-title" style={{ padding: "12px 16px 0" }}>Status Timeline</div>
      <div style={{ overflow: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Time</th>
              <th>Transition</th>
              <th>Time in Previous Status</th>
              <th>User</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const older = rows[i + 1];
              const gap = older ? timeOf(r) - timeOf(older) : NaN;
              return (
                <tr key={String(r.ROWID)}>
                  <td className="muted">{fmtLocalDateTime(str(r.occurred_at) || str(r.CREATEDTIME))}</td>
                  <td className="mono">
                    {str(r.from_status) || "—"} → {str(r.to_status)}
                  </td>
                  <td className="muted mono">{older ? fmtDuration(gap) : "—"}</td>
                  <td className="muted">{actorName(str(r.actor))}</td>
                  <td className="muted" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={str(r.note)}>
                    {str(r.note) || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RecordDetail({
  backTo,
  title,
  subtitle,
  statusChip,
  fields,
  hiddenStorageKey,
  defaultHidden,
  activityTable,
  entityId,
  created,
  modified,
  actions,
  children,
}: {
  backTo: string;
  title: string;
  subtitle?: ReactNode;
  statusChip?: { label: string; cls: string; title?: string };
  /** Header action buttons (e.g. status transitions), right-aligned. */
  actions?: ReactNode;
  fields: RecordField[];
  hiddenStorageKey: string;
  /** Field keys hidden until the user picks their own set via Fields. */
  defaultHidden?: string[];
  activityTable?: string; // OperationLog table_name; omit → no Activity tab
  entityId?: string; // when set, Activity also matches entity_rowid
  created?: string; // raw CREATEDTIME — appended as a "Created" field
  modified?: string; // raw MODIFIEDTIME — appended as a "Modified" field
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"details" | "activity">("details");
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : defaultHidden || []);
    } catch {
      return new Set(defaultHidden || []);
    }
  });

  const toggleField = (key: string) => {
    const next = new Set(hidden);
    next.has(key) ? next.delete(key) : next.add(key);
    setHidden(next);
    localStorage.setItem(hiddenStorageKey, JSON.stringify([...next]));
  };

  const allFields = useMemo(() => {
    const extra: RecordField[] = [];
    if (created) extra.push({ key: "CREATEDTIME", label: "Created", value: fmtDateTime(created) });
    if (modified) extra.push({ key: "MODIFIEDTIME", label: "Modified", value: fmtDateTime(modified) });
    return [...fields, ...extra];
  }, [fields, created, modified]);
  const visible = useMemo(() => allFields.filter((f) => !hidden.has(f.key)), [allFields, hidden]);

  return (
    <div>
      {/* Header actions are RIGHT-aligned — same as QuoteDetail/ItemDetail
          (user mandate 2026-07-13: identical design on every detail page). */}
      <div className="page-head">
        <div className="row" style={{ gap: 10, alignItems: "center", flex: 1, minWidth: 0 }}>
          <button className="hbtn" onClick={() => navigate(backTo)} title="Back">
            <Icon name="chev-l" size={13} />
          </button>
          <div>
            <div className="title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {title}
              {statusChip && <span className={`chip qstatus ${statusChip.cls}`} title={statusChip.title}>{statusChip.label}</span>}
            </div>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
        </div>
        {actions && <div className="right">{actions}</div>}
      </div>

      <div className="row" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
        <button onClick={() => setTab("details")} style={tabStyle(tab === "details")}>Details</button>
        {activityTable && (
          <button onClick={() => setTab("activity")} style={tabStyle(tab === "activity")}>Activity Log</button>
        )}
        <div style={{ marginLeft: "auto", position: "relative" }}>
          {tab === "details" && (
            <>
              <button className="hbtn" onClick={() => setFieldsOpen((v) => !v)} title="Show / hide fields">
                <Icon name="settings" size={13} /> Fields
              </button>
              {fieldsOpen && (
                <div className="card" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 30, padding: 8, width: 220, maxHeight: 320, overflow: "auto" }}>
                  {allFields.map((f) => (
                    <label key={f.key} className="row" style={{ gap: 8, padding: "4px 6px", cursor: "pointer" }}>
                      <input type="checkbox" checked={!hidden.has(f.key)} onChange={() => toggleField(f.key)} />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {tab === "details" && (
        <>
          <div className="card" style={{ padding: 18, marginBottom: 12 }}>
            <div className="form-grid">
              {visible.map((f) => (
                <div className="form-field" key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                  <span className="lbl">{f.label}</span>
                  <span style={{ color: "var(--fg)" }}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
          {children}
        </>
      )}

      {tab === "activity" && activityTable && (
        <>
          {/* StatusTransition entity_type === table name; renders null when empty. */}
          {entityId && <StatusTimeline entityType={activityTable} entityId={entityId} />}
          <ActivityLog table={activityTable} entityId={entityId} />
        </>
      )}
    </div>
  );
}

function tabStyle(active: boolean) {
  return {
    background: "none",
    border: 0,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    padding: "8px 12px",
    cursor: "pointer",
    font: "inherit",
  } as const;
}
