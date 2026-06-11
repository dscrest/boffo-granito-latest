/* ============================================================
   Operations log — read-only view of the OperationLog table. Every
   insert / update / delete / convert performed through the data-ops
   function records its outcome here (success / failed + error +
   duration), so operation status can be checked from the UI.
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { fmt } from "@/lib/format";
import { list, type DSRow } from "@/lib/dataOps";

const str = (v: unknown) => (v == null ? "" : String(v));

export function OperationsLog() {
  const [rows, setRows] = useState<DSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="title">Audit Log</div>
          <div className="sub">
            {loading ? "Loading…" : `${rows.length} recent operations · ${okCount} ok · ${failCount} failed`}
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

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Table</th>
                <th>Operation</th>
                <th>Status</th>
                <th className="num" style={{ textAlign: "right" }}>ms</th>
                <th>Row</th>
                <th>Actor</th>
                <th>Detail / Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = str(r.status);
                const ok = status === "success";
                return (
                  <tr key={String(r.ROWID)}>
                    <td className="mono muted">{str(r.occurred_at) || str(r.CREATEDTIME)}</td>
                    <td className="mono">{str(r.table_name)}</td>
                    <td>{str(r.operation)}</td>
                    <td>
                      <span className={`chip qstatus ${ok ? "q-converted" : "q-rejected"}`}>{status || "—"}</span>
                    </td>
                    <td className="num mono">{fmt(Number(r.duration_ms) || 0)}</td>
                    <td className="mono muted">{str(r.entity_rowid) || "—"}</td>
                    <td className="muted">{str(r.actor)}</td>
                    <td className="muted" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ok ? str(r.payload_summary) : <span style={{ color: "var(--c-red)" }}>{str(r.error_text)}</span>}
                    </td>
                  </tr>
                );
              })}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
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
      </div>
    </div>
  );
}
