/* ============================================================
   Organization profile pane (CR-445) — Settings ▸ Organization.
   Logo + Company Name mandatory; everything else optional. Saves
   org_* AppSetting rows (Admin-only on the server) and refreshes
   the branding every screen / PDF reads from lib/org.ts.
   ============================================================ */
import { useEffect, useState } from "react";
import { ImageUploader } from "@/ui/ImageUploader";
import { toast } from "@/ui/Toast";
import { EMPTY_ORG, getOrgSaved, loadOrg, type OrgProfile as Org } from "@/lib/org";
import { setOrgProfile } from "./settingsApi";

type Field = { key: keyof Org; label: string; req?: boolean; textarea?: boolean };
const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: "Identity", fields: [{ key: "name", label: "Company Name", req: true }, { key: "legalName", label: "Legal Name" }] },
  { title: "Tax", fields: [{ key: "gstin", label: "GSTIN" }, { key: "pan", label: "PAN" }, { key: "iec", label: "IEC" }] },
  { title: "Contact", fields: [{ key: "address", label: "Address", textarea: true }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "website", label: "Website" }] },
  { title: "Bank", fields: [{ key: "bankBeneficiary", label: "Beneficiary" }, { key: "bankName", label: "Bank" }, { key: "bankAccount", label: "A/C No." }, { key: "bankIfsc", label: "IFSC" }, { key: "bankSwift", label: "SWIFT" }] },
];

export function OrgProfile() {
  const [saved, setSaved] = useState<Org | null>(null);
  const [draft, setDraft] = useState<Org>(EMPTY_ORG);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadOrg().then(() => { setSaved(getOrgSaved()); setDraft(getOrgSaved()); });
  }, []);

  const dirty = !!saved && (Object.keys(draft) as (keyof Org)[]).some((k) => draft[k] !== saved[k]);
  const set = (k: keyof Org, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const onSave = async () => {
    if (!dirty || busy) return;
    if (!draft.logo) { toast.error("Upload a logo"); return; }
    if (!draft.name.trim()) { toast.error("Company Name is required"); return; }
    setBusy(true);
    const res = await setOrgProfile(draft);
    setBusy(false);
    if (!res.ok) { toast.error(res.error || "Could not save the organization profile"); return; }
    setSaved(getOrgSaved()); setDraft(getOrgSaved());
    toast.success("Organization profile saved");
  };

  const disabled = busy || saved === null;
  return (
    <div className="card">
      <div className="card-body">
        <div className="form-rows">
          <div className="form-field span2">
            <span className="lbl">Logo<span className="req"> *</span></span>
            <ImageUploader
              value={draft.logo ? { id: draft.logo, name: "Logo" } : null}
              onChange={(img) => set("logo", img?.id ?? "")}
              accept="image/png,image/jpeg"
            />
          </div>
          {SECTIONS.map((sec, i) => (
            <SectionRows key={sec.title} first={i === 0} fields={sec.fields} draft={draft} disabled={disabled} set={set} />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <span className="df-req-note">* indicates a mandatory field</span>
          <button className="btn" disabled={disabled || !dirty} onClick={() => saved && setDraft(saved)}>Cancel</button>
          <button className="btn primary" disabled={disabled || !dirty} onClick={() => void onSave()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function SectionRows({ first, fields, draft, disabled, set }: { first: boolean; fields: Field[]; draft: Org; disabled: boolean; set: (k: keyof Org, v: string) => void }) {
  return (
    <>
      {!first && <div className="form-divider" />}
      {fields.map((f) => (
        <label key={f.key} className={`form-field${f.textarea ? " span2" : ""}`}>
          <span className="lbl">{f.label}{f.req && <span className="req"> *</span>}</span>
          {f.textarea ? (
            <textarea value={draft[f.key]} maxLength={255} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
          ) : (
            <input type="text" value={draft[f.key]} maxLength={255} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </label>
      ))}
    </>
  );
}
