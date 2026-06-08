/* ============================================================
   New Party (Customer) form — captures the Catalyst `Customer`
   schema. FRONTEND-ONLY: emits a PartyDraft to Parties' local
   state (no DB writes yet). Field keys match the Data Store
   column names for 1:1 API wiring later. Reuses shared form/modal
   CSS (df-*, form-*).
   ============================================================ */
import { useState } from "react";
import { Icon } from "@/ui/Icon";

export interface PartyDraft {
  _id: string;
  code: string;
  name: string;
  country: string;
  flag: string;
  country_code: string;
  currency: string;
  payment_term: string;
  port_of_discharge: string;
  address: string;
  active: string;
}

/* country → ISO code + flag (Data Store stores ISO, not emoji). */
const COUNTRIES: Record<string, { iso: string; flag: string }> = {
  Poland: { iso: "PL", flag: "🇵🇱" },
  Lithuania: { iso: "LT", flag: "🇱🇹" },
  Romania: { iso: "RO", flag: "🇷🇴" },
  Greece: { iso: "GR", flag: "🇬🇷" },
  India: { iso: "IN", flag: "🇮🇳" },
};
const CURRENCIES = ["EUR", "USD", "INR"];
const PAYMENT_TERMS = ["Advance", "Credit 30", "Net 15", "Net 30", "Net 45", "Net 60"];

let _seq = 0;
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p${++_seq}`;

export function PartyForm({
  onSave,
  onClose,
}: {
  onSave: (p: PartyDraft) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    name: "",
    code: "",
    country: "",
    currency: "EUR",
    payment_term: "",
    port_of_discharge: "",
    address: "",
    active: "Yes",
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  const missing = !v.name.trim() || !v.code.trim();

  const submit = () => {
    if (missing) return;
    const c = COUNTRIES[v.country];
    onSave({
      ...v,
      _id: newId(),
      flag: c?.flag ?? "",
      country_code: c?.iso ?? "",
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel card df-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico">
            <Icon name="flag" size={18} />
          </div>
          <div>
            <div className="ttl">New Party</div>
            <div className="sub2">Customer · local draft — not yet saved to database</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Identity</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">
                  Name<span className="req"> *</span>
                </span>
                <input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Buyer name" />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Code<span className="req"> *</span>
                </span>
                <input value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="MRK" />
              </label>
              <label className="form-field">
                <span className="lbl">Country</span>
                <select value={v.country} onChange={(e) => set("country", e.target.value)}>
                  <option value="">—</option>
                  {Object.keys(COUNTRIES).map((c) => (
                    <option key={c} value={c}>
                      {COUNTRIES[c].flag} {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-title">Commercial</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Currency</span>
                <select value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Payment Term</span>
                <select value={v.payment_term} onChange={(e) => set("payment_term", e.target.value)}>
                  <option value="">—</option>
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Active</span>
                <select value={v.active} onChange={(e) => set("active", e.target.value)}>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <input value={v.port_of_discharge} onChange={(e) => set("port_of_discharge", e.target.value)} placeholder="Gdańsk" />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Address</span>
                <input value={v.address} onChange={(e) => set("address", e.target.value)} placeholder="Billing / shipping address" />
              </label>
            </div>
          </div>
        </div>

        <div className="df-foot">
          <span className="df-req-note">* required</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={missing} onClick={submit}>
            <Icon name="check" size={13} />
            Save party
          </button>
        </div>
      </div>
    </div>
  );
}
