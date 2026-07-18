/* ============================================================
   Production detail — one production (request_group), same split view as the
   Sales Order detail.

   Route: /prod/:id where :id is the request_group. Left: resizable, searchable
   list of productions. Right: header card (Production ID + status + boxes +
   Order/Independent chip), a More menu (Clone / Delete) and ✕ close. Tabs:
   Details (fields + the item lines that make up this production, with a
   per-line Record-output action + order progress) and Activity (status
   timeline + OperationLog per line). Reuses productionApi — no new backend.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { can } from "@/lib/auth";
import { MoreMenu } from "@/features/common/DetailBits";
import { ActivityLog } from "@/features/common/RecordDetail";
import { ProgressBar } from "@/ui/primitives";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { fmt, fmtDateTime, fmtLocalDate, pct } from "@/lib/format";
import { list, type DSRow } from "@/lib/dataOps";
import type { CSSProperties } from "react";
import { useMasters } from "@/features/masters/useMasters";
import { currentSalespersonName } from "@/features/masters/salespersonApi";
import { ProductionForm } from "./ProductionForm";
import { RecordOutputForm } from "./RecordOutputForm";
import { ProductionEditForm } from "./ProductionEditForm";
import { ProductionCompleteForm, type ProductionCompleteResult } from "./ProductionCompleteForm";
import {
  cachedProductionLogs,
  completeProduction,
  deleteProductionLog,
  groupProductionByOrder,
  invalidateProductionLogs,
  listProductionLogs,
  recordProduction,
  requestProduction,
  setProductionStage,
  stageChip,
  PRODUCTION_STAGE_ORDER,
  PRODUCTION_STAGE_META,
  type ProductionEntry,
  type ProductionStage,
  type ProductionRecordInput,
  type ProductionRequestGroup,
  type ProductionRequestInput,
} from "./productionApi";

type FieldDef = ColumnDef<ProductionRequestGroup> & { value: (g: ProductionRequestGroup) => string; wide?: boolean };
const FIELDS: FieldDef[] = [
  // Production ID omitted here — it's the page title.
  // Stage omitted — shown as the header chip, not repeated here.
  { key: "order", label: "Sales Order", value: (g) => (g.independent ? "Independent (stock)" : g.orderNumber || g.poNumber || "—") },
  { key: "customer", label: "Customer", value: (g) => g.customer || "—" },
  { key: "requested", label: "Requested (boxes)", value: (g) => fmt(g.totalRequested) },
  { key: "produced", label: "Produced (boxes)", value: (g) => (g.totalProduced ? fmt(g.totalProduced) : "—") },
  { key: "items", label: "Items", value: (g) => String(g.lineCount) },
  { key: "date", label: "Production Date", value: (g) => g.date || "—" },
  { key: "by", label: "Requested by", value: (g) => g.performedBy || "—" },
  { key: "created", label: "Created", value: (g) => fmtDateTime(g.createdTime) },
  { key: "modified", label: "Modified", value: (g) => fmtDateTime(g.modifiedTime) },
];

export function ProductionDetail() {
  const { id = "" } = useParams();
  const groupId = decodeURIComponent(id);
  const navigate = useNavigate();

  const [entries, setEntries] = useState<ProductionEntry[]>(() => cachedProductionLogs() ?? []);
  const [loading, setLoading] = useState(() => cachedProductionLogs() == null);
  const [tab, setTab] = useState<"details" | "prodlog" | "activity">("details");
  const [listQ, setListQ] = useState("");
  const [cloning, setCloning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [recordEntry, setRecordEntry] = useState<ProductionEntry | null>(null);
  // Remaining lines queued behind recordEntry when "Record all output" is used.
  const [recordQueue, setRecordQueue] = useState<ProductionEntry[]>([]);
  // Total lines in the current Record-all walk (0 = single-line record, no step shown).
  const [recordTotal, setRecordTotal] = useState(0);
  const [logItemFilter, setLogItemFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Completion capture dialog (opened when moving into Completed).
  const [completeOpen, setCompleteOpen] = useState(false);

  const { salesPersons } = useMasters();
  const loggedBy = useMemo(() => currentSalespersonName(salesPersons), [salesPersons]);
  const fields = useColumns("productionDetailFields", FIELDS);

  const groups = useMemo(
    () => groupProductionByOrder(entries).sort((a, b) => (b.createdTime > a.createdTime ? 1 : -1)),
    [entries],
  );
  const group = useMemo(() => groups.find((g) => g.group === groupId) ?? null, [groups, groupId]);

  const load = async () => {
    setLoading(true);
    const res = await listProductionLogs();
    setLoading(false);
    if (res.ok) setEntries(res.entries);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCloneSave = async (input: ProductionRequestInput) => {
    // Order-linked clones land back on the same SO's production; independent
    // clones get their own request-batch group (res.rowid = new request_group).
    const target = group && !group.independent ? group.group : undefined;
    setCloning(false);
    setBusy("Creating…");
    const res = await requestProduction(input);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    const total = input.lines.reduce((s, l) => s + l.qty_requested, 0);
    toast.success(`Production recorded — ${fmt(total)} boxes`);
    invalidateProductionLogs();
    // Independent clones key by their new request_group (groupProductionByOrder's
    // fallback), not the row id.
    const dest = target ?? res.data?.request_group ?? res.rowid;
    if (dest) navigate(`/prod/${encodeURIComponent(dest)}`);
    await load();
  };

  const onRecordSave = async (input: ProductionRecordInput) => {
    const entry = recordEntry;
    setRecordEntry(null);
    if (!entry) return;
    setBusy("Recording…");
    const res = await recordProduction(entry.id, input);
    if (!res.ok) {
      setBusy(null);
      setRecordQueue([]);
      setRecordTotal(0);
      toast.error(res.error || "Record output failed");
      await load();
      return;
    }
    toast.success(`+${fmt(input.qty_boxes)} boxes produced`);
    // "Record all" walks the queue — show the entry form for each remaining line
    // so the date / details can be set per line before recording.
    const [next, ...rest] = recordQueue;
    if (next) {
      setRecordQueue(rest);
      setBusy(null);
      setRecordEntry(next);
      return;
    }
    setBusy(null);
    setRecordTotal(0);
    invalidateProductionLogs();
    await load();
  };

  // Record every line still owing output — one entry form per line (so each keeps
  // its own date). Lines with nothing left to produce are skipped.
  const onRecordAll = () => {
    if (!group) return;
    const queue = group.entries.filter((e) => e.qtyRequested - e.producedSoFar > 0);
    if (queue.length === 0) {
      toast.error("No lines left to record");
      return;
    }
    setRecordQueue(queue.slice(1));
    setRecordTotal(queue.length);
    setRecordEntry(queue[0]);
  };

  const onStageChange = async (stage: ProductionStage) => {
    if (!group || stage === group.stage) return;
    // Completed captures actual produced first via a dialog.
    if (stage === "Completed") { setCompleteOpen(true); return; }
    setBusy("Moving…");
    const res = await setProductionStage(group.entries.map((e) => e.id), stage);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Could not change stage");
      return;
    }
    toast.success(`Moved to ${PRODUCTION_STAGE_META[stage].label}`);
    invalidateProductionLogs();
    await load();
  };

  const onCompleteSave = async (result: ProductionCompleteResult) => {
    setCompleteOpen(false);
    if (!group) return;
    setBusy("Completing…");
    const res = await completeProduction(result);
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error || "Could not complete production");
      return;
    }
    toast.success("Production completed");
    invalidateProductionLogs();
    await load();
  };

  const onEditSave = async () => {
    setEditing(false);
    invalidateProductionLogs();
    await load();
  };

  const onDelete = async () => {
    if (!group) return;
    const reversal = producedBoxes > 0 ? ` ${fmt(producedBoxes)} produced boxes will be subtracted from the order.` : "";
    if (!(await confirmDialog({ message: `Delete this production (${group.code} · ${fmt(group.totalRequested)} boxes requested · ${group.lineCount} item${group.lineCount > 1 ? "s" : ""})?${reversal} This cannot be undone.`, danger: true }))) return;
    setBusy("Deleting…");
    for (const e of group.entries) {
      const res = await deleteProductionLog(e.id);
      if (!res.ok) {
        setBusy(null);
        toast.error(res.error || "Delete failed");
        await load();
        return;
      }
    }
    toast.success("Production deleted");
    invalidateProductionLogs();
    navigate("/prod");
  };

  if (loading && !group) {
    return <div className="muted mono" style={{ padding: 24 }}>Loading production…</div>;
  }
  if (!group) {
    return (
      <div>
        <div className="page-head">
          <div>
            <div className="title">Production not found</div>
            <div className="sub">No production matches this link.</div>
          </div>
          <div className="right">
            <button className="hbtn" onClick={() => navigate("/prod")}>
              <Icon name="chev-l" size={13} /> Back to Production
            </button>
          </div>
        </div>
      </div>
    );
  }

  const needle = listQ.trim().toLowerCase();
  const listed = needle
    ? groups.filter((x) => `${x.code} ${x.designSummary} ${x.orderNumber} ${x.customer} ${x.performedBy}`.toLowerCase().includes(needle))
    : groups;

  // Deleting cascades server-side: a Produced order-linked line gives back its
  // OrderItem.produced bump. Blocked once any of the order's stock is palletised —
  // those boxes are downstream and can't be un-produced.
  const producedBoxes = group.totalProduced;
  const palletised = group.entries.some((e) => e.palletized > 0);
  const canRecord = can("stages", "edit");
  // A line is recordable until its records cover what was requested (and the
  // production isn't parked in Completed).
  const canRecordLine = (e: ProductionEntry) => e.qtyRequested - e.producedSoFar > 0 && group.stage !== "Completed";
  const hasRecordable = group.entries.some(canRecordLine);
  const recorded = group.records.length > 0;
  const moreItems = [
    ...(canRecord && hasRecordable ? [{ label: "Record all output", onClick: () => void onRecordAll() }] : []),
    // Editing requested qty is only safe before any output is recorded.
    ...(can("stages", "edit") && !recorded ? [{ label: "Edit", onClick: () => setEditing(true) }] : []),
    ...(can("stages", "edit") ? [{ label: "Clone", onClick: () => setCloning(true) }] : []),
    ...(can("stages", "delete") && !palletised ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {cloning && (
        <ProductionForm
          presetSalesOrderId={group.independent ? undefined : group.salesOrderId}
          presetDesignId={group.independent ? group.entries[0]?.designId : undefined}
          onSave={onCloneSave}
          onClose={() => setCloning(false)}
        />
      )}
      {recordEntry && (
        <RecordOutputForm
          entry={recordEntry}
          step={recordTotal > 0 ? { n: recordTotal - recordQueue.length, of: recordTotal } : undefined}
          onSave={onRecordSave}
          onClose={() => {
            setRecordEntry(null);
            setRecordQueue([]);
            setRecordTotal(0);
          }}
        />
      )}
      {editing && <ProductionEditForm group={group} onSaved={onEditSave} onClose={() => setEditing(false)} />}
      {completeOpen && group && <ProductionCompleteForm group={group} onSave={onCompleteSave} onClose={() => setCompleteOpen(false)} />}

      {/* Production list — resizable, sticky, own scroll (mirrors OrderDetail). */}
      <div
        className="card"
        style={{
          width: 300,
          minWidth: 220,
          maxWidth: 420,
          flexShrink: 0,
          padding: 0,
          resize: "horizontal",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - var(--header-h) - 46px)",
          position: "sticky",
          top: 0,
        }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search productions…" value={listQ} onChange={(e) => setListQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((x) => {
            const cur = x.group === groupId;
            return (
              <Link
                key={x.group}
                to={`/prod/${encodeURIComponent(x.group)}`}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "9px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  textDecoration: "none",
                }}
                title={x.code}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.code} · {x.designSummary}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[x.independent ? "Independent" : x.orderNumber || x.poNumber, stageChip(x.stage).label].filter(Boolean).join("  ·  ")}
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching productions</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 26, fontWeight: 700, display: "flex", alignItems: "center", gap: 10 }} title={group.code}>
              <span className="mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{group.code}</span>
              <span className="chip" style={{ color: stageChip(group.stage).color }}>{stageChip(group.stage).label}</span>
              {/* This batch's completeness — produced vs what THIS production
                  requested (ignores the wider SO target, which may be part-
                  ordered on purpose). Only while in progress: once fully
                  produced the stage chip already says "Completed". */}
              {group.totalProduced < group.totalRequested && (
                <span className="chip" style={{ color: "var(--c-blue)" }} title="Produced vs requested in this production">
                  {pct(group.totalProduced, group.totalRequested)}%
                </span>
              )}
            </div>
            {/* Stage move control — reuses the app's canonical select skin (.pg-size). */}
            {can("stages", "edit") && (
              <select
                className="pg-size"
                value={group.stage}
                onChange={(e) => void onStageChange(e.target.value as ProductionStage)}
                title="Move to a stage"
                aria-label="Production stage"
              >
                {PRODUCTION_STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>{PRODUCTION_STAGE_META[s].label}</option>
                ))}
              </select>
            )}
            <MoreMenu items={moreItems} />
            <button className="btn x" onClick={() => navigate("/prod")} title="Close">
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
            {group.independent ? null : (
              <>
                <Link className="linkish" to={`/orders/${group.salesOrderId}`} title="Open Sales Order">
                  {group.orderNumber || group.poNumber || "Order"}
                </Link>
                {group.customer && <> · {group.customer}</>}
              </>
            )}
            {busy && <> · <span className="dim">{busy}</span></>}
          </div>
        </div>

        {/* Tabs */}
        <div className="row" style={{ gap: 4, marginBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => setTab("details")} style={tabStyle(tab === "details")}>Details</button>
          <button onClick={() => setTab("prodlog")} style={tabStyle(tab === "prodlog")}>Production log</button>
          <button onClick={() => setTab("activity")} style={tabStyle(tab === "activity")}>Activity</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {tab === "details" && (
              <ColumnPicker columns={fields.ordered} hidden={fields.hidden} onToggle={fields.toggle} onMove={fields.move} />
            )}
          </div>
        </div>

        {tab === "details" && (
          <>
            <StageDateStrip group={group} />
            <div className="card" style={{ padding: 18, marginBottom: 12 }}>
              <div className="form-grid">
                {fields.ordered.filter((f) => !fields.hidden.has(f.key)).map((f) => (
                  <div className="form-field" key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                    <span className="lbl">{f.label}</span>
                    {f.key === "order" && !group.independent ? (
                      <Link className="linkish" style={{ textAlign: "left" }} to={`/orders/${group.salesOrderId}`} title="Open Sales Order">
                        {group.orderNumber || group.poNumber || "—"}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--fg)" }}>{f.value(group)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Item lines that make up this production (mirrors the SO items table). */}
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600 }}>Items</span>
                <span className="muted" style={{ fontSize: 12 }}>{group.lineCount} line{group.lineCount > 1 ? "s" : ""}</span>
              </div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Design</th>
                      <th>Size / Finish</th>
                      <th>Status</th>
                      <th className="num" style={{ textAlign: "right" }}>Requested</th>
                      <th className="num" style={{ textAlign: "right" }}>Produced</th>
                      {canRecord && <th style={{ width: 110 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.entries.map((e) => {
                      const done = e.producedSoFar >= e.qtyRequested;
                      const lineState = done
                        ? { label: "Done", color: "var(--c-green)" }
                        : e.producedSoFar > 0
                          ? { label: "Partial", color: "var(--c-blue)" }
                          : { label: "To produce", color: "var(--c-amber)" };
                      return (
                        <tr key={e.id}>
                          <td><span className="design-name">{e.design}</span></td>
                          <td className="dim">{[e.size, e.finish].filter(Boolean).join(" · ") || "—"}</td>
                          <td><span className="chip" style={{ color: lineState.color }}>{lineState.label}</span></td>
                          <td className="num mono">{fmt(e.qtyRequested)}</td>
                          <td className="num mono">{e.producedSoFar ? <span style={{ color: "var(--c-green)" }}>{fmt(e.producedSoFar)}</span> : <span className="dim">—</span>}</td>
                          {canRecord && (
                            <td style={{ textAlign: "right" }}>
                              {canRecordLine(e) && (
                                <button
                                  className="hbtn"
                                  style={{ height: 24, padding: "0 8px", borderRadius: 5 }}
                                  onClick={() => setRecordEntry(e)}
                                  title="Log the actual boxes produced"
                                >
                                  <Icon name="factory" size={12} /> Record
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Order progress — where this production sits against its order. */}
            {!group.independent && group.ordered > 0 && (
              <div className="card" style={{ padding: 18 }}>
                <div className="form-section-title" style={{ marginBottom: 10 }}>Order Progress</div>
                <div className="row" style={{ gap: 10 }}>
                  <ProgressBar value={group.produced} max={group.ordered} color="var(--c-blue)" height={6} />
                  <span className="mono" style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {fmt(group.produced)} / {fmt(group.ordered)} · {pct(group.produced, group.ordered)}%
                  </span>
                </div>
                {group.produced >= group.ordered && (
                  <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 8 }}>
                    Production complete — this order is ready for palletisation.
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === "prodlog" && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600 }}>Production log</span>
              <span className="muted" style={{ fontSize: 12 }}>{group.records.length} record{group.records.length === 1 ? "" : "s"}</span>
              <div style={{ marginLeft: "auto" }}>
                <select value={logItemFilter} onChange={(e) => setLogItemFilter(e.target.value)} title="Filter by item">
                  <option value="">All items</option>
                  {[...new Set(group.records.map((r) => r.design))].sort().map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Design</th>
                    <th>Size / Finish</th>
                    <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    <th>By</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {group.records
                    .filter((r) => !logItemFilter || r.design === logItemFilter)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{fmtLocalDate(r.productionDate || r.createdTime)}</td>
                        <td><span className="design-name">{r.design}</span></td>
                        <td className="dim">{[r.size, r.finish].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="num mono" style={{ color: "var(--c-green)" }}>{fmt(r.qtyBoxes)}</td>
                        <td className="dim">{r.performedBy || "—"}</td>
                        <td className="dim">{r.note || "—"}</td>
                      </tr>
                    ))}
                  {group.records.length === 0 && (
                    <tr><td colSpan={6}><span className="dim" style={{ padding: 8, display: "inline-block" }}>No output recorded yet.</span></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "activity" && (
          // One flat log for the whole group. Per-box production-record events live
          // in the Production-log tab; here we show only record-level changes.
          <ActivityLog
            table="ProductionLog"
            entityIds={group.entries.map((e) => e.id)}
            excludeOps={["production-record"]}
          />
        )}
      </div>
    </div>
  );
}

/** Compact 4-stage date strip. Dates come from the StatusTransition log (the
    `Stage: X` flips) — New Request is the record's own creation. No new columns. */
function StageDateStrip({ group }: { group: ProductionRequestGroup }) {
  const [txns, setTxns] = useState<DSRow[]>([]);
  useEffect(() => {
    let alive = true;
    const ids = new Set(group.entries.map((e) => e.id));
    void list("StatusTransition", { order: "ROWID desc", limit: 300 }).then((res) => {
      if (alive) setTxns((res.rows || []).filter((r) => String(r.entity_type) === "ProductionLog" && ids.has(String(r.entity_rowid))));
    });
    return () => { alive = false; };
  }, [group]);

  // Earliest occurred_at of the matching stage flip across the group's lines.
  const stageDate = (stage: ProductionStage) => {
    const marker = `Stage: ${stage}`;
    const times = txns
      .filter((r) => String(r.to_status) === marker)
      .map((r) => String(r.occurred_at || r.CREATEDTIME || ""))
      .filter(Boolean)
      .sort();
    return times[0] || "";
  };
  const cells = [
    { label: "New Request", date: group.createdTime },
    { label: "In Production", date: stageDate("InProduction") },
    { label: "Completed", date: stageDate("Completed") },
  ];
  return (
    <div className="card" style={{ padding: 14, marginBottom: 12, display: "flex", gap: 28, flexWrap: "wrap" }}>
      {cells.map((c) => (
        <div key={c.label}>
          <div className="dim" style={{ fontSize: "var(--t-sm)" }}>{c.label}</div>
          <div className="mono" style={{ fontSize: 13, color: c.date ? "var(--fg)" : "var(--muted)" }}>{c.date ? fmtLocalDate(c.date) : "—"}</div>
        </div>
      ))}
    </div>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    background: "none",
    border: 0,
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--fg)" : "var(--muted)",
    fontWeight: active ? 600 : 400,
    padding: "8px 12px",
    cursor: "pointer",
    font: "inherit",
  };
}
