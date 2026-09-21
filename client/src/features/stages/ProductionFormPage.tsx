/* ============================================================
   Production form pages (CR-220):
     /prod/new            Start New Production — To Produce shortfalls
                          arrive as router state { lines: [{design, qty}] }
     /prod/:id/clone      same form, prefilled from that production
     /prod/:id/edit       Edit Production (requested boxes + note) — only
                          while no output is recorded
   :id is the production GROUP key, as on /prod/:id.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { ProductionForm } from "./ProductionForm";
import { ProductionEditForm } from "./ProductionEditForm";
import {
  groupProductionByOrder,
  invalidateProductionLogs,
  listProductionLogs,
  requestProduction,
  type ProductionEntry,
  type ProductionRequestInput,
} from "./productionApi";

type PresetLine = { design: string; qty: number };

export function ProductionFormPage() {
  const { id = "" } = useParams();
  const groupId = decodeURIComponent(id);
  const location = useLocation();
  const editing = location.pathname.endsWith("/edit");
  const navigate = useNavigate();

  const [entries, setEntries] = useState<ProductionEntry[] | null>(groupId ? null : []);
  useEffect(() => {
    if (groupId) void listProductionLogs().then((r) => setEntries(r.ok ? r.entries : []));
  }, [groupId]);
  const group = useMemo(
    () => (groupId && entries ? groupProductionByOrder(entries).find((g) => g.group === groupId) ?? null : null),
    [entries, groupId],
  );

  const detailUrl = (key: string) => `/prod/${encodeURIComponent(key)}`;
  const backTo = groupId ? detailUrl(groupId) : "/prod";

  if (!can("stages", "edit")) return <EmptyState title="No access" hint="You don't have permission for this" />;
  if (!entries) return <div className="dim">Loading…</div>;
  if (groupId && !group) return <EmptyState title="Production not found" />;

  if (editing && group) {
    if (group.records.length > 0) {
      return <EmptyState title={`${group.code} is locked`} hint="Output already recorded — quantities are locked" />;
    }
    return (
      <ProductionEditForm
        key={groupId}
        group={group}
        onSaved={() => {
          invalidateProductionLogs();
          navigate(backTo, { replace: true });
        }}
        onClose={() => navigate(backTo)}
      />
    );
  }

  const onSave = async (input: ProductionRequestInput) => {
    // CR-234: job only — lands in In Production at 0 produced; output is logged
    // batch by batch from the + menu.
    const res = await requestProduction({ ...input, stage: "InProduction" });
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    const total = input.lines.reduce((s, l) => s + l.qty_requested, 0);
    toast.success(`Production started — ${fmt(total)} boxes · ${res.data?.lines ?? input.lines.length} item(s)`);
    invalidateProductionLogs();
    // Order-linked clones land back on the same SO's production; anything else keys by
    // its new request_group (groupProductionByOrder's fallback), not the row id.
    const dest = (group && !group.independent ? group.group : undefined) ?? res.data?.request_group ?? res.rowid;
    navigate(dest ? detailUrl(dest) : "/prod", { replace: true });
  };

  const presetLines: PresetLine[] | undefined = group
    ? group.entries.map((e) => ({ design: e.designId, qty: e.qtyRequested }))
    : (location.state as { lines?: PresetLine[] } | null)?.lines;

  return <ProductionForm key={groupId} presetLines={presetLines} onSave={onSave} onClose={() => navigate(backTo)} />;
}
