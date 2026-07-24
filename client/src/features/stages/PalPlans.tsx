/* Palletization Plans list — a real grid of vehicle-load plans (PalPlan),
   backed by the Catalyst Data Store via palPlansApi. Mirrors the Quotes grid:
   status tabs + search + advanced filter + column picker + sortable headers +
   footer pager; whole-row click opens the detail. "New Palletization Plan"
   opens PalPlanForm and lands on the created record. */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { fmt, fmtDateTime } from "@/lib/format";
import { PalPlanForm } from "./PalPlanForm";
import { PalKanban } from "./PalKanban";
import {
  cachedPalPlans,
  createPalPlan,
  invalidatePalPlans,
  listPalPlans,
  PAL_STATUS_LABEL,
  PAL_STATUSES,
  type PalPlan,
  type PalStatus,
} from "./palPlansApi";

export const STATUS_CHIP: Record<PalStatus, string> = {
  Planning: "p-planning",
  Loading: "p-loading",
  Completed: "p-completed",
};

const TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  ...PAL_STATUSES.map((s) => ({ id: s, label: PAL_STATUS_LABEL[s] })),
];

function planColumns(): ColumnDef<PalPlan>[] {
  return [
    { key: "vehicle", label: "Vehicle", render: (p) => p.vehicleNumber || "—" },
    {
      key: "sos",
      label: "Associated SOs",
      className: "mono muted",
      render: (p) => (p.soNumbers.length ? p.soNumbers.join(", ") : "—"),
    },
    {
      key: "status",
      label: "Status",
      render: (p) => <span className={`chip palstatus ${STATUS_CHIP[p.status]}`}>{PAL_STATUS_LABEL[p.status]}</span>,
    },
    { key: "planned", label: "Palletization Date", className: "mono muted", render: (p) => p.plannedDate || "—" },
    { key: "boxes", label: "Boxes", className: "num mono", style: { textAlign: "right" }, render: (p) => fmt(p.totalBoxes) },
    { key: "salesperson", label: "Sales Person", className: "muted", render: (p) => p.salespersonName || "—" },
    { key: "created", label: "Created", className: "muted mono", render: (p) => fmtDateTime(p.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (p) => fmtDateTime(p.modifiedTime) },
  ];
}

function planSortVal(p: PalPlan, k: string): string | number {
  switch (k) {
    case "palNumber": return p.palNumber;
    case "vehicle": return p.vehicleNumber;
    case "sos": return p.soNumbers.join(", ");
    case "status": return PAL_STATUS_LABEL[p.status];
    case "planned": return p.plannedDate || "";
    case "boxes": return p.totalBoxes;
    case "salesperson": return p.salespersonName;
    case "created": return p.createdTime || "";
    case "modified": return p.modifiedTime || "";
    default: return "";
  }
}

export function PalPlans() {
  const navigate = useNavigate();
  const [tab, setTab] = usePersistedState("palplans.tab", "all");
  const [query, setQuery] = usePersistedState("palplans.query", "");
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("palplans.criteria", {});
  const [view, setView] = usePersistedState<"list" | "board">("palplans.view", "board");
  const [showForm, setShowForm] = useState(false);
  // "Send to Palletization" lands here as /packing?fromOrder=<soId> → open a
  // preset New-plan form scoped to that Sales Order.
  const [params, setParams] = useSearchParams();
  const presetOrderId = params.get("fromOrder") || "";

  const COLS = useMemo(() => planColumns(), []);
  const { ordered, visible, hidden, toggle, move } = useColumns("palPlansColumns", COLS, ["created", "modified"]);

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await listPalPlans();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load palletization plans");
      return;
    }
    setError(null);
    setPlans(res.plans);
  };

  useEffect(() => {
    void load();
  }, []);

  // Auto-open the create form when arrived via "Send to Palletization".
  useEffect(() => {
    if (presetOrderId) setShowForm(true);
  }, [presetOrderId]);

  const closeForm = () => {
    setShowForm(false);
    if (presetOrderId) setParams({}, { replace: true }); // drop ?fromOrder
  };

  const onSave = async (input: Parameters<typeof createPalPlan>[0]) => {
    setShowForm(false);
    setSaving(true);
    const res = await createPalPlan(input);
    setSaving(false);
    if (!res.ok) {
      setError(res.error || "Save failed");
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(`Palletization plan saved (${res.data?.pal_number || `#${res.rowid}`})`);
    invalidatePalPlans();
    // Land on the new record (id from the API response).
    const newId = res.data?.ROWID || res.rowid;
    if (newId) navigate(`/packing/${encodeURIComponent(newId)}`);
  };

  const filterFields = useMemo<FilterField<PalPlan>[]>(() => {
    const opts = (get: (r: PalPlan) => string) => [...new Set(plans.map(get).filter(Boolean))].sort();
    return [
      { key: "palNumber", label: "PAL No", type: "text", get: (r) => r.palNumber },
      { key: "vehicle", label: "Vehicle", type: "text", get: (r) => r.vehicleNumber },
      { key: "status", label: "Status", type: "multiselect", options: opts((r) => PAL_STATUS_LABEL[r.status]), get: (r) => PAL_STATUS_LABEL[r.status] },
      { key: "salesperson", label: "Sales Person", type: "multiselect", options: opts((r) => r.salespersonName), get: (r) => r.salespersonName },
      { key: "boxes", label: "Boxes", type: "numrange", get: (r) => r.totalBoxes },
      { key: "planned", label: "Palletization Date Between", type: "daterange", get: (r) => r.plannedDate },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.createdTime || "" },
    ];
  }, [plans]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = plans.filter((r) => {
      if (tab !== "all" && r.status !== tab) return false;
      if (!q) return true;
      return `${r.palNumber} ${r.vehicleNumber} ${r.soNumbers.join(" ")}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, plans, query, criteria, filterFields]);

  const sort = useSortRows(filtered, planSortVal, "created", -1); // newest first
  const pager = usePagination(filtered.length, "palPlansPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);

  const tabCount = (id: string) => (id === "all" ? plans.length : plans.filter((p) => p.status === id).length);

  return (
    <div>
      {showForm && <PalPlanForm presetOrderId={presetOrderId || undefined} onSave={(i) => void onSave(i)} onClose={closeForm} />}

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar" style={{ marginBottom: 12 }}>
        <Icon name="filter" size={12} />
        <select value={tab} onChange={(e) => setTab(e.target.value)} title="Filter by status">
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({tabCount(t.id)})
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <span className="gsearch">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search PAL no, vehicle, SO…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <AdvancedFilterButton title="Palletization Plans" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="View" title="Switch view">
          <button onClick={() => setView("list")} title="List" aria-label="List view"
            style={{ background: view === "list" ? "var(--accent-soft)" : "transparent", color: view === "list" ? "var(--fg)" : "var(--muted)", border: 0, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
            <Icon name="orders" size={14} />
          </button>
          <button onClick={() => setView("board")} title="Board" aria-label="Board view"
            style={{ background: view === "board" ? "var(--accent-soft)" : "transparent", color: view === "board" ? "var(--fg)" : "var(--muted)", border: 0, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
            <Icon name="kanban" size={14} />
          </button>
        </span>
        {view === "list" && <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />}
        {can("stages", "create") && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={saving} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {saving ? "Saving…" : "New Palletization Plan"}
          </button>
        )}
      </div>

      {view === "board" ? (
        loading && plans.length === 0 ? (
          <div className="card"><SkeletonRows rows={6} /></div>
        ) : (
          <PalKanban plans={filtered} canEdit={can("stages", "edit")} onChanged={() => void load()} />
        )
      ) : (
      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && plans.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="palNumber" label="PAL No" sort={sort} />
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((p) => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => navigate(`/packing/${p.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) navigate(`/packing/${p.id}`); }}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="mono">
                      <Link className="linkish" to={`/packing/${p.id}`} onClick={(e) => e.stopPropagation()} title="View plan">
                        {p.palNumber}
                      </Link>
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(p)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1}>
                      {plans.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="truck"
                          title="No palletization plans yet"
                          hint="Plan a vehicle load with New Palletization Plan"
                          action={
                            can("stages", "create") ? (
                              <button className="hbtn primary" onClick={() => setShowForm(true)}>
                                New Palletization Plan
                              </button>
                            ) : undefined
                          }
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {!(loading && plans.length === 0) && <GridFooter {...pager} />}
      </div>
      )}
    </div>
  );
}
