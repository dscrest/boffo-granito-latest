/* ============================================================
   Container detail (CR-261) — same split view as the Pallet detail:
   left a searchable list of containers, right the header (Edit / More /
   ✕), the pallet lines table, notes and the Activity log.
   ============================================================ */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { newestFirst } from "@/lib/dates";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { confirmDelete } from "@/ui/ConfirmDialog";
import { SkeletonRows, EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt, fmtLocalDateTime } from "@/lib/format";
import { ActivityLog } from "@/features/common/RecordDetail";
import { DetailRow, MoreMenu } from "@/features/common/DetailBits";
import { cachedContainerFormats, deleteContainerFormat, listContainerFormats, type ContainerFormatRow } from "./containerFormatsApi";

export function ContainerFormatDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ContainerFormatRow[] | null>(() => cachedContainerFormats());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listContainerFormats().then((res) => setRows(res.ok ? res.formats : (cachedContainerFormats() ?? [])));
  }, []);

  if (rows === null) return <SkeletonRows rows={6} />;
  const row = rows.find((r) => r.id === id) ?? null;
  const needle = q.trim().toLowerCase();
  const listed = newestFirst(rows).filter((r) => !needle || `${r.name} ${r.sizeLabel}`.toLowerCase().includes(needle));

  const onDelete = async () => {
    if (!row) return;
    const reason = await confirmDelete({ message: `Are you sure you want to delete container "${row.name}"? This cannot be undone.` });
    if (reason == null) return;
    setBusy(true);
    const res = await deleteContainerFormat(row.id, reason);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "Delete failed");
      return;
    }
    toast.success("Container deleted");
    navigate("/containers");
  };

  const moreItems = [
    ...(can("items", "create") && row ? [{ label: "Clone", onClick: () => navigate(`/containers/${encodeURIComponent(row.id)}/clone`) }] : []),
    ...(can("items", "delete") ? [{ label: "Delete", danger: true, onClick: () => void onDelete() }] : []),
  ];

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        className="card"
        style={{ width: 300, minWidth: 220, maxWidth: 420, flexShrink: 0, padding: 0, resize: "horizontal", overflow: "hidden", display: "flex", flexDirection: "column", height: "calc(100vh - var(--header-h) - 46px)", position: "sticky", top: 0 }}
      >
        <div className="lp-search">
          <Icon name="search" size={13} />
          <input type="text" placeholder="Search containers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ overflowY: "auto", flex: 1, overscrollBehavior: "contain" }}>
          {listed.map((r) => (
            <Link
              key={r.id}
              to={`/containers/${r.id}`}
              style={{ display: "block", padding: "9px 12px", borderBottom: "1px solid var(--border)", background: r.id === id ? "var(--accent-soft)" : "transparent", color: "inherit", textDecoration: "none" }}
              title={r.name}
            >
              <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.sizeLabel || r.name}</div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
                {r.totalPallets > 0 ? `${fmt(r.totalPallets)} pallets · ${fmt(r.totalBoxes)} boxes` : "No pallets yet"}
              </div>
            </Link>
          ))}
          {listed.length === 0 && <div className="dim" style={{ padding: 12 }}>No matching containers</div>}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!row ? (
          <div className="card" style={{ padding: 20 }}>
            <EmptyState title="Container not found" hint="Pick a container from the list" />
          </div>
        ) : (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="title" style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={row.name}>
                  {row.sizeLabel || row.name}
                </div>
                {can("items", "edit") && (
                  <button className="hbtn" onClick={() => navigate(`/containers/${encodeURIComponent(row.id)}/edit`)} disabled={busy} title="Edit container">
                    <Icon name="edit" size={13} />
                    Edit
                  </button>
                )}
                <MoreMenu items={moreItems} />
                <button className="btn x" onClick={() => navigate("/containers")} title="Close">
                  <Icon name="x" size={13} />
                </button>
              </div>
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 4, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>{row.name}</div>

              <div style={{ marginTop: 14 }}>
                <div className="form-section-title" style={{ marginBottom: 8 }}>Pallets</div>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Pallet</th>
                      <th className="num" style={{ textAlign: "right" }}>Boxes / Pallet</th>
                      <th className="num" style={{ textAlign: "right" }}>Pallets / Container</th>
                      <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.lines.map((l) => (
                      <tr key={l.palletId}>
                        <td>
                          <Link className="linkish" to={`/pallets/${encodeURIComponent(l.palletId)}`}>{l.palletName}</Link>
                        </td>
                        <td className="num mono">{fmt(l.boxesPerPallet)}</td>
                        <td className="num mono">{fmt(l.count)}</td>
                        <td className="num mono">{fmt(l.boxes)}</td>
                      </tr>
                    ))}
                    {row.lines.length === 0 && (
                      <tr>
                        <td colSpan={4} className="muted" style={{ textAlign: "center", padding: 18 }}>No pallets on this container.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Total</td>
                      <td />
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(row.totalPallets)}</td>
                      <td className="num mono" style={{ fontWeight: 600 }}>{fmt(row.totalBoxes)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div style={{ marginTop: 14, maxWidth: 520 }}>
                <div className="form-section-title" style={{ marginBottom: 8 }}>Record</div>
                <DetailRow label="Size" value={row.sizeLabel || "Not set"} dim={!row.sizeLabel} />
                <DetailRow label="Remarks" value={row.remarks || "Not set"} dim={!row.remarks} />
                <DetailRow label="Created" value={fmtLocalDateTime(row.createdTime)} />
                <DetailRow label="Modified" value={fmtLocalDateTime(row.modifiedTime)} />
              </div>
            </div>

            <div className="form-section-title" style={{ margin: "14px 0 8px" }}>Activity</div>
            <ActivityLog table="ContainerFormat" entityId={row.id} />
          </>
        )}
      </div>
    </div>
  );
}
