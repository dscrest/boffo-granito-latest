/* ============================================================
   Panel form page (CR-281) — PanelForm as a full page, the PalletFormPage shape:
     /panels/new           create (Panel Code assigned by the server, CR-280)
     /panels/:id/edit      edit
     /panels/:id/clone     clone into a new panel (fresh code, same lines)
   ============================================================ */
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { PanelForm, panelToInput } from "./PanelForm";
import { cachedPanels, createPanel, listPanels, updatePanel, type PanelInput, type PanelRow } from "./panelsApi";

const detailUrl = (rowid: string) => `/panels/${encodeURIComponent(rowid)}`;

export function PanelFormPage() {
  const { id = "" } = useParams();
  const panelId = decodeURIComponent(id);
  const clone = useLocation().pathname.endsWith("/clone");
  const editing = !!panelId && !clone;
  const navigate = useNavigate();

  const [panels, setPanels] = useState<PanelRow[] | null>(() => cachedPanels());
  useEffect(() => {
    void listPanels().then((r) => setPanels(r.ok ? r.panels : (cachedPanels() ?? [])));
  }, []);

  if (!can("panel_craft", editing ? "edit" : "create")) {
    return <EmptyState title="No access" hint="You don't have permission for this" />;
  }
  if (panelId && panels === null) return <div className="dim">Loading…</div>;
  const panel = panelId ? panels?.find((p) => p.id === panelId) : undefined;
  if (panelId && !panel) return <EmptyState title="Panel not found" />;

  // Clone never copies the identity — the server assigns the next PANEL-NNN.
  const initial: PanelInput | undefined = panel ? (editing ? panelToInput(panel) : { ...panelToInput(panel), panel_code: "" }) : undefined;

  const onSave = async (input: PanelInput) => {
    const res = editing ? await updatePanel(panelId, input) : await createPanel(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    toast.success(editing ? "Panel updated" : "Panel created");
    navigate(editing ? detailUrl(panelId) : res.rowid ? detailUrl(res.rowid) : "/panels", { replace: true });
  };

  return (
    <PanelForm
      key={`${panelId}|${clone}`}
      isEdit={editing}
      initial={initial}
      onSave={onSave}
      onClose={() => navigate(panelId ? detailUrl(panelId) : "/panels")}
    />
  );
}
