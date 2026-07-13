/* ============================================================
   New Party (Customer) form — captures the Catalyst `Customer`
   schema and emits a CustomerInput for a real Data Store insert
   (Parties owns the createCustomer call). payment_term is a real
   ForeignKey → PaymentTerm, picked from live options. Layout
   mirrors Zoho Books "New Customer": customer type, contact person
   row, company + display name, auto customer number, then billing +
   shipping address columns with a "same as billing" copy toggle.
   The customer code is system-assigned (CUS-00001…, lib/seq) and
   read-only here. Reuses shared form/modal CSS (df-*, form-*).
   ============================================================ */
import React, { useState } from "react";
import { Icon } from "@/ui/Icon";
import { Combobox } from "@/ui/Combobox";
import { useModalA11y } from "@/ui/useModalA11y";
import { storedAuth } from "@/lib/auth";
import {
  composeAddress,
  emptyExtras,
  isoInfo,
  type CustomerExtras,
  type CustomerInput,
  type PaymentTermOption,
} from "./customersApi";

/* Full ISO 3166-1 alpha-2 list (Data Store stores ISO, not emoji);
   display name + flag are derived via isoInfo / Intl.DisplayNames. */
const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AR", "AT", "AU", "AW", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BM", "BN", "BO", "BR",
  "BS", "BT", "BW", "BY", "BZ", "CA", "CD", "CF", "CG", "CH", "CI", "CL", "CM",
  "CN", "CO", "CR", "CU", "CV", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ",
  "EC", "EE", "EG", "ER", "ES", "ET", "FI", "FJ", "FM", "FR", "GA", "GB", "GD",
  "GE", "GH", "GM", "GN", "GQ", "GR", "GT", "GW", "GY", "HK", "HN", "HR", "HT",
  "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JM", "JO", "JP", "KE",
  "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KZ", "LA", "LB", "LC", "LI",
  "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH",
  "MK", "ML", "MM", "MN", "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NE", "NG", "NI", "NL", "NO", "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH",
  "PK", "PL", "PT", "PW", "PY", "QA", "RO", "RS", "RU", "RW", "SA", "SB", "SC",
  "SD", "SE", "SG", "SI", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SY", "SZ", "TD", "TG", "TH", "TJ", "TL", "TM", "TN", "TO", "TR", "TT", "TV",
  "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VC", "VE", "VN", "VU", "WS", "YE",
  "ZA", "ZM", "ZW",
];
/* Address "Country/Region": typable pick list storing the display name
   (billing_country / shipping_country are free-text varchar columns).
   Exported for CustomerDetail's Add-address modal. */
export const COUNTRY_NAME_OPTIONS = COUNTRY_CODES.map((iso) => {
  const { country, flag } = isoInfo(iso);
  return { value: country, label: `${flag} ${country}` };
}).sort((a, b) => a.value.localeCompare(b.value));
/* country_code (ISO — feeds the grid flag & currency) is derived from the
   billing-address country name; no separate Country field in the form. */
const NAME_TO_ISO = new Map(COUNTRY_CODES.map((iso) => [isoInfo(iso).country, iso]));

const CURRENCIES = ["EUR", "USD", "INR"];
/* Country → currency auto-set: IN → INR, Eurozone → EUR, everything else → USD. */
const EUROZONE = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);
const currencyFor = (iso: string) => (iso === "IN" ? "INR" : EUROZONE.has(iso) ? "EUR" : "USD");
const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr."];

const EMAIL_RE = /^\S+@\S+\.\S+$/;

/* Phone numbers are stored as one string ("+91 9876543210"); the UI
   splits them into a dial-code select + a digits-only input. */
const DIAL_CODES = ["+91", "+1", "+7", "+30", "+31", "+33", "+34", "+39", "+40", "+44", "+46", "+48", "+49", "+966", "+971"];
function splitPhone(s: string): { dial: string; num: string } {
  const m = /^(\+\d{1,4})\s*(.*)$/.exec(s.trim());
  return m ? { dial: m[1], num: m[2] } : { dial: "+91", num: s.trim() };
}
function joinPhone(p: { dial: string; num: string }): string {
  return p.num ? `${p.dial} ${p.num}` : "";
}

/* One row of the Contact Persons tab (additional contacts; the primary
   contact stays in the flat contact_* columns edited up top). Persisted
   as a JSON array in Customer.contact_persons (text). */
interface ContactDraft {
  salutation: string;
  first_name: string;
  last_name: string;
  email: string;
  work: { dial: string; num: string };
  mobile: { dial: string; num: string };
  ch_email: boolean;
  ch_sms: boolean;
}
const emptyContact = (): ContactDraft => ({
  salutation: "",
  first_name: "",
  last_name: "",
  email: "",
  work: splitPhone(""),
  mobile: splitPhone(""),
  ch_email: true, // Books default: Email channel on
  ch_sms: false,
});
function parseContacts(json: string): ContactDraft[] {
  try {
    const arr: unknown = JSON.parse(json || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((c: Record<string, unknown>) => ({
      salutation: String(c.salutation ?? ""),
      first_name: String(c.first_name ?? ""),
      last_name: String(c.last_name ?? ""),
      email: String(c.email ?? ""),
      work: splitPhone(String(c.work_phone ?? "")),
      mobile: splitPhone(String(c.mobile ?? "")),
      ch_email: c.ch_email !== false,
      ch_sms: c.ch_sms === true,
    }));
  } catch {
    return []; // corrupt/legacy value — start with an empty grid
  }
}
function serializeContacts(contacts: ContactDraft[]): string {
  const rows = contacts
    .map((c) => ({
      salutation: c.salutation.trim(),
      first_name: c.first_name.trim(),
      last_name: c.last_name.trim(),
      email: c.email.trim(),
      work_phone: joinPhone(c.work),
      mobile: joinPhone(c.mobile),
      ch_email: c.ch_email,
      ch_sms: c.ch_sms,
    }))
    .filter((c) => c.first_name || c.last_name || c.email || c.work_phone || c.mobile);
  return JSON.stringify(rows);
}

/* One address column (billing_* or shipping_*). Field order mirrors Books.
   Labels exported for CustomerDetail's Add-address modal. */
const ADDRESS_KEYS = ["attention", "country", "street1", "street2", "city", "state", "pincode", "phone"] as const;
export const ADDRESS_LABELS: Record<(typeof ADDRESS_KEYS)[number], string> = {
  attention: "Attention",
  country: "Country/Region",
  street1: "Street 1",
  street2: "Street 2",
  city: "City",
  state: "State",
  pincode: "Pin Code",
  phone: "Phone",
};

export function PartyForm({
  paymentTerms,
  salesPersons,
  initial,
  isEdit,
  onSave,
  onClose,
}: {
  paymentTerms: PaymentTermOption[];
  salesPersons: PaymentTermOption[];
  initial?: Partial<CustomerInput>;
  isEdit?: boolean;
  onSave: (c: CustomerInput) => void;
  onClose: () => void;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    currency: initial?.currency ?? "",
    payment_term: initial?.payment_term ?? "",
    port_of_discharge: initial?.port_of_discharge ?? "",
    address: initial?.address ?? "",
    active: initial?.active ?? true,
  });
  const [x, setX] = useState<CustomerExtras>(() => {
    const base = emptyExtras();
    for (const k of Object.keys(base) as (keyof CustomerExtras)[]) {
      base[k] = (initial?.[k] as string) ?? "";
    }
    if (!base.customer_type) base.customer_type = "business";
    // New customers default to the logged-in user as Sales Person.
    if (!isEdit && !base.handling_person) {
      const me = (storedAuth()?.user.email ?? "").toLowerCase();
      base.handling_person = salesPersons.find((s) => (s.email ?? "").toLowerCase() === me)?.id ?? "";
    }
    return base;
  });
  const [workPhone, setWorkPhone] = useState(() => splitPhone((initial?.contact_work_phone as string) ?? ""));
  const [mobile, setMobile] = useState(() => splitPhone((initial?.contact_mobile as string) ?? ""));
  // Books-style tab strip below the always-visible Customer section. All
  // form state lives up here, so switching tabs never loses anything.
  const [tab, setTab] = useState<"other" | "address" | "contacts">("other");
  const [contacts, setContacts] = useState<ContactDraft[]>(() => {
    const parsed = parseContacts((initial?.contact_persons as string) ?? "");
    return parsed.length ? parsed : [emptyContact()]; // one visible row for data entry
  });
  // "Same as billing": on for a new customer; on edit, only when shipping
  // already mirrors billing (or is empty).
  const [sameAsBilling, setSameAsBilling] = useState(() =>
    ADDRESS_KEYS.every((k) => {
      const ship = (initial?.[`shipping_${k}`] as string) ?? "";
      return !ship || ship === ((initial?.[`billing_${k}`] as string) ?? "");
    }),
  );

  const set = (k: string, val: string | boolean) => setV((p) => ({ ...p, [k]: val }));
  // While "same as billing" is on, billing edits write their shipping twin
  // too, so shipping state is always real (no render-time mirroring).
  const setExtra = (k: keyof CustomerExtras, val: string) =>
    setX((p) => {
      const n = { ...p, [k]: val };
      if (sameAsBilling && k.startsWith("billing_")) {
        n[`shipping_${k.slice("billing_".length)}` as keyof CustomerExtras] = val;
      }
      return n;
    });
  const toggleSameAsBilling = (checked: boolean) => {
    setSameAsBilling(checked);
    if (checked) {
      setX((p) => {
        const n = { ...p };
        for (const k of ADDRESS_KEYS) n[`shipping_${k}`] = p[`billing_${k}`];
        return n;
      });
    }
  };

  const setContact = (i: number, patch: Partial<ContactDraft>) =>
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const missing = !x.company_name.trim();
  const emailBad = !!x.contact_email.trim() && !EMAIL_RE.test(x.contact_email.trim());
  // Contact-person rows: fully blank rows are ignored (dropped on save), but
  // a row someone started needs a first name, a valid email and a phone.
  // Validated from lifted state, so errors on a hidden tab still block Save.
  const rowHasData = (c: ContactDraft) =>
    !!(c.first_name.trim() || c.last_name.trim() || c.email.trim() || c.work.num || c.mobile.num);
  const rowInvalid = (c: ContactDraft) =>
    rowHasData(c) &&
    (!c.first_name.trim() || !EMAIL_RE.test(c.email.trim()) || !(c.work.num || c.mobile.num));
  const contactBad = contacts.some(rowInvalid);
  const blocked = missing || emailBad || contactBad;

  // Display Name suggestions à la Books: company + contact permutations.
  // The current value must always be an option or the Combobox shows blank.
  const contactFull = [x.contact_first_name, x.contact_last_name].map((s) => s.trim()).filter(Boolean).join(" ");
  const contactSaluted = [x.contact_salutation.trim(), contactFull].filter(Boolean).join(" ");
  const displayNameOptions = [
    ...new Set([x.company_name.trim(), contactFull, contactSaluted, v.name.trim()].filter(Boolean)),
  ].map((n) => ({ value: n, label: n }));

  const submit = () => {
    if (blocked) return;
    const extras = {
      ...x,
      contact_work_phone: joinPhone(workPhone),
      contact_mobile: joinPhone(mobile),
      contact_persons: serializeContacts(contacts),
    };
    // Keep the legacy one-line `address` (quote/order autofill reads it):
    // composed from billing parts, falling back to whatever was typed before.
    const composed = composeAddress(extras, "billing");
    onSave({
      name: v.name.trim() || x.company_name.trim(),
      code: v.code,
      // Derived from billing country; legacy code kept when the name is
      // blank or unrecognized (hand-typed via onCreate).
      country_code: NAME_TO_ISO.get(x.billing_country.trim()) ?? initial?.country_code ?? "",
      currency: v.currency,
      payment_term: v.payment_term,
      port_of_discharge: v.port_of_discharge,
      address: composed || v.address,
      active: v.active,
      ...extras,
    });
  };

  const panelRef = useModalA11y(onClose);

  const addressColumn = (prefix: "billing" | "shipping", disabled: boolean) => (
    <div style={{ display: "grid", gap: 8 }}>
      {ADDRESS_KEYS.map((k) => {
        const key = `${prefix}_${k}` as keyof CustomerExtras;
        if (k === "country") {
          return (
            // Combobox has no disabled prop — block interaction via the wrapper
            // (the shipping column is already dimmed while "same as billing").
            <div key={key} className="form-field" style={disabled ? { pointerEvents: "none" } : undefined}>
              <span className="lbl">{ADDRESS_LABELS[k]}</span>
              <Combobox
                value={x[key]}
                options={COUNTRY_NAME_OPTIONS}
                onChange={(val) => {
                  setExtra(key, val);
                  // Billing country drives the currency; stays user-editable after.
                  const iso = NAME_TO_ISO.get(val);
                  if (prefix === "billing" && iso) set("currency", currencyFor(iso));
                }}
                onCreate={(label) => setExtra(key, label)}
                placeholder="Select or type a country"
              />
            </div>
          );
        }
        return (
          <label key={key} className="form-field">
            <span className="lbl">{ADDRESS_LABELS[k]}</span>
            <input
              value={x[key]}
              disabled={disabled}
              onChange={(e) => setExtra(key, e.target.value)}
              placeholder={ADDRESS_LABELS[k]}
            />
          </label>
        );
      })}
    </div>
  );

  const phoneField = (
    label: string,
    p: { dial: string; num: string },
    setP: (p: { dial: string; num: string }) => void,
  ) => (
    <label className="form-field">
      <span className="lbl">{label}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          value={p.dial}
          onChange={(e) => setP({ ...p, dial: e.target.value })}
          style={{ flex: "0 0 86px", width: 86 }}
        >
          {DIAL_CODES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          value={p.num}
          inputMode="numeric"
          maxLength={10}
          onChange={(e) => setP({ ...p, num: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          placeholder={label}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
    </label>
  );

  return (
    <div className="modal-backdrop">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="modal-panel card df-modal"
        style={{ maxWidth: 1000 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="df-head">
          <div className="ico">
            <Icon name="flag" size={18} />
          </div>
          <div>
            <div className="ttl">{isEdit ? "Edit Customer" : "New Customer"}</div>
            <div className="sub2">
              {isEdit ? "Editing saved customer — changes overwrite the database record" : "Customer · saves to the Customer master"}
            </div>
          </div>
          <button className="btn x" style={{ marginLeft: "auto" }} onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="df-body">
          <div className="form-section">
            <div className="form-section-title">Customer</div>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label className="form-field">
                <span className="lbl">Customer Type</span>
                <div style={{ display: "flex", gap: 18, alignItems: "center", minHeight: 34 }}>
                  {(["business", "individual"] as const).map((t) => (
                    <span
                      key={t}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                      onClick={() => setExtra("customer_type", t)}
                    >
                      <input
                        type="radio"
                        name="customer_type"
                        checked={x.customer_type === t}
                        onChange={() => setExtra("customer_type", t)}
                      />
                      {t === "business" ? "Business" : "Individual"}
                    </span>
                  ))}
                </div>
              </label>
              <label className="form-field">
                <span className="lbl">Customer Number</span>
                <input
                  value={v.code}
                  readOnly
                  tabIndex={-1}
                  placeholder="Auto-assigned (CUS-…)"
                  title="System-assigned customer number"
                />
              </label>
              <label className="form-field">
                <span className="lbl">
                  Company Name<span className="req"> *</span>
                </span>
                <input
                  className={missing ? "error" : undefined}
                  value={x.company_name}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Display Name follows Company Name until the user types their own.
                    setV((p) =>
                      !p.name.trim() || p.name === x.company_name ? { ...p, name: val } : p,
                    );
                    setExtra("company_name", val);
                  }}
                  placeholder="Company Name"
                />
              </label>
              <label className="form-field">
                <span className="lbl">Display Name</span>
                <Combobox
                  value={v.name}
                  options={displayNameOptions}
                  onChange={(val) => set("name", val)}
                  onCreate={(label) => set("name", label)}
                  placeholder="Same as Company Name if left blank"
                />
              </label>
              <label className="form-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lbl">Primary Contact</span>
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr", gap: 6 }}>
                  <select value={x.contact_salutation} onChange={(e) => setExtra("contact_salutation", e.target.value)} title="Salutation">
                    <option value=""></option>
                    {SALUTATIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    value={x.contact_first_name}
                    onChange={(e) => setExtra("contact_first_name", e.target.value)}
                    placeholder="First Name"
                  />
                  <input
                    value={x.contact_last_name}
                    onChange={(e) => setExtra("contact_last_name", e.target.value)}
                    placeholder="Last Name"
                  />
                </div>
              </label>
              <label className="form-field">
                <span className="lbl">Email Address</span>
                <input
                  type="email"
                  className={emailBad ? "error" : undefined}
                  value={x.contact_email}
                  onChange={(e) => setExtra("contact_email", e.target.value)}
                  placeholder="name@company.com"
                />
                {emailBad && (
                  <span style={{ fontSize: 11, color: "var(--c-red)" }}>Enter a valid email address</span>
                )}
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {phoneField("Work Phone", workPhone, setWorkPhone)}
                {phoneField("Mobile", mobile, setMobile)}
              </div>
            </div>
          </div>

          {/* Books-style tabs; the Customer section above stays visible. */}
          <div className="dtabs" role="tablist" style={{ marginBottom: 14 }}>
            {([["other", "Other Details"], ["address", "Address"], ["contacts", "Contact Persons"]] as const).map(
              ([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={`tab ${tab === id ? "active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                  {id === "contacts" && contacts.filter(rowHasData).length > 0 && (
                    <span className="ct">{contacts.filter(rowHasData).length}</span>
                  )}
                </button>
              ),
            )}
          </div>

          {tab === "other" && (
          <div className="form-section">
            <div className="form-section-title">Other Details</div>
            <div className="form-grid">
              <label className="form-field">
                <span className="lbl">Currency</span>
                <select value={v.currency} onChange={(e) => set("currency", e.target.value)}>
                  <option value=""></option>
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
                  <option value=""></option>
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Sales Person</span>
                <select value={x.handling_person} onChange={(e) => setExtra("handling_person", e.target.value)}>
                  <option value=""></option>
                  {salesPersons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Active</span>
                {/* New customers are always created Active; toggle later via
                    edit or the detail page's More menu. */}
                <select
                  value={v.active ? "Yes" : "No"}
                  disabled={!isEdit}
                  title={isEdit ? undefined : "New customers start as Active"}
                  onChange={(e) => set("active", e.target.value === "Yes")}
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </label>
              <label className="form-field">
                <span className="lbl">Port of Discharge</span>
                <input value={v.port_of_discharge} onChange={(e) => set("port_of_discharge", e.target.value)} placeholder="Gdańsk" />
              </label>
              <label className="form-field">
                <span className="lbl">Main Customer Name</span>
                <input
                  value={x.main_party_name}
                  onChange={(e) => setExtra("main_party_name", e.target.value)}
                  placeholder="Parent / group customer"
                />
              </label>
            </div>
          </div>
          )}

          {tab === "address" && (
          <div className="form-section">
            <div className="form-section-title">
              Address
              <label
                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400, textTransform: "none", letterSpacing: 0, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={sameAsBilling}
                  onChange={(e) => toggleSameAsBilling(e.target.checked)}
                />
                Shipping same as billing
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <div>
                <div className="lbl" style={{ marginBottom: 8, fontWeight: 600 }}>Billing Address</div>
                {addressColumn("billing", false)}
              </div>
              <div style={{ opacity: sameAsBilling ? 0.55 : 1 }}>
                <div className="lbl" style={{ marginBottom: 8, fontWeight: 600 }}>Shipping Address</div>
                {addressColumn("shipping", sameAsBilling)}
              </div>
            </div>
          </div>
          )}

          {tab === "contacts" && (
          <div className="form-section">
            <div className="form-section-title">Contact Persons</div>
            {/* Channels (Email/SMS) column hidden for now per request — the
                ch_email/ch_sms fields stay in state and persist unchanged. */}
            <div style={{ overflowX: "auto" }}>
              <div className="contact-grid" style={{ minWidth: 800, display: "grid", gridTemplateColumns: "80px 1fr 1fr 1.3fr 170px 170px 30px", gap: 6, alignItems: "center" }}>
                {["Salutation", "First Name", "Last Name", "Email Address", "Work Phone", "Mobile", ""].map((h, i) => (
                  <span key={i} className="lbl">{h}</span>
                ))}
                {contacts.map((c, i) => {
                  const started = rowHasData(c);
                  const phoneCell = (
                    p: { dial: string; num: string },
                    setP: (p: { dial: string; num: string }) => void,
                    label: string,
                  ) => (
                    <div style={{ display: "flex", gap: 4 }}>
                      <select
                        value={p.dial}
                        aria-label={`${label} dial code`}
                        onChange={(e) => setP({ ...p, dial: e.target.value })}
                        style={{ flex: "0 0 64px", width: 64 }}
                      >
                        {DIAL_CODES.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                      <input
                        value={p.num}
                        inputMode="numeric"
                        maxLength={10}
                        aria-label={label}
                        className={started && !(c.work.num || c.mobile.num) ? "error" : undefined}
                        onChange={(e) => setP({ ...p, num: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                    </div>
                  );
                  return (
                    // eslint-disable-next-line react/no-array-index-key
                    <React.Fragment key={i}>
                      <select value={c.salutation} onChange={(e) => setContact(i, { salutation: e.target.value })}>
                        <option value=""></option>
                        {SALUTATIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        value={c.first_name}
                        placeholder="First Name"
                        className={started && !c.first_name.trim() ? "error" : undefined}
                        onChange={(e) => setContact(i, { first_name: e.target.value })}
                      />
                      <input value={c.last_name} placeholder="Last Name" onChange={(e) => setContact(i, { last_name: e.target.value })} />
                      <input
                        type="email"
                        className={started && !EMAIL_RE.test(c.email.trim()) ? "error" : undefined}
                        value={c.email}
                        placeholder="name@company.com"
                        onChange={(e) => setContact(i, { email: e.target.value })}
                      />
                      {phoneCell(c.work, (p) => setContact(i, { work: p }), "Work Phone")}
                      {phoneCell(c.mobile, (p) => setContact(i, { mobile: p }), "Mobile")}
                      <button
                        className="btn x"
                        title="Remove contact person"
                        onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <button className="hbtn" style={{ marginTop: 10 }} onClick={() => setContacts((cs) => [...cs, emptyContact()])}>
              <Icon name="plus" size={13} />
              Add Contact Person
            </button>
          </div>
          )}
        </div>

        <div className="df-foot">
          <span className="df-req-note">* Indicates a mandatory field</span>
          {contactBad && (
            <span style={{ fontSize: 11, color: "var(--c-red)" }}>
              Contact Persons tab: each contact needs a first name, valid email and a phone number
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="hbtn primary" disabled={blocked} onClick={submit}>
            <Icon name="check" size={13} />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
