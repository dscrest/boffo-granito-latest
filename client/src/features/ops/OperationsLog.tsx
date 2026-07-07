/* ============================================================
   Operations log — read-only view of the OperationLog table. Every
   insert / update / delete / convert performed through the data-ops
   function records its outcome here (success / failed + error +
   duration), so operation status can be checked from the UI.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, usePagination } from "@/ui/GridFooter";
import { fmt } from "@/lib/format";
import { list, type DSRow } from "@/lib/dataOps";

const str = (v: unknown) => (v == null ? "" : String(v));

// Toggleable + reorderable columns (Time pinned outside the map).
// occurred_at already carries the row timestamp, so no Created/Modified here.
const OPS_COLUMNS: ColumnDef<DSRow>[] = [
  { key: "table", label: "Table", className: "mono", render: (r) => str(r.table_name) },
  { key: "operation", label: "Operation", render: (r) => str(r.operation) },
  {
    key: "status",
    label: "Status",
    render: (r) => {
      const status = str(r.status);
      return <span className={`chip qstatus ${status === "success" ? "q-converted" : "q-rejected"}`}>{status || "—"}</span>;
    },
  },
  { key: "ms", label: "ms", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(Number(r.duration_ms) || 0) },
  { key: "row", label: "Row", className: "mono muted", render: (r) => str(r.entity_rowid) || "—" },
  { key: "actor", label: "Actor", className: "muted", render: (r) => str(r.actor) },
  {
    key: "detail",
    label: "Detail / Error",
    className: "muted",
    style: { maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
    render: (r) =>
      str(r.status) === "success" ? str(r.payload_summary) : <span style={{ color: "var(--c-red)" }}>{str(r.error_text)}</span>,
  },
];

export function OperationsLog() {
  const [rows, setRows] = useState<DSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [opF, setOpF] = useState("");
  const { ordered, visible, hidden, toggle, move } = useColumns("opsTableColumns", OPS_COLUMNS, []);

  const load = async () => {
    setLoading(true);
    const res = await list("OperationLog", { order: "ROWID desc", limit: 200 });
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load operations log");
      return;
    }
    setError(null);
    setRows(res.rows || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const okCount = rows.filter((r) => str(r.status) === "success").length;
  const failCount = rows.filter((r) => str(r.status) === "failed").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (opF && str(r.operation) !== opF) return false;
      if (!q) return true;
      return `${str(r.table_name)} ${str(r.actor)} ${str(r.payload_summary)} ${str(r.error_text)}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, opF]);
  const pager = usePagination(filtered.length, "opsPageSize", `${query}|${opF}`);
  const opOptions = useMemo(() => [...new Set(rows.map((r) => str(r.operation)).filter(Boolean))].sort(), [rows]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Audit Log</div>
          <div className="sub">
            {loading ? "Loading…" : `${okCount} ok · ${failCount} failed`}
          </div>
        </div>
        <div className="right">
          <button className="hbtn" onClick={() => void load()} title="Refresh">
            <Icon name="clock" size={13} />
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorCard message={error} onRetry={() => void load()} />}

      <div className="fbar">
        <div style={{ flex: 1 }} />
        <select value={opF} onChange={(e) => setOpF(e.target.value)} title="Filter by operation">
          <option value="">All operations</option>
          {opOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Search table, actor, detail…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                {visible.map((c) => (
                  <th key={c.key} style={c.style}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice(filtered).map((r) => (
                <tr key={String(r.ROWID)}>
                  <td className="mono muted">{str(r.occurred_at) || str(r.CREATEDTIME)}</td>
                  {visible.map((c) => (
                    <td key={c.key} className={c.className} style={c.style}>
                      {c.render!(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={visible.length + 1}>
                    <EmptyState
                      icon="docs"
                      title="No operations logged yet"
                      hint="Writes performed through the app are recorded here"
                    />
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
