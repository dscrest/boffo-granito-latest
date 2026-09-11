/* Customer Sheet (/loading, 4th view) — the Excel-style customer loading
   sheet: pick one customer, every loaded line across all their SOs, grouped
   by container with merged (rowSpan) container cells, auto-computed pallet
   number ranges ("1 TO 16") and the Pallet master's A/B arrangements as the
   PALLET-1 / PALLET-2 columns. Always editable in place (canEdit): load-detail
   captures (P.O. / L.R. / truck / container / seals) + a per-line Box Brand
   override stage into draft maps; Save/Cancel appear once dirty and save
   sequentially (ProductionTable idiom). Also embedded SO-scoped (`soFilter`)
   as the Loading Workspace's sheet tab. */
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/ui/Toast";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { EmptyState } from "@/ui/States";
import { Combobox } from "@/ui/Combobox";
import { update } from "@/lib/dataOps";
import { usePersistedState } from "@/lib/usePersistedState";
import { listPallets, type PalletRow } from "@/features/masters/palletsApi";
import { listMaster, type MasterRow } from "@/features/masters/mastersApi";
import { listVehicles, type VehicleRow } from "@/features/masters/vehiclesApi";
import { invalidateOrders } from "@/features/orders/ordersApi";
import {
  boxLabel,
  invalidatePalPlans,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlanLine,
} from "./palPlansApi";
import {
  palletRanges,
  resolveCustomerSheet,
  type BoxDraft,
  type LineDraft,
  type SoDraft,
} from "./customerSheetEdit";

type Group = { box: LoadBox; lines: PalPlanLine[] };

export function LoadingCustomerSheet({
  rows,
  canEdit,
  onSaved,
  soFilter,
}: {
  rows: Array<{ l: PalPlanLine; box?: LoadBox }>;
  canEdit: boolean;
  onSaved: () => void;
  /** Scope to one SalesOrder ROWID (Loading Workspace's sheet tab) —
      replaces the customer picker: rows filter by SO, picker hidden. */
  soFilter?: string;
}) {
  const [customerId, setCustomerId] = usePersistedState("loading.customerSheet.customer", "");

  // Reference data: pallet arrangements + Box Brand names (cached fetches).
  const [palletById, setPalletById] = useState<Map<string, PalletRow>>(new Map());
  const [brands, setBrands] = useState<MasterRow[]>([]);
  useEffect(() => {
    void listPallets().then((r) => {
      if (r.ok) setPalletById(new Map(r.pallets.map((p) => [p.id, p])));
    });
    void listMaster("Brand", ["name"]).then((r) => {
      if (r.ok) setBrands(r.rows.slice().sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);
  const brandName = (id: string) => brands.find((b) => b._id === id)?.name || "";

  // Customers present on the loading board (DB-sourced by construction).
  const customers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.box && r.l.customerId) m.set(r.l.customerId, r.l.customerName);
    return [...m.entries()]
      .map(([id, name]) => ({ value: id, label: name || id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  // One group per container, lines ordered SO then position; containers by label.
  const groups: Group[] = useMemo(() => {
    const byBox = new Map<string, Group>();
    for (const r of rows) {
      if (!r.box || (soFilter ? r.l.salesOrderId !== soFilter : r.l.customerId !== customerId)) continue;
      const g = byBox.get(r.box.id) ?? { box: r.box, lines: [] };
      g.lines.push(r.l);
      byBox.set(r.box.id, g);
    }
    const arr = [...byBox.values()];
    arr.forEach((g) =>
      g.lines.sort((a, b) => a.soNumber.localeCompare(b.soNumber) || a.position - b.position),
    );
    arr.sort((a, b) => boxLabel(a.box).localeCompare(boxLabel(b.box)));
    return arr;
  }, [rows, customerId, soFilter]);

  const rangesOf = (g: Group) =>
    palletRanges(
      g.lines.map((l) => ({
        id: l.id,
        boxes: l.boxes,
        boxesPerPallet: palletById.get(l.palletId)?.boxesPerPallet || 0,
      })),
    );

  // ---- always-editable (2026-09-11, per the "Loading Sheet" design):
  // canEdit renders house-skinned inputs directly; drafts + explicit Save
  // (ProductionTable idiom) — Save/Cancel appear only once dirty.
  const [saving, setSaving] = useState(false);
  const [boxDraft, setBoxDraft] = useState<Record<string, BoxDraft>>({});
  const [lineDraft, setLineDraft] = useState<Record<string, LineDraft>>({});
  const [soDraft, setSoDraft] = useState<Record<string, SoDraft>>({});
  const [vehicles, setVehicles] = useState<VehicleRow[] | null>(null);
  useEffect(() => {
    if (canEdit && vehicles === null) {
      void listVehicles().then((r) => setVehicles(r.ok ? r.vehicles : []));
    }
  }, [canEdit, vehicles]);

  const current = useMemo(
    () => ({
      boxes: Object.fromEntries(
        groups.map((g) => [
          g.box.id,
          {
            containerNumber: g.box.containerNumber,
            lrNumber: g.box.lrNumber,
            electronicSeal: g.box.electronicSeal,
            lineSeal: g.box.lineSeal,
            vehicleId: g.box.vehicleId,
          },
        ]),
      ),
      lines: Object.fromEntries(groups.flatMap((g) => g.lines.map((l) => [l.id, l.boxBrandId]))),
      sos: Object.fromEntries(groups.flatMap((g) => g.lines.map((l) => [l.salesOrderId, l.poNumber]))),
    }),
    [groups],
  );
  const resolved = resolveCustomerSheet(current, { boxes: boxDraft, lines: lineDraft, sos: soDraft });

  const setBoxCell = (id: string, patch: BoxDraft) =>
    setBoxDraft((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  const clearDrafts = () => {
    setBoxDraft({});
    setLineDraft({});
    setSoDraft({});
  };
  const cancelEdit = async () => {
    if (resolved.dirty && !(await confirmDialog({ message: "Discard unsaved changes?", danger: true }))) return;
    clearDrafts();
  };

  const save = async () => {
    if (!resolved.dirty || saving) return;
    setSaving(true);
    // ponytail: sequential per-record writes, no bulk endpoint — a failed row
    // stays drafted so Save can be retried for just the failures.
    const failedBox: Record<string, BoxDraft> = {};
    const failedLine: Record<string, LineDraft> = {};
    const failedSo: Record<string, SoDraft> = {};
    for (const o of resolved.boxOps) {
      const r = await updateLoadBox(o.id, o.patch as LoadingCapture & { vehicle?: string });
      if (!r.ok) {
        failedBox[o.id] = boxDraft[o.id];
        toast.error(r.error || "Could not save loading details");
      }
    }
    for (const o of resolved.lineOps) {
      const r = await update("PalletizationPlanLine", o.id, o.patch);
      if (!r.ok) {
        failedLine[o.id] = lineDraft[o.id];
        toast.error(r.error || "Could not save the box brand");
      }
    }
    for (const o of resolved.soOps) {
      const r = await update("SalesOrder", o.id, o.patch);
      if (!r.ok) {
        failedSo[o.id] = soDraft[o.id];
        toast.error(r.error || "Could not save the P.O. number");
      }
    }
    setSaving(false);
    const failures = Object.keys(failedBox).length + Object.keys(failedLine).length + Object.keys(failedSo).length;
    setBoxDraft(failedBox);
    setLineDraft(failedLine);
    setSoDraft(failedSo);
    if (failures === 0) toast.success("Loading sheet saved");
    if (resolved.soOps.length) invalidateOrders();
    invalidatePalPlans();
    onSaved();
  };

  // ---- totals ----
  const allLines = groups.flatMap((g) => g.lines);
  const totalBoxes = allLines.reduce((s, l) => s + l.boxes, 0);
  const totalPallets = groups.reduce((s, g) => {
    for (const l of g.lines) {
      const bpp = palletById.get(l.palletId)?.boxesPerPallet || 0;
      if (bpp > 0 && l.boxes > 0) s += Math.ceil(l.boxes / bpp);
    }
    return s;
  }, 0);

  const arrangement = (p: PalletRow | undefined, which: "a" | "b") => {
    if (!p) return "—";
    const boxes = which === "a" ? p.boxesPerPallet : p.bBoxesPerPallet;
    const plts = which === "a" ? p.palletsPerContainer : p.bPalletsPerContainer;
    return boxes > 0 && plts > 0 ? `${boxes} × ${plts}` : "—";
  };

  const dim = { color: "var(--muted)" } as const;

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        {!soFilter && (
          <div style={{ minWidth: 260 }}>
            <Combobox
              value={customerId}
              options={customers}
              onChange={(v) => {
                if (resolved.dirty) {
                  toast.error("Save or cancel the edits first");
                  return;
                }
                setCustomerId(v);
              }}
              placeholder="Pick a customer…"
              ariaLabel="Customer"
            />
          </div>
        )}
        {(customerId || soFilter) && (
          <span className="dim" style={{ fontSize: "var(--t-sm)" }}>
            {groups.length} loading{groups.length === 1 ? "" : "s"} · {allLines.length} line{allLines.length === 1 ? "" : "s"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {canEdit && resolved.dirty && (
          <>
            <button className="hbtn" style={{ height: 26, padding: "0 10px" }} disabled={saving} onClick={() => void cancelEdit()}>
              Cancel
            </button>
            <button className="hbtn primary" style={{ height: 26, padding: "0 10px" }} disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        )}
      </div>

      {!customerId && !soFilter ? (
        <EmptyState title="Pick a customer" hint="The sheet shows all their orders' loadings, container-wise" />
      ) : groups.length === 0 ? (
        <EmptyState title="Nothing loaded yet" hint="Lines appear here once palletised items are loaded into containers" />
      ) : (
        <div style={{ overflow: "auto" }}>
          {/* ponytail: no pager/column-picker — a fixed document-style sheet;
              rowSpan groups don't paginate cleanly and one customer's set is small. */}
          <table className="tbl ruled">
            <thead>
              <tr>
                <th style={{ width: 34 }}>Sr</th>
                <th>P.O. No.</th>
                <th>L.R. No.</th>
                <th>Truck No.</th>
                <th>Container No.</th>
                <th>E-Seal No.</th>
                <th>Line Seal No.</th>
                <th>Box Brand</th>
                <th>Design</th>
                <th>Size</th>
                <th>Finish</th>
                <th>Batch</th>
                <th>Pallet No.</th>
                <th style={{ textAlign: "right" }}>Boxes</th>
                <th title="Arrangement A: boxes per pallet × pallets">Pallet 1</th>
                <th title="Arrangement B: boxes per pallet × pallets">Pallet 2</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const ranges = rangesOf(g);
                const d = boxDraft[g.box.id] ?? {};
                const boxCell = (key: keyof BoxDraft, curVal: string, placeholder: string) =>
                  canEdit ? (
                    <input
                      value={(d[key] as string) ?? curVal}
                      placeholder={placeholder}
                      style={{ width: "100%", minWidth: 90 }}
                      onChange={(ev) => setBoxCell(g.box.id, { [key]: ev.target.value })}
                    />
                  ) : (
                    <span className="nw">{curVal || "—"}</span>
                  );
                return g.lines.map((l, i) => {
                  // P.O. cells merge adjacent same-SO runs within the container.
                  const runStart = i === 0 || g.lines[i - 1].salesOrderId !== l.salesOrderId;
                  const runLen = runStart
                    ? g.lines.slice(i).findIndex((x) => x.salesOrderId !== l.salesOrderId)
                    : 0;
                  const poSpan = runStart ? (runLen === -1 || runLen === 0 ? g.lines.length - i : runLen) : 0;
                  const pallet = palletById.get(l.palletId);
                  const brandOverride = lineDraft[l.id]?.boxBrandId ?? l.boxBrandId;
                  const effectiveBrand = brandOverride || l.customerBoxBrandId;
                  return (
                    <tr key={l.id}>
                      {i === 0 && (
                        <td rowSpan={g.lines.length} className="mono" style={{ textAlign: "center", verticalAlign: "middle" }}>
                          {gi + 1}
                        </td>
                      )}
                      {runStart && (
                        <td rowSpan={poSpan} style={{ verticalAlign: "middle" }}>
                          {canEdit ? (
                            <input
                              value={soDraft[l.salesOrderId]?.poNumber ?? l.poNumber}
                              placeholder={l.soNumber}
                              style={{ width: "100%", minWidth: 90 }}
                              onChange={(ev) =>
                                setSoDraft((p) => ({ ...p, [l.salesOrderId]: { poNumber: ev.target.value } }))
                              }
                            />
                          ) : (
                            <span className="nw" title={l.soNumber}>{l.poNumber || l.soNumber}</span>
                          )}
                        </td>
                      )}
                      {i === 0 && (
                        <>
                          <td rowSpan={g.lines.length} style={{ verticalAlign: "middle" }}>
                            {boxCell("lr_number", g.box.lrNumber, "LR number")}
                          </td>
                          <td rowSpan={g.lines.length} style={{ verticalAlign: "middle" }}>
                            {canEdit ? (
                              <select
                                value={d.vehicle ?? g.box.vehicleId}
                                style={{ width: "100%", minWidth: 110 }}
                                onChange={(ev) => setBoxCell(g.box.id, { vehicle: ev.target.value })}
                              >
                                <option value="">—</option>
                                {(vehicles ?? []).map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {[v.vehicleNumber, v.driverName].filter(Boolean).join(" · ")}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="nw">{g.box.vehicleNumber || "—"}</span>
                            )}
                          </td>
                          <td rowSpan={g.lines.length} style={{ verticalAlign: "middle" }}>
                            {boxCell("container_number", g.box.containerNumber, "e.g. MSCU1234567")}
                          </td>
                          <td rowSpan={g.lines.length} style={{ verticalAlign: "middle" }}>
                            {boxCell("electronic_seal", g.box.electronicSeal, "E-seal no.")}
                          </td>
                          <td rowSpan={g.lines.length} style={{ verticalAlign: "middle" }}>
                            {boxCell("line_seal", g.box.lineSeal, "Line seal no.")}
                          </td>
                        </>
                      )}
                      <td>
                        {canEdit ? (
                          <select
                            value={brandOverride}
                            style={{ width: "100%", minWidth: 110 }}
                            onChange={(ev) =>
                              setLineDraft((p) => ({ ...p, [l.id]: { boxBrandId: ev.target.value } }))
                            }
                          >
                            <option value="">
                              {l.customerBoxBrandId ? `Default · ${brandName(l.customerBoxBrandId)}` : "—"}
                            </option>
                            {brands.map((b) => (
                              <option key={b._id} value={b._id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          /* grey = inherited customer default, normal = line override */
                          <span className="nw" style={brandOverride ? undefined : dim}>
                            {brandName(effectiveBrand) || "—"}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="clip" style={{ maxWidth: 220 }} title={l.designLabel}>
                          {l.designLabel}
                        </span>
                      </td>
                      <td className="nw">{l.sizeCode || "—"}</td>
                      <td className="nw">{l.finish || "—"}</td>
                      <td className="nw mono">{l.batchNumber || "—"}</td>
                      <td className="nw mono" title={pallet ? pallet.name : "Pallet spec unknown"}>
                        {ranges.get(l.id) || "—"}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>{l.boxes}</td>
                      <td className="nw mono">{arrangement(pallet, "a")}</td>
                      <td className="nw mono">{arrangement(pallet, "b")}</td>
                    </tr>
                  );
                });
              })}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={13} style={{ textAlign: "right" }}>
                  Total{totalPallets > 0 ? ` · ${totalPallets} pallets` : ""}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>{totalBoxes}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
