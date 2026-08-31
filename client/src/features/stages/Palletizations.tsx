/* RETIRED 2026-08-29 — legacy PalletisedBatch/ContainerLoading flow; no route or
   caller imports this. The live path is PalPlans (/packing) + LoadingBay (/loading).
   Kept for git history; delete freely. */
/* Palletization — a grid of palletised batches (the simple "these boxes are on
   a pallet in the warehouse" indicator). Loading happens later, at the Loading
   step. Mirrors the Quotes/PalPlans grid chrome: status tabs + search + advanced
   filter + column picker + sortable headers + footer pager. Whole-row click
   opens the parent Sales Order (its Palletization tab shows the batches).
   "New Palletization" (and "Send to Palletization" via ?fromOrder) open the
   shared Palletise form, which commits real PalletisedBatches. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState, ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { GridFooter, SortTh, usePagination, useSortRows } from "@/ui/GridFooter";
import { AdvancedFilterButton, applyFilters, type FilterCriteria, type FilterField } from "@/ui/AdvancedFilter";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { fmt, fmtDateTime } from "@/lib/format";
import { PalletPackForm } from "./PalletPackForm";
import { closePallet, combineLeftovers, listPalletisations, type ClosePalletInput, type CombineLeftoversInput, type PalletisationRow } from "./palletisationApi";

const statusLabel = (r: PalletisationRow) => (r.loaded ? "Loaded" : "Palletised");

const TABS = [
  { id: "all", label: "All" },
  { id: "Palletised", label: "Palletised" },
  { id: "Loaded", label: "Loaded" },
];

function columns(): ColumnDef<PalletisationRow>[] {
  return [
    { key: "so", label: "Sales Order", className: "mono", render: (r) => r.soLabel || "—" },
    { key: "pallet", label: "Pallet", render: (r) => r.pallet },
    { key: "boxes", label: "Boxes", className: "num mono", style: { textAlign: "right" }, render: (r) => fmt(r.boxes) },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <span className={`chip palstatus ${r.loaded ? "p-loading" : "p-palletized"}`}>{statusLabel(r)}</span>
      ),
    },
    { key: "date", label: "Palletization Date", className: "mono muted", render: (r) => r.date },
    { key: "created", label: "Created", className: "muted mono", render: (r) => fmtDateTime(r.createdTime) },
    { key: "modified", label: "Modified", className: "muted mono", render: (r) => fmtDateTime(r.modifiedTime) },
  ];
}

function sortVal(r: PalletisationRow, k: string): string | number {
  switch (k) {
    case "design": return r.design;
    case "so": return r.soLabel;
    case "pallet": return r.pallet;
    case "boxes": return r.boxes;
    case "status": return statusLabel(r);
    case "date": return r.date || "";
    case "created": return r.createdTime || "";
    case "modified": return r.modifiedTime || "";
    default: return "";
  }
}

export function Palletizations() {
  const navigate = useNavigate();
  const [tab, setTab] = usePersistedState("palletisations.tab", "all");
  const [query, setQuery] = usePersistedState("palletisations.query", "");
  const [criteria, setCriteria] = usePersistedState<FilterCriteria>("palletisations.criteria", {});
  const [showForm, setShowForm] = useState(false);
  // "Send to Palletization" lands here as /packing?fromOrder=<soId> → open a
  // preset Palletise form scoped to that Sales Order.
  const [params, setParams] = useSearchParams();
  const presetOrderId = params.get("fromOrder") || "";

  const COLS = useMemo(() => columns(), []);
  const { ordered, visible, hidden, toggle, move } = useColumns("palletisationsColumns", COLS, ["created", "modified"]);

  const [rows, setRows] = useState<PalletisationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await listPalletisations();
    setLoading(false);
    if (!res.ok) {
      setError(res.error || "Failed to load palletisations");
      return;
    }
    setError(null);
    setRows(res.rows);
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

  // One batch is committed per distinct pallet chosen on the lines; leftovers
  // combine into mixed pallets.
  const onSave = async (inputs: ClosePalletInput[], mixed?: CombineLeftoversInput[]) => {
    setError(null);
    let done = 0;
    let boxes = 0;
    for (const input of inputs) {
      const res = await closePallet(input);
      if (!res.ok) {
        setError(res.error || "Palletisation failed");
        toast.error(res.error || "Palletisation failed");
        void load();
        return;
      }
      done += 1;
      boxes += res.data?.boxes_packed ?? 0;
    }
    for (const m of mixed ?? []) {
      const res = await combineLeftovers(m);
      if (!res.ok) {
        setError(res.error || "Mixed-pallet combine failed");
        toast.error(res.error || "Mixed-pallet combine failed");
        void load();
        return;
      }
      done += 1;
      boxes += res.data?.boxes_packed ?? 0;
    }
    closeForm();
    toast.success(`Palletised — ${done} pallet${done > 1 ? "s" : ""} · ${boxes} boxes.`);
    void load();
  };

  const filterFields = useMemo<FilterField<PalletisationRow>[]>(() => {
    const opts = (get: (r: PalletisationRow) => string) => [...new Set(rows.map(get).filter(Boolean))].sort();
    return [
      { key: "so", label: "Sales Order", type: "text", get: (r) => r.soLabel },
      { key: "design", label: "Design", type: "multiselect", options: opts((r) => r.design), get: (r) => r.design },
      { key: "pallet", label: "Pallet", type: "multiselect", options: opts((r) => r.pallet), get: (r) => r.pallet },
      { key: "status", label: "Status", type: "multiselect", options: ["Palletised", "Loaded"], get: statusLabel },
      { key: "boxes", label: "Boxes", type: "numrange", get: (r) => r.boxes },
      { key: "created", label: "Created Between", type: "daterange", get: (r) => r.createdTime || "" },
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (tab !== "all" && statusLabel(r) !== tab) return false;
      if (!q) return true;
      return `${r.soLabel} ${r.design} ${r.pallet}`.toLowerCase().includes(q);
    });
    return applyFilters(base, criteria, filterFields);
  }, [tab, rows, query, criteria, filterFields]);

  const sort = useSortRows(filtered, sortVal, "created", -1); // newest first
  const pager = usePagination(filtered.length, "palletisationsPageSize", `${tab}|${query}|${JSON.stringify(criteria)}`);
  const pageRows = pager.slice(sort.sorted);

  const tabCount = (id: string) => (id === "all" ? rows.length : rows.filter((r) => statusLabel(r) === id).length);

  return (
    <div>
      {showForm && (
        <PalletPackForm
          presetOrderId={presetOrderId || undefined}
          autoFillAll={!!presetOrderId}
          onSave={(i, m) => void onSave(i, m)}
          onClose={closeForm}
        />
      )}

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
          <input type="text" placeholder="Search SO, design, pallet…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <AdvancedFilterButton title="Palletizations" fields={filterFields} criteria={criteria} onChange={setCriteria} />
        <ColumnPicker columns={ordered} hidden={hidden} onToggle={toggle} onMove={move} />
        {can("stages", "create") && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            New Palletization
          </button>
        )}
      </div>

      <div className="card">
        <div style={{ overflow: "auto" }}>
          {loading && rows.length === 0 ? (
            <SkeletonRows rows={6} />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <SortTh id="design" label="Design" sort={sort} />
                  {visible.map((c) => (
                    <SortTh key={c.key} id={c.key} label={c.label} sort={sort} style={c.style} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => r.salesOrderId && navigate(`/orders/${encodeURIComponent(r.salesOrderId)}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget && r.salesOrderId) navigate(`/orders/${encodeURIComponent(r.salesOrderId)}`); }}
                    style={{ cursor: r.salesOrderId ? "pointer" : "default" }}
                  >
                    <td>
                      <span className="design-name">{r.design}</span>
                      {r.isMixed && <span className="pill" style={{ marginLeft: 6, background: "var(--c-violet, var(--c-blue))", color: "#fff" }}>Mixed</span>}
                    </td>
                    {visible.map((c) => (
                      <td key={c.key} className={c.className} style={c.style}>
                        {c.render!(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={visible.length + 1}>
                      {rows.length > 0 ? (
                        <EmptyState title="No matching results" hint="Try a different filter" />
                      ) : (
                        <EmptyState
                          icon="palette"
                          title="No palletizations yet"
                          hint="Palletise produced boxes with New Palletization"
                          action={
                            can("stages", "create") ? (
                              <button className="hbtn primary" onClick={() => setShowForm(true)}>
                                New Palletization
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
        {!(loading && rows.length === 0) && <GridFooter {...pager} />}
      </div>
    </div>
  );
}
