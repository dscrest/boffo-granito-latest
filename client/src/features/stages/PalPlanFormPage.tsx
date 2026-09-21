/* ============================================================
   Palletization form page (CR-222) — PalPlanForm as a full page:
     /packing/new                     New Palletization (pick a Sales Order)
     /packing/new?fromOrder=<soId>    "Send to Palletization" — scoped to that SO
     /packing/:id/edit                edit
     /packing/:id/clone               clone into a new plan
   Both entry points share this one page (and the one PalPlanForm).
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { PalPlanForm } from "./PalPlanForm";
import { createPalPlan, invalidatePalPlans, listPalPlans, updatePalPlan, type PalPlan, type PalPlanInput } from "./palPlansApi";

export function PalPlanFormPage() {
  const { id = "" } = useParams();
  const planId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!planId && !clone;
  const navigate = useNavigate();

  const [plans, setPlans] = useState<PalPlan[] | null>(planId ? null : []);
  useEffect(() => {
    if (planId) void listPalPlans().then((r) => setPlans(r.ok ? r.plans : []));
  }, [planId]);

  const detailUrl = (rowid: string) => `/packing/${encodeURIComponent(rowid)}`;

  if (!can("stages", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (!plans) return <div className="dim">Loading…</div>;
  const plan = planId ? plans.find((p) => p.id === planId) : undefined;
  if (planId && !plan) return <EmptyState title="Palletization plan not found" />;
  // Same lock as the detail page's Edit button — a typed URL must not get around it.
  if (editing && plan?.status === "Completed") {
    return <EmptyState title={`${plan.palNumber} is completed`} hint="Completed plans can't be edited" />;
  }

  const onSave = async (input: PalPlanInput) => {
    const res = editing ? await updatePalPlan(planId, input) : await createPalPlan(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    const data = res.data as { ROWID?: string; pal_number?: string } | undefined;
    toast.success(editing ? "Palletization plan updated" : `Palletization plan saved (${data?.pal_number || `#${res.rowid}`})`);
    invalidatePalPlans();
    // Land on the saved record; replace so Back never returns to a spent form.
    const savedId = editing ? planId : data?.ROWID || res.rowid;
    navigate(savedId ? detailUrl(savedId) : "/packing", { replace: true });
  };

  return (
    <PalPlanForm
      key={`${planId}|${clone}`}
      initial={plan}
      clone={clone}
      presetOrderId={planId ? undefined : params.get("fromOrder") || undefined}
      onSave={onSave}
      onClose={() => navigate(planId ? detailUrl(planId) : "/packing")}
    />
  );
}
