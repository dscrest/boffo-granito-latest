/* ============================================================
   CR-345: ONE "New Order" entry for Panel Craft — the user picks the TYPE
   first (Panel | Sample) and the matching form page renders underneath.
   Both child pages read the same URL, so ?fromOrder= / ?fromQuote= pass
   straight through ("Request Panels" / "Request Samples" still work);
   a /sample-orders/new path or ?type=Sample starts on the Sample layout.
   Edit / clone stay on the typed routes — the type is known there.
   ============================================================ */
import { useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { Combobox } from "@/ui/Combobox";
import { PanelOrderFormPage } from "./PanelOrderFormPage";
import { SampleOrderFormPage } from "./SampleOrderFormPage";

const TYPES = [
  { value: "Panel", label: "Panel order", hint: "showcase panels + cut pieces" },
  { value: "Sample", label: "Sample order", hint: "full tiles / cut pieces to a customer" },
];

export function OrderFormPage() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const { id = "" } = useParams();
  const [type, setType] = useState<"Panel" | "Sample">(params.get("type") === "Sample" || pathname.startsWith("/sample-orders") ? "Sample" : "Panel");
  const isCreate = !id;
  return (
    <>
      {isCreate && (
        <div className="fbar" style={{ marginBottom: 8 }}>
          <span className="muted" style={{ fontWeight: 600 }}>Order type</span>
          <Combobox value={type} options={TYPES} onChange={(v) => setType(v === "Sample" ? "Sample" : "Panel")} clearable={false} ariaLabel="Order type" className="dial" />
        </div>
      )}
      {type === "Panel" ? <PanelOrderFormPage key="p" /> : <SampleOrderFormPage key="s" />}
    </>
  );
}
