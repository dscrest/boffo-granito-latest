/* Palletization (/packing) — full-page stage board of
   PalletizationPlanLines (DispatchBoard), backed by the Catalyst Data Store via
   palPlansApi. The page header holds the status tab, the ONE Kanban/Sheet view
   toggle, and "New Palletization Plan" (opens PalPlanForm and lands on the
   created record). The old plans-list grid was retired in the 2026-08-22
   declutter — git history holds it. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, type ColumnDef } from "@/ui/ColumnPicker";
import { can } from "@/lib/auth";
import { usePersistedState } from "@/lib/usePersistedState";
import { PalPlanForm } from "./PalPlanForm";
import { DispatchBoard, DISPATCH_GROUP_DIMS, type DispatchGroupBy } from "./DispatchBoard";
import {
  cachedLoadBoxes,
  cachedPalPlans,
  createPalPlan,
  invalidatePalPlans,
  listPalPlans,
  PAL_STATUS_LABEL,
  PAL_STATUSES,
  type LoadBox,
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

export function PalPlans() {
  const navigate = useNavigate();
  const [tab, setTab] = usePersistedState("palplans.tab", "all");
  // The ONE view switch — Kanban vs Sheet, passed down to the board.
  // Key kept from the old inner toggle so existing users keep their preference.
  const [view, setView] = usePersistedState<"kanban" | "sheet">("dispatch.boardView", "kanban");
  // Grouping: an ordered list of dimensions → nested swimlanes / sheet bands
  // (same mechanism as Production; the picker reuses ColumnPicker).
  const [groupBy, setGroupBy] = useState<DispatchGroupBy[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("palplans.groups") || "[]");
      return Array.isArray(v) ? v.filter((d) => DISPATCH_GROUP_DIMS.some((o) => o.id === d)) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem("palplans.groups", JSON.stringify(groupBy));
  }, [groupBy]);
  // Checked dims first (in nesting order), rest after; Apply commits drag order.
  const groupCols = useMemo<ColumnDef<unknown>[]>(() => {
    const ordered = [...groupBy, ...DISPATCH_GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))];
    return ordered.map((id) => ({ key: id, label: DISPATCH_GROUP_DIMS.find((o) => o.id === id)!.label }));
  }, [groupBy]);
  const groupHidden = useMemo(() => new Set(DISPATCH_GROUP_DIMS.map((o) => o.id).filter((id) => !groupBy.includes(id))), [groupBy]);
  const toggleGroup = (key: string) =>
    setGroupBy((prev) => (prev.includes(key as DispatchGroupBy) ? prev.filter((d) => d !== key) : [...prev, key as DispatchGroupBy]));
  const moveGroup = (keys: string[]) => setGroupBy((prev) => keys.filter((k) => prev.includes(k as DispatchGroupBy)) as DispatchGroupBy[]);
  const [showForm, setShowForm] = useState(false);
  // "Send to Palletization" lands here as /packing?fromOrder=<soId> → open a
  // preset New-plan form scoped to that Sales Order.
  const [params, setParams] = useSearchParams();
  const presetOrderId = params.get("fromOrder") || "";

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
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
    setBoxes(res.boxes);
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

  const filtered = plans.filter((r) => tab === "all" || r.status === tab);
  const tabCount = (id: string) => (id === "all" ? plans.length : plans.filter((p) => p.status === id).length);

  const viewBtn = (v: "kanban" | "sheet", icon: "kanban" | "orders", label: string) => (
    <button
      onClick={() => setView(v)}
      title={label}
      aria-label={`${label} view`}
      style={{
        background: view === v ? "var(--accent-soft)" : "transparent",
        color: view === v ? "var(--fg)" : "var(--muted)",
        border: 0, padding: "5px 12px", cursor: "pointer", display: "inline-flex", alignItems: "center",
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );

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
        <span style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="Board view" title="Switch view">
          {viewBtn("kanban", "kanban", "Kanban")}
          {viewBtn("sheet", "orders", "Sheet")}
        </span>
        <ColumnPicker
          columns={groupCols}
          hidden={groupHidden}
          onToggle={toggleGroup}
          onMove={moveGroup}
          onClear={() => setGroupBy([])}
          label={groupBy.length ? `Group: ${groupBy.map((d) => DISPATCH_GROUP_DIMS.find((o) => o.id === d)!.label).join(" › ")}` : "Group"}
          icon="menu"
          title="Group into sections — check dimensions, drag to set order"
        />
        {can("stages", "create") && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} disabled={saving} onClick={() => setShowForm(true)}>
            <Icon name="plus" size={13} />
            {saving ? "Saving…" : "New Palletization Plan"}
          </button>
        )}
      </div>

      {loading && plans.length === 0 ? (
        <div className="card"><SkeletonRows rows={6} /></div>
      ) : (
        <DispatchBoard plans={filtered} boxes={boxes} view={view} canEdit={can("stages", "edit")} groupBy={groupBy} onChanged={() => void load()} />
      )}
    </div>
  );
}
