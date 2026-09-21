/* Palletization — full-page stage board of PalletizationPlanLines
   (DispatchBoard), backed by the Catalyst Data Store via palPlansApi. Since
   CR-160 it is TWO pages over the same component, scoped by `stages`:
     /packing      → Ready for Palletization (the Planning stage only)
     /palletizing  → In Palletization + Ready for Loading (Load handoff)
   The page header holds the status tab, the ONE Kanban/Sheet view toggle,
   Group (+ Sections when the page has >1 stage) and "New Palletization Plan"
   (opens PalPlanForm and lands on the created record). The old plans-list
   grid was retired in the 2026-08-22 declutter — git history holds it. */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { ErrorCard, SkeletonRows } from "@/ui/States";
import { ColumnPicker, useColumns, type ColumnDef } from "@/ui/ColumnPicker";
import { can } from "@/lib/auth";
import { usePersistedState, useViewState } from "@/lib/usePersistedState";
import { COLUMNS, DispatchBoard, DISPATCH_GROUP_DIMS, lineStage, type DispatchGroupBy } from "./DispatchBoard";
import {
  cachedLoadBoxes,
  cachedPalPlans,
  listPalPlans,
  loadableLineIds,
  type LoadBox,
  type PalPlan,
  type PalStatus,
} from "./palPlansApi";

export const STATUS_CHIP: Record<PalStatus, string> = {
  Planning: "p-planning",
  Loading: "p-loading",
  Completed: "p-completed",
};

type StageKey = (typeof COLUMNS)[number]["key"];

export function PalPlans({
  stages = ["Planning"],
  sectionsKey = "palplans.stages",
}: {
  /** Stage sections this page shows (in order). One stage = no Sections picker. */
  stages?: StageKey[];
  /** localStorage key for the Sections show/hide prefs (per page). */
  sectionsKey?: string;
}) {
  const navigate = useNavigate();
  // Sections picker defs — this page's stage columns.
  const STAGE_DEFS = useMemo<ColumnDef[]>(
    () => COLUMNS.filter((c) => stages.includes(c.key)).map((c) => ({ key: c.key, label: c.label })),
    [stages],
  );
  // Status filter: this page's own stage(s) by default; "All" lists every line
  // of every stage (boxed + dispatched included) as a read-only overview.
  const TABS = [
    { id: "page", label: STAGE_DEFS.map((c) => c.label).join(" + ") },
    { id: "all", label: "All" },
  ];
  const [tab, setTab] = usePersistedState(`${sectionsKey}.show`, "page");
  // The ONE view switch — Kanban vs Sheet, passed down to the board. Opens on
  // whatever Settings → Default view says; key kept from the old inner toggle
  // so existing users keep their preference.
  const [view, setView] = useViewState("dispatch.boardView", "sheet" as const, "kanban" as const);
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
  // Stage sections show/hide (kanban lanes + sheet rows) — all of this page's
  // stages start visible; per-browser like every other column pref.
  const stageCols = useColumns(sectionsKey, STAGE_DEFS);
  // Only this page's stages ever reach the board (a hidden-all pref falls back to all).
  const visibleStages = stageCols.visible.map((c) => c.key);
  const boardStages = visibleStages.length ? visibleStages : stages;
  const [params] = useSearchParams();
  const presetOrderId = params.get("fromOrder") || "";

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  // Open containers — the board's Load flow needs them (same fetch).
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(() => cachedPalPlans() == null);
  const [error, setError] = useState<string | null>(null);

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

  // Old "Send to Palletization" links (/packing?fromOrder=) → the form page (CR-222).
  useEffect(() => {
    if (presetOrderId) navigate(`/packing/new?fromOrder=${encodeURIComponent(presetOrderId)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetOrderId]);

  const showAll = tab === "all";
  // Counts = the rows the board will show for that option.
  const loadable = loadableLineIds(plans.flatMap((p) => p.lines));
  const tabCount = (id: string) =>
    plans.reduce(
      (n, p) =>
        n +
        p.lines.filter((l) => id === "all" || (p.status !== "Completed" && !l.loadBoxId && boardStages.includes(lineStage(l, loadable)))).length,
      0,
    );

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

      {error && <ErrorCard message={`${error} — check the Operations log (/ops).`} onRetry={() => void load()} />}

      <div className="fbar" style={{ marginBottom: 12 }}>
        <Icon name="filter" size={12} />
        <select value={showAll ? "all" : "page"} onChange={(e) => setTab(e.target.value)} title="Filter by status">
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({tabCount(t.id)})
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button
          className="hbtn"
          data-tour="pal-report"
          style={{ height: 26, padding: "0 10px", borderRadius: 5 }}
          title="Print the pallet packing report for everything palletized today"
          onClick={() =>
            void import("./packingReportPdf")
              .then((m) => m.downloadTodaysPackingReport(plans))
              .then(
                (n) => { if (n === 0) toast.error("Nothing palletized today"); },
                () => toast.error("Failed to load today's palletization activity"),
              )
          }
        >
          <Icon name="printer" size={13} /> Today's Report
        </button>
        <span data-tour="pal-view-toggle" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }} role="group" aria-label="Board view" title="Switch view">
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
        {STAGE_DEFS.length > 1 && (
          <ColumnPicker
            columns={stageCols.ordered}
            hidden={stageCols.hidden}
            onToggle={stageCols.toggle}
            onMove={stageCols.move}
            label="Sections"
            icon="menu"
            title="Show or hide board sections"
          />
        )}
        {can("stages", "create") && (
          <button className="hbtn primary" style={{ height: 26, padding: "0 10px", borderRadius: 5 }} onClick={() => navigate("/packing/new")}>
            <Icon name="plus" size={13} />
            New Palletization Plan
          </button>
        )}
      </div>

      {loading && plans.length === 0 ? (
        <div className="card"><SkeletonRows rows={6} /></div>
      ) : (
        <DispatchBoard plans={plans} showAll={showAll} allPlans={plans} boxes={boxes} view={view} canEdit={can("stages", "edit")} groupBy={groupBy} visibleStages={boardStages} onChanged={() => void load()} />
      )}
    </div>
  );
}
