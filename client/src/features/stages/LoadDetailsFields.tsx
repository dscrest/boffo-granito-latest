/* ============================================================
   Load details field set — Vehicle (free text, CR-185) + the eight
   loading captures. ONE definition shared by the Assign Vehicle modal
   and the Loading Session page (step 2, `sheetOwned` — the sheet above it
   already edits truck / container / seals / LR, CR-225). Nothing is required here.
   ============================================================ */
import { useState } from "react";
import { Combobox } from "@/ui/Combobox";
import { formatVehicleNumber } from "@/features/masters/vehiclesApi";
import { CONTAINER_TYPES } from "@/features/masters/containersApi";
import type { LoadBox, LoadingCapture } from "./palPlansApi";

export type VehicleDraft = { vehicle_number: string; driver_name: string; mobile_number: string };

export function useLoadDetails(
  initialVehicle?: Pick<LoadBox, "vehicleNumber" | "driverName" | "mobileNumber">,
  initialCapture?: LoadingCapture,
) {
  const [vehicle, setVehicle] = useState<VehicleDraft>({
    vehicle_number: initialVehicle?.vehicleNumber || "",
    driver_name: initialVehicle?.driverName || "",
    mobile_number: initialVehicle?.mobileNumber || "",
  });
  const [capture, setCapture] = useState<LoadingCapture>({
    container_number: initialCapture?.container_number || "",
    line_seal: initialCapture?.line_seal || "",
    electronic_seal: initialCapture?.electronic_seal || "",
    loading_supervisor: initialCapture?.loading_supervisor || "",
    container_size: initialCapture?.container_size || "",
    transporter: initialCapture?.transporter || "",
    lr_number: initialCapture?.lr_number || "",
    destination: initialCapture?.destination || "",
  });
  return {
    vehicle,
    capture,
    setVeh: (k: keyof VehicleDraft, v: string) => setVehicle((c) => ({ ...c, [k]: v })),
    setCap: (k: keyof LoadingCapture, v: string) => setCapture((c) => ({ ...c, [k]: v })),
  };
}

/** A LoadBox's current captures in LoadingCapture shape (prefill). */
export const captureOf = (b: LoadBox): LoadingCapture => ({
  container_number: b.containerNumber,
  line_seal: b.lineSeal,
  electronic_seal: b.electronicSeal,
  loading_supervisor: b.loadingSupervisor,
  container_size: b.containerSize,
  transporter: b.transporter,
  lr_number: b.lrNumber,
  destination: b.destination,
});

export function LoadDetailsFields({ vehicle, capture, setVeh, setCap, sheetOwned, part }: ReturnType<typeof useLoadDetails> & {
  /** Hide the fields the Loading Sheet owns (Vehicle No., Container No., seals, LR). */
  sheetOwned?: boolean;
  /** Loading page (CR-247) renders the ONE field set in two places: "details" on top
      (Size, Destination, Transporter, Supervisor), "vehicle" at the bottom (vehicle + container/seals/LR).
      Omitted = everything, as in VehicleLoadModal. Returns bare fields for the caller's .form-grid. */
  part?: "details" | "vehicle";
}) {
  const text = (label: string, k: keyof LoadingCapture, placeholder: string) => (
    <label className="form-field">
      <span className="lbl">{label}</span>
      <input value={capture[k] || ""} placeholder={placeholder} onChange={(e) => setCap(k, e.target.value)} />
    </label>
  );
  const vehicleNo = (
    <label className="form-field">
      <span className="lbl">Vehicle Number</span>
      <input value={vehicle.vehicle_number} autoFocus={!part} placeholder="e.g. GJ-01-AB-1234"
        onChange={(e) => setVeh("vehicle_number", formatVehicleNumber(e.target.value))} />
    </label>
  );
  const driver = (
    <>
      <label className="form-field">
        <span className="lbl">Driver Name</span>
        <input value={vehicle.driver_name} placeholder="Driver name" onChange={(e) => setVeh("driver_name", e.target.value)} />
      </label>
      <label className="form-field">
        <span className="lbl">Mobile</span>
        <input value={vehicle.mobile_number} placeholder="Mobile number" onChange={(e) => setVeh("mobile_number", e.target.value)} />
      </label>
    </>
  );
  const size = (
    <label className="form-field">
      <span className="lbl">Size</span>
      <Combobox
        value={capture.container_size || ""}
        options={CONTAINER_TYPES.map((t) => ({ value: t, label: t }))}
        onChange={(v) => setCap("container_size", v)}
        placeholder="Container size…"
        ariaLabel="Container size"
      />
    </label>
  );
  if (part === "details")
    return (
      <>
        {size}
        {text("Destination / Port", "destination", "Port / city")}
        {text("Transporter", "transporter", "Carrier company")}
        {text("Loading Supervisor", "loading_supervisor", "Name")}
      </>
    );
  if (part === "vehicle")
    return (
      <>
        {vehicleNo}
        {driver}
        {text("Container No.", "container_number", "e.g. MSCU1234567")}
        {text("Line Seal", "line_seal", "Line seal no.")}
        {text("Electronic Seal", "electronic_seal", "E-seal no.")}
        {text("LR / Docket No.", "lr_number", "LR number")}
      </>
    );
  return (
    <div className="form-section">
      <div className="form-section-title">Vehicle</div>
      <div className="form-grid">
        {!sheetOwned && vehicleNo}
        {driver}
      </div>
      <div className="form-section-title" style={{ marginTop: 14 }}>Loading details</div>
      <div className="form-grid">
        {!sheetOwned && text("Container No.", "container_number", "e.g. MSCU1234567")}
        {size}
        {!sheetOwned && text("Line Seal", "line_seal", "Line seal no.")}
        {!sheetOwned && text("Electronic Seal", "electronic_seal", "E-seal no.")}
        {text("Transporter", "transporter", "Carrier company")}
        {!sheetOwned && text("LR / Docket No.", "lr_number", "LR number")}
        {text("Destination / Port", "destination", "Port / city")}
        {text("Loading Supervisor", "loading_supervisor", "Name")}
      </div>
    </div>
  );
}
