/* ============================================================
   Panel detail — same split view as the Pallet / Size detail pages.
   Left: resizable, searchable list of panels. Right: header with
   Edit / More (Clone, Delete) / ✕, Primary Details, the Product
   Showcase lines, orders for this panel, Activity log.

   Like Pallet there is no dedicated edit *page*, so Edit opens the
   shared PanelForm modal in place.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt, fmtLocalDateTime } from "@/lib/format";
import { update } from "@/lib/dataOps";
import { ActivityLog, tabStyle } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { ImageManager } from "@/features/common/ImageManager";
import type { DesignImage } from "@/features/masters/designsApi";
import { PanelForm, panelToInput } from "./PanelForm";
import { cachedPanels, createPanel, deletePanel, listPanels, patchPanelCache, updatePanel, type PanelInput, type PanelRow } from "./panelsApi";
import { cachedPanelOrders, listPanelOrders, PANEL_ORDER_STATUS_LABEL, type PanelOrderRow } from "./panelOrdersApi";

/** [label, value, isUnset] — unset fields render dimmed as "Not set". */
type Detail = [string, string, boolean];
const text = (label: string, s: string): Detail => [label, s || "Not set", !s];

export function PanelDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  // Seed from cache so switching panels / returning to the tab never flashes a skeleton.
  const [panels, setPanels] = useState<PanelRow[] | null>(() => cachedPanels());
  const [orders, setOrders] = useState<PanelOrderRow[]>(() => cachedPanelOrders() ?? []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);
  // Overview (default) | Product Showcase | Activity — deep-linkable via ?tab=.
  const [sp, setSp] = useSearchParams();
  const spTab = sp.get("tab");
  const tab = spTab === "showcase" ? "showcase" : spTab === "activity" ? "activity" : "overview";
  const setTab = (t: "overview" | "showcase" | "activity") => setSp(t === "overview" ? {} : { tab: t }, { replace: true });

  const refresh = () => listPanels().then((res) => setPanels(res.ok ? res.panels : (cachedPanels() ?? [])));
  const refreshOrders = () => listPanelOrders().then((res) => setOrders(res.ok ? res.orders : (cachedPanelOrders() ?? [])));
  useEffect(() => {
    void refresh();
    void refreshOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (panels === null) return <SkeletonRows rows={6} />;

  const panel = panels.find((p) => p.id === id) ?? null;
  const panelOrders = orders.filter((o) => o.panelId === id);
  const needle = q.trim().toLowerCase();
  const listed = needle
    ? panels.filter((p) => `${p.panelCode} ${p.lines.map((l) => l.designName).join(" ")}`.toLowerCase().includes(needle))
    : panels;

  const onSave = async (input: PanelInput) => {
    if (!panel) return;
    const res = await updatePanel(panel.id, input);
    if (!res.ok) {
      // Keep the form open — closing here would discard everything typed.
      toast.error(res.error || "Save failed");
      return;
    }
    setEditing(false);
    toast.success("Panel updated");
    await refresh();
  };

  // Clone: same lines into a fresh panel, user edits then saves.
  const onClone = async (input: PanelInput) => {
    const res = await createPanel(input);
    if (!res.ok) {
      toast.error(res.error || "Save failed");
      return;
    }
    setCloning(false);
    toast.success("Panel created");
    if (res.rowid) navigate(`/panels/${encodeURIComponent(res.rowid)}`);
    await refresh();
  };

  /** Persist a new image list — same shape as Design.image_urls (ImageManager). */
  const saveImages = async (next: DesignImage[]) => {
    if (!panel) return false;
    const res = await update("Panel", panel.id, { image_urls: JSON.stringify(next) });
    if (!res.ok) {
      toast.error(res.error || "Could not save images");
      return false;
    }
    // Patch only the selected panel — no full refetch (keeps the list + scroll put).
    setPanels((prev) => (prev ? prev.map((p) => (p.id === panel.id ? { ...p, images: next } : p)) : prev));
    patchPanelCache(panel.id, { images: next });
    return true;
  };

  const onDelete = async () => {
    if (!panel) return;
    if (!(await confirmDialog({ message: `Are you sure you want to delete panel "${panel.panelCode}"? This cannot be undone.`, danger: true }))) return;
    setBusy(true);
    const res = await deletePanel(panel);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Panel deleted");
    navigate("/panels");
  };

  const moreItems = [
    ...(can("items", "create") && panel ? [{ label: "Clone", onClick: () => setCloning(true) }] : []),
    ...(can("items", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      {editing && panel && <PanelForm isEdit initial={panelToInput(panel)} onSave={(i) => void onSave(i)} onClose={() => setEditing(false)} />}
      {/* Clone never copies the identity — panel_code is typed fresh. */}
      {cloning && panel && (
        <PanelForm initial={{ ...panelToInput(panel), panel_code: "" }} onSave={(i) => void onClone(i)} onClose={() => setCloning(false)} />
      )}

      {/* Panel list — fixed viewport height with its OWN scroll, sticky while
          the detail scrolls. Drag the bottom-right corner to resize the width. */}
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
          <input type="text" placeholder="Search panels…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((p) => {
            const cur = p.id === id;
            return (
              <Link
                key={p.id}
                to={`/panels/${p.id}`}
                style={{
                  display: "block",
                  padding: "9px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: cur ? "var(--accent-soft)" : "transparent",
                  color: "inherit",
                  textDecoration: "none",
                }}
                title={p.panelCode}
              >
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.panelCode}
                </div>
                <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                  {[p.lines.length && `${p.lines.length} design${p.lines.length > 1 ? "s" : ""}`, p.panelSize && `Panel: ${p.panelSize}`]
                    .filter(Boolean)
                    .join("  ·  ") || "No details yet"}
                </div>
              </Link>
            );
          })}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching panels</div>}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!panel ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Panel not found" hint="Pick a panel from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  className="title"
                  style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={panel.panelCode}
                >
                  {panel.panelCode}
                </div>
                {can("items", "edit") && (
                  <button className="hbtn" onClick={() => setEditing(true)} disabled={busy} title="Edit panel">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/panels")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                {[panel.panelSize && `Panel: ${panel.panelSize}`, panel.vinylSize && `Vinyl: ${panel.vinylSize}`]
                  .filter(Boolean)
                  .join("  ·  ") || "No sizes set"}
              </div>

              {/* Overview | Product Showcase | Activity tabs (mirrors ItemDetail). */}
              <div className="row" style={{ gap: 4, marginTop: 12, borderBottom: "1px solid var(--border)" }}>
                <button onClick={() => setTab("overview")} style={tabStyle(tab === "overview")}>Overview</button>
                <button onClick={() => setTab("showcase")} style={tabStyle(tab === "showcase")}>Product Showcase</button>
                <button onClick={() => setTab("activity")} style={tabStyle(tab === "activity")}>Activity</button>
              </div>

              {tab === "overview" && (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
                <div style={{ flex: "1 1 340px", minWidth: 280, maxWidth: 520 }}>
                  <div className="form-section-title" style={{ marginBottom: 8 }}>Panel Details</div>
                  {[
                    text("Panel Code", panel.panelCode),
                    text("Panel Size", panel.panelSize),
                    text("Vinyl Size", panel.vinylSize),
                    ["Created", fmtLocalDateTime(panel.createdTime), false] as Detail,
                    ["Modified", fmtLocalDateTime(panel.modifiedTime), false] as Detail,
                  ].map(([label, value, unset]) => (
                    <DetailRow key={label} label={label} value={value} dim={unset} />
                  ))}
                </div>

                {/* Image upload — same manager as the Item master (#12). */}
                <div style={{ flex: "0 1 340px", minWidth: 280, border: "1px solid var(--border)", borderRadius: 10, padding: 14, alignSelf: "flex-start" }}>
                  <ImageManager images={panel.images} canEdit={can("items", "edit")} onSave={saveImages} />
                </div>
              </div>
              )}

              {tab === "showcase" && (
              <div style={{ overflow: "auto", marginTop: 14 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>Sr. No.</th>
                      <th>Design Name</th>
                      <th>Available Size</th>
                      <th>Cut Piece Size</th>
                      <th className="num" style={{ textAlign: "right" }}>Cut Piece Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panel.lines.map((l, i) => (
                      <tr key={l.id}>
                        <td className="mono muted">{i + 1}</td>
                        <td>
                          <Link className="linkish" to={`/design/${encodeURIComponent(l.designId)}`} title="Open item">
                            <span className="design-name">{l.designName}</span>
                          </Link>
                        </td>
                        <td className="mono">{l.sizeLabel || <span className="dim">—</span>}</td>
                        <td className="mono">{l.cutSizeName || <span className="dim">—</span>}</td>
                        <td className="num mono">{fmt(l.qty)}</td>
                      </tr>
                    ))}
                    {panel.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 18 }}>No designs on this panel yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              )}

              {tab === "overview" && (
              <>
              <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Orders</div>
              <div style={{ overflow: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th className="num" style={{ textAlign: "right" }}>Qty</th>
                      <th>Order Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {panelOrders.map((o) => (
                      <tr key={o.id}>
                        <td>{o.customerName}</td>
                        <td className="num mono">{fmt(o.qty)}</td>
                        <td className="mono muted">{o.orderDate || "—"}</td>
                        <td>{PANEL_ORDER_STATUS_LABEL[o.status]}</td>
                      </tr>
                    ))}
                    {panelOrders.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No orders for this panel.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              </>
              )}

              {/* Audit trail: who created / changed this panel, from OperationLog. */}
              {tab === "activity" && (
                <div style={{ marginTop: 14 }}>
                  <ActivityLog table="Panel" entityId={panel.id} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
