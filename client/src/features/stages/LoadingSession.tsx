/* ============================================================
   Loading Session — ONE scrolling page for New Loading AND the loading
   detail's Edit (no steps since 2026-09-21; CR-203's stepper is gone):
     Loaded items      (edit) change qty / remove what is already loaded
     Add pallets       the SessionItemsStep pick list (Ready-for-Loading stock)
     Add items         order items straight in, no palletization (/send-to-loading)
     Vehicle & details the full LoadDetailsFields
   One Save runs it all in order: vehicle → (mint the LoadBox) → unload /
   shrink → add pallets → add items → load details. It stops at the first
   failure; what already saved stays saved and the page reloads for a retry.
   A dispatched loading shows the details section only (the server keeps
   those editable; its lines are immutable).
   Routes: /loading/new[?so=<id>] and /loading/:id/session.
   The ruled Loading Sheet lives on /loading/:id, not here.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { NumberInput } from "@/ui/NumberInput";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import type { Order } from "@/data";
import { cachedOrders, listOrders } from "@/features/orders/ordersApi";
import { resolveVehicle } from "@/features/masters/vehiclesApi";
import { LoadDetailsFields, captureOf, useLoadDetails } from "./LoadDetailsFields";
import { SessionItemsStep, useSessionPick } from "./SessionItemsStep";
import { remainingOf, soSendable } from "./SendToLoadingModal";
import { UNLOAD, resolveLoadSheetEdit, type LoadSheetDraft } from "./loadSheetEdit";
import { duplicateSeals } from "./sealChecks";
import {
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  createLoadBox,
  invalidatePalPlans,
  listPalPlans,
  sendToLoading,
  setLineBox,
  updateLoadBox,
  type LoadBox,
  type LoadingCapture,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const NEW = "__new";

export function LoadingSession() {
  const { id = "" } = useParams();
  const boxId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const canEdit = can("stages", "edit");

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [orders, setOrders] = useState<Order[]>(() => cachedOrders() ?? []);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const [res, ord] = await Promise.all([listPalPlans(), listOrders()]);
    setLoading(false);
    if (res.ok) {
      setPlans(res.plans);
      setBoxes(res.boxes);
    }
    if (ord.ok) setOrders(ord.orders);
  };
  useEffect(() => {
    void load();
  }, []);

  const box = boxes.find((b) => b.id === boxId);
  if (!canEdit) return <EmptyState title="No access" hint="Loading needs the Stages edit permission" />;
  if (boxId && !box) {
    return loading ? <div className="muted mono" style={{ padding: 24 }}>Loading…</div> : <EmptyState title="Loading not found" />;
  }
  // Keyed by box: the details form seeds once from it.
  return <SessionPage key={box?.id || NEW} box={box} plans={plans} boxes={boxes} orders={orders} presetSalesOrderId={box ? undefined : params.get("so") || undefined} reload={load} />;
}

function SessionPage({ box, plans, boxes, orders, presetSalesOrderId, reload }: {
  box?: LoadBox; plans: PalPlan[]; boxes: LoadBox[]; orders: Order[]; presetSalesOrderId?: string; reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const open = !box || box.status === "Open";
  const pick = useSessionPick({ plans, boxes, box, presetSalesOrderId, onSaved: () => undefined });
  const details = useLoadDetails(box, box ? captureOf(box) : undefined);
  // Loaded lines: typed qty per line id ("0" = remove).
  const [loadedDraft, setLoadedDraft] = useState<Record<string, string>>({});
  // Direct order items: boxes per OrderItem id.
  const [direct, setDirect] = useState<Map<string, number>>(new Map());
  const [busy, setBusy] = useState(false);

  const loaded = pick.boxLines;
  const draftOf = (l: PalPlanLine): LoadSheetDraft | undefined => {
    const v = loadedDraft[l.id];
    if (v == null || v.trim() === "") return undefined;
    return parseInt(v, 10) === 0 ? { boxId: UNLOAD } : { qty: v };
  };
  const loadedOps = loaded.map((l) => ({ l, ...resolveLoadSheetEdit(l, box, [], draftOf(l)) }));
  const loadedError = loadedOps.find((o) => o.error)?.error || "";

  // Order items that can go straight in: this customer's (or the preset SO's), with boxes left to send.
  const directBands = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders) {
      if (!o.salesOrderId || !soSendable(o) || remainingOf(o) <= 0) continue;
      if (presetSalesOrderId ? o.salesOrderId !== presetSalesOrderId : !pick.customerId || o.customerId !== pick.customerId) continue;
      m.set(o.salesOrderId, [...(m.get(o.salesOrderId) || []), o]);
    }
    return [...m.entries()];
  }, [orders, presetSalesOrderId, pick.customerId]);
  const directQty = (o: Order) => Math.min(direct.get(o.id) || 0, remainingOf(o));
  const directTotal = directBands.reduce((s, [, items]) => s + items.reduce((n, o) => n + directQty(o), 0), 0);

  const dups = duplicateSeals(
    [
      ...boxes.map((b) => ({ id: b.id, label: boxLabel(b), containerNumber: b.containerNumber, electronicSeal: b.electronicSeal, lineSeal: b.lineSeal })),
      ...(box ? [] : [{ id: NEW, label: "New loading", containerNumber: "", electronicSeal: "", lineSeal: "" }]),
    ],
    { [box?.id || NEW]: details.capture },
    [box?.id || NEW],
  );

  const detailUrl = (bid: string) => `/loading/${encodeURIComponent(bid)}`;
  const back = () => navigate(box ? detailUrl(box.id) : "/loading");

  /** Runs the whole Save in order. Returns [error, boxId reached]. */
  const run = async (): Promise<[string, string]> => {
    if (loadedError) return [loadedError, box?.id || ""];
    const veh = await resolveVehicle(details.vehicle);
    if (!veh.ok) return [veh.error || "Could not save the vehicle", box?.id || ""];

    let bid = box?.id || "";
    if (!box) {
      const typed = Object.fromEntries(Object.entries(details.capture).filter(([, v]) => (v || "").trim())) as LoadingCapture;
      const created = await createLoadBox({ load_plan: pick.loadPlan(), ...(veh.rowid ? { vehicle: veh.rowid } : {}), ...typed });
      if (!created.ok || !created.data?.ROWID) return [created.error || "Could not create the loading", ""];
      bid = String(created.data.ROWID);
    }

    if (open) {
      for (const { l, ops } of loadedOps) {
        if (!ops.unload && !ops.move) continue;
        const r = ops.unload ? await setLineBox(l.id, "") : await setLineBox(l.id, bid, ops.move!.boxes);
        if (!r.ok) return [r.error || "Could not change a loaded item", bid];
      }
      setLoadedDraft({});

      const addErr = await pick.saveAdds(bid);
      if (addErr) return [addErr, bid];

      for (const [soId, items] of directBands) {
        const lines = items.filter((o) => directQty(o) > 0).map((o) => ({ order_item: o.id, boxes: directQty(o) }));
        if (lines.length === 0) continue;
        const r = await sendToLoading({ sales_order: soId, box: bid, lines });
        if (!r.ok) return [r.error || "Could not add the order items", bid];
      }
      setDirect(new Map());
    }

    if (box) {
      const cur = captureOf(box);
      const patch: LoadingCapture & { vehicle?: string } = {};
      for (const k of Object.keys(cur) as (keyof LoadingCapture)[])
        if ((details.capture[k] || "") !== (cur[k] || "")) patch[k] = details.capture[k] || "";
      if (veh.rowid && veh.rowid !== box.vehicleId) patch.vehicle = veh.rowid;
      if (Object.keys(patch).length) {
        const r = await updateLoadBox(box.id, patch);
        if (!r.ok) return [r.error || "Could not save loading details", bid];
      }
    }
    return ["", bid];
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const [err, bid] = await run();
    invalidatePalPlans();
    if (!err) {
      toast.success(box ? "Loading saved" : "Loading created");
      navigate(detailUrl(bid), { replace: !box });
      return;
    }
    toast.error(err);
    await reload().catch(() => undefined);
    setBusy(false);
    // A new loading that got minted before the failure: carry on editing IT — a retry here would mint a second.
    if (!box && bid) navigate(`${detailUrl(bid)}/session`, { replace: true });
  };

  const nothingNew = !box && pick.totalBoxes + directTotal === 0;
  const title = (t: string, sub?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "18px 0 8px" }}>
      <span style={{ fontWeight: 700, fontSize: "var(--t-lg)" }}>{t}</span>
      {sub && <span className="dim" style={{ fontSize: "var(--t-sm)" }}>{sub}</span>}
    </div>
  );

  return (
    <div>
      {/* No page title (user 2026-09-19): the strip carries the loading's identity + Back. */}
      <nav className="steps" aria-label="Loading">
        <span style={{ fontWeight: 700 }}>{box ? "Edit Loading" : "New Loading"}</span>
        {box && <span className="mono dim nw" style={{ marginLeft: "auto" }}>{boxLabel(box)}{loaded[0]?.customerName ? ` · ${loaded[0].customerName}` : ""}</span>}
        <button className="hbtn" style={box ? undefined : { marginLeft: "auto" }} onClick={back}>
          <Icon name="chev-l" size={13} /> {box ? "Back to loading" : "Back to Loading"}
        </button>
      </nav>

      {box && open && loaded.length > 0 && (
        <>
          {title("Loaded items", "type fewer boxes to send the rest back to Ready for Loading · 0 removes the item")}
          <div className="card" style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Design</th>
                  <th>Batch</th>
                  <th>Pallet</th>
                  <th>Order</th>
                  <th className="num" style={{ textAlign: "right" }}>Loaded</th>
                  <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {loadedOps.map(({ l, error }) => {
                  const removed = draftOf(l)?.boxId === UNLOAD;
                  return (
                    <tr key={l.id} style={removed ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                      <td><span className="design-name">{l.designLabel}</span></td>
                      <td className="nw mono">{l.batchNumber || "—"}</td>
                      <td className="nw">{l.palletName || "—"}</td>
                      <td className="nw mono">{l.soNumber || "—"}</td>
                      <td className="num mono">{fmt(l.boxes)}</td>
                      <td className="num" title={error || undefined}>
                        <NumberInput
                          maxDecimals={0}
                          value={loadedDraft[l.id] ?? String(l.boxes)}
                          aria-label={`Boxes loaded, ${l.designLabel} batch ${l.batchNumber || "—"}`}
                          aria-invalid={!!error}
                          onChange={(e) => setLoadedDraft((p) => ({ ...p, [l.id]: e.target.value }))}
                          style={{ width: 90, textAlign: "right", ...(error ? { borderColor: "var(--c-red)" } : {}) }}
                        />
                      </td>
                      <td>
                        <button
                          className="btn x"
                          title={removed ? "Keep this item" : "Remove from this loading"}
                          onClick={() => setLoadedDraft((p) => ({ ...p, [l.id]: removed ? "" : "0" }))}
                        >
                          <Icon name={removed ? "refresh" : "x"} size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <>
          {title("Add pallets", "palletized stock that is Ready for Loading")}
          {/* The pick list scrolls inside its own panels (.session-fill) — give it a fixed window on this page. */}
          <div style={{ height: 460, display: "flex", flexDirection: "column" }}>
            <SessionItemsStep pick={pick} presetSalesOrderId={presetSalesOrderId} />
          </div>

          {title("Add items", "order items straight into this loading — no palletization")}
          <div className="card" style={{ overflowX: "auto" }}>
            {directBands.length === 0 ? (
              <div className="dim" style={{ fontSize: "var(--t-sm)", padding: "12px 14px" }}>
                {pick.customerId || presetSalesOrderId ? "No order items left to send." : "Pick a customer above."}
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Design</th>
                    <th>Order</th>
                    <th className="num" style={{ textAlign: "right" }}>Ordered</th>
                    <th className="num" style={{ textAlign: "right" }}>Available</th>
                    <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                  </tr>
                </thead>
                <tbody>
                  {directBands.flatMap(([, items]) =>
                    items.map((o) => (
                      <tr key={o.id} style={directQty(o) > 0 ? { background: "var(--accent-soft)" } : undefined}>
                        <td><span className="design-name">{o.design}</span></td>
                        <td className="nw mono">{o.orderNumber || o.poNumber || "—"}</td>
                        <td className="num mono">{fmt(o.orderQty)}</td>
                        <td className="num mono">{fmt(remainingOf(o))}</td>
                        <td className="num">
                          <NumberInput
                            maxDecimals={0}
                            value={direct.get(o.id) || ""}
                            placeholder="0"
                            aria-label={`Boxes to add, ${o.design}`}
                            onChange={(e) =>
                              setDirect((p) => new Map(p).set(o.id, Math.max(0, Math.min(remainingOf(o), Math.floor(Number(e.target.value)) || 0))))
                            }
                            style={{ width: 90, textAlign: "right" }}
                          />
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {title("Vehicle & load details")}
      <div className="card" style={{ padding: "14px 16px" }}>
        <LoadDetailsFields {...details} />
      </div>
      {dups.map((d) => (
        <div key={d.field} className="card" role="alert" style={{ marginTop: 10, padding: "9px 12px", display: "flex", gap: 8, alignItems: "center", borderColor: "var(--c-amber)", color: "var(--c-amber)" }}>
          <Icon name="alert" size={14} />
          <span>{d.field} <span className="mono">{d.value}</span> is already recorded on <span className="mono">{d.otherLabel}</span>.</span>
        </div>
      ))}

      <div className="session-foot">
        <span className="mono dim" style={{ flex: 1, fontSize: "var(--t-sm)", color: loadedError ? "var(--c-red)" : undefined }}>
          {loadedError || (pick.totalBoxes + directTotal > 0 && `Adding ${fmt(pick.totalBoxes + directTotal)} boxes${pick.totalPallets > 0 ? ` · ${fmt(pick.totalPallets)} pallets` : ""}`)}
        </span>
        <button className="btn" onClick={back} disabled={busy}>Cancel</button>
        <button className="hbtn primary" disabled={busy || nothingNew || !!loadedError} onClick={() => void save()}>
          <Icon name="check" size={13} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
