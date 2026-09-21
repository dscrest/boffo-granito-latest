/* ============================================================
   Loading Plan page (CR-227) — TRIAL beside the Loading Session
   (/loading/new stays as is until this is approved). Two steps:
     1 Item selection     → PlanSheetStep (spreadsheet sheet + vehicle strip;
                            mints the LoadBox)
     2 Vehicle assignment → vehicle + loading details + seals on ONE form,
                            loaded items and checks beside it
   Routes: /loading/plan[?so=<id>] and /loading/:id/plan?step=1|2 (bound to
   an Open LoadBox). Client-only — the session's and Assign Vehicle's
   endpoints. One customer, one container per save. Dispatch stays on /loading/:id.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { EmptyState } from "@/ui/States";
import { can } from "@/lib/auth";
import { fmt } from "@/lib/format";
import { resolveVehicle } from "@/features/masters/vehiclesApi";
import { LoadDetailsFields, captureOf, useLoadDetails } from "./LoadDetailsFields";
import { PlanSheetStep } from "./PlanSheetStep";
import { duplicateSeals } from "./sealChecks";
import {
  boxLabel,
  cachedLoadBoxes,
  cachedPalPlans,
  invalidatePalPlans,
  listPalPlans,
  palletsOf,
  updateLoadBox,
  type LoadBox,
  type PalPlan,
  type PalPlanLine,
} from "./palPlansApi";

const STEPS = ["Item selection", "Vehicle assignment"] as const;

export function LoadingPlanPage() {
  const { id = "" } = useParams();
  const boxId = decodeURIComponent(id);
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<PalPlan[]>(() => cachedPalPlans() ?? []);
  const [boxes, setBoxes] = useState<LoadBox[]>(() => cachedLoadBoxes() ?? []);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const res = await listPalPlans();
    setLoading(false);
    if (res.ok) {
      setPlans(res.plans);
      setBoxes(res.boxes);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const box = boxes.find((b) => b.id === boxId);
  const lines = useMemo(() => plans.flatMap((p) => p.lines.filter((l) => boxId && l.loadBoxId === boxId)), [plans, boxId]);
  const step = boxId ? Math.min(2, Math.max(1, Number(params.get("step")) || 1)) : 1;
  const stepUrl = (bid: string, n: number) => `/loading/${encodeURIComponent(bid)}/plan?step=${n}`;
  const exit = () => navigate(box ? `/loading/${encodeURIComponent(box.id)}` : "/loading");

  if (!can("stages", "edit")) return <EmptyState title="No access" hint="Loading needs the Stages edit permission" />;
  if (boxId && !box) {
    return loading ? <div className="muted mono" style={{ padding: 24 }}>Loading…</div> : <EmptyState title="Loading not found" />;
  }
  if (box && box.status !== "Open") {
    return <EmptyState title={`${boxLabel(box)} is dispatched`} hint="A dispatched loading is edited from its detail page" />;
  }

  return (
    <div>
      <nav className="steps" aria-label="Loading steps">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const inner = (
            <>
              <span className="n">{n < step ? <Icon name="check" size={11} /> : n}</span>
              {label}
            </>
          );
          const cls = `step ${n === step ? "active" : n < step ? "done" : ""}`;
          // Step 2 needs the LoadBox step 1 mints.
          return box && n !== step ? (
            <Link key={label} className={cls} to={stepUrl(box.id, n)}>{inner}</Link>
          ) : (
            <span key={label} className={cls} aria-current={n === step ? "step" : undefined}>{inner}</span>
          );
        })}
        {box && <span className="mono dim nw" style={{ marginLeft: "auto" }}>{boxLabel(box)}{lines[0]?.customerName ? ` · ${lines[0].customerName}` : ""}</span>}
        <button className="hbtn" style={box ? undefined : { marginLeft: "auto" }} onClick={exit}>
          <Icon name="chev-l" size={13} /> {box ? "Back to loading" : "Back to Loading"}
        </button>
      </nav>

      {step === 1 && (
        <PlanSheetStep
          plans={plans}
          boxes={boxes}
          box={box}
          presetSalesOrderId={box ? undefined : params.get("so") || undefined}
          onCancel={exit}
          // Reload BEFORE moving on: step 2 seeds its form once from `box`.
          onSaved={async (bid) => {
            await load().catch(() => undefined); // a failed reload must never strand the step
            navigate(stepUrl(bid, 2), { replace: !box });
          }}
        />
      )}
      {step === 2 && box && (
        <VehicleStep key={box.id} box={box} lines={lines} boxes={boxes} onBack={() => navigate(stepUrl(box.id, 1))} onDone={exit} />
      )}
    </div>
  );
}

/* ---------- step 2 · Vehicle assignment ---------- */
function VehicleStep({ box, lines, boxes, onBack, onDone }: {
  box: LoadBox; lines: PalPlanLine[]; boxes: LoadBox[]; onBack: () => void; onDone: () => void;
}) {
  const details = useLoadDetails(box, captureOf(box));
  const { vehicle, capture } = details;
  const [busy, setBusy] = useState(false);

  // Live, off what is typed — warn-only, nothing here blocks Save.
  const dups = duplicateSeals(
    boxes.map((b) => ({ id: b.id, label: boxLabel(b), containerNumber: b.containerNumber, electronicSeal: b.electronicSeal, lineSeal: b.lineSeal })),
    { [box.id]: capture },
    [box.id],
  );
  // Same eight fields as missingLoadDetails (container size is not one of them).
  const blank = [vehicle.vehicle_number, ...Object.entries(capture).filter(([k]) => k !== "container_size").map(([, v]) => v)].filter((v) => !v).length;
  const checks: [string, string][] = [
    ["Items loaded", lines.length > 0 ? "" : "nothing loaded"],
    ["Vehicle assigned", vehicle.vehicle_number.trim() ? "" : "needed to dispatch"],
    ["Load details filled", blank > 0 ? `${blank} blank` : ""],
    ["Container no. and seals unique", dups.length ? `${dups.length} duplicate${dups.length === 1 ? "" : "s"}` : ""],
  ];

  const save = async () => {
    if (busy) return;
    setBusy(true);
    const veh = await resolveVehicle(vehicle);
    const res = veh.ok ? await updateLoadBox(box.id, { ...(veh.rowid ? { vehicle: veh.rowid } : {}), ...capture }) : undefined;
    setBusy(false);
    if (!veh.ok || !res?.ok) {
      toast.error((veh.ok ? res?.error : veh.error) || "Could not save loading details");
      return;
    }
    invalidatePalPlans();
    toast.success("Loading details saved");
    onDone();
  };

  const totalBoxes = lines.reduce((s, l) => s + l.boxes, 0);

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
        <div className="card" style={{ flex: "3 1 520px", padding: "14px 16px" }}>
          <LoadDetailsFields {...details} />
        </div>

        <div style={{ flex: "2 1 360px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card" style={{ padding: "12px 14px", overflowX: "auto" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Loaded items · {boxLabel(box)}</div>
            {lines.length > 0 ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SO No.</th>
                    <th>Design</th>
                    <th>Batch</th>
                    <th className="num" style={{ textAlign: "right" }}>Boxes</th>
                    <th className="num" style={{ textAlign: "right" }}>Pallets</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="mono nw">{l.soNumber}</td>
                      <td><span className="design-name">{l.designLabel}</span></td>
                      <td className="mono nw">{l.batchNumber || "—"}</td>
                      <td className="num mono">{fmt(l.boxes)}</td>
                      <td className="num mono">{palletsOf([l]) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ fontWeight: 600 }}>
                    <td colSpan={3} style={{ textAlign: "right" }}>Total</td>
                    <td className="num mono">{fmt(totalBoxes)}</td>
                    <td className="num mono">{fmt(palletsOf(lines))}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Nothing loaded yet — pick items in step 1.</div>
            )}
          </div>

          <div className="card" style={{ padding: "12px 14px" }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Checks</div>
            {checks.map(([label, note]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
                <span style={{ color: note ? "var(--c-amber)" : "var(--c-green)", display: "flex" }}><Icon name={note ? "alert" : "check"} size={13} /></span>
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ fontSize: "var(--t-sm)", fontWeight: 600, color: note ? "var(--c-amber)" : "var(--c-green)" }}>{note || "OK"}</span>
              </div>
            ))}
            {dups.map((d) => (
              <div key={d.field} role="alert" style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 8, color: "var(--c-amber)", fontSize: "var(--t-sm)" }}>
                <Icon name="alert" size={13} />
                <span>{d.field} <span className="mono">{d.value}</span> is already recorded on <span className="mono">{d.otherLabel}</span>.</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="session-foot">
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onBack} disabled={busy}>Back</button>
        <button className="hbtn primary" onClick={() => void save()} disabled={busy}>
          <Icon name="check" size={13} /> {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
