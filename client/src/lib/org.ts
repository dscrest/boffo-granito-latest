/* ============================================================
   Organization profile (CR-445) — the ONE source of branding:
   logo, company name, tax ids, contact, bank. Stored as `org_*`
   AppSetting rows, read through the PUBLIC /public/org-profile
   route (login page, shared pages and PDF builders hold no token).
   Sync getter for pdfmake builders; hook for React. Until a profile
   is saved the hard-coded BOFFO values below are the fallback.
   ============================================================ */
import { useSyncExternalStore } from "react";
import { apiGet, designImageUrl } from "@/lib/api";
import boffoLogo from "@/assets/boffo-logo.png";

export interface OrgProfile {
  /** Short / brand name — sidebar, slips, document headers. Required. */
  name: string;
  /** Full legal name — letterhead strip + signature line. Falls back to `name`. */
  legalName: string;
  /** File Store id of the logo (uploaded via /upload/design-image). Required. */
  logo: string;
  gstin: string;
  pan: string;
  iec: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  bankBeneficiary: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  bankSwift: string;
}

/** Field → AppSetting key. The server allowlist (lib/orgProfile.js) mirrors this. */
export const ORG_KEYS: Record<keyof OrgProfile, string> = {
  name: "org_name",
  legalName: "org_legal_name",
  logo: "org_logo",
  gstin: "org_gstin",
  pan: "org_pan",
  iec: "org_iec",
  address: "org_address",
  phone: "org_phone",
  email: "org_email",
  website: "org_website",
  bankBeneficiary: "org_bank_beneficiary",
  bankName: "org_bank_name",
  bankAccount: "org_bank_account",
  bankIfsc: "org_bank_ifsc",
  bankSwift: "org_bank_swift",
};

export const EMPTY_ORG: OrgProfile = {
  name: "", legalName: "", logo: "", gstin: "", pan: "", iec: "",
  address: "", phone: "", email: "", website: "",
  bankBeneficiary: "", bankName: "", bankAccount: "", bankIfsc: "", bankSwift: "",
};

/** Demo build (VITE_DEMO=1, Slate): neutral branding, no BOFFO word, logo or wordmark loader (CR-454). */
export const IS_DEMO = !!import.meta.env.VITE_DEMO;

// ponytail: the fallback is yesterday's hard-coded branding, so live looks the
// same until an Admin saves a profile. Bank rows are the template placeholders.
// The demo build falls back to a neutral "Demo" profile instead (CR-454).
const DEFAULT_ORG: OrgProfile = IS_DEMO ? { ...EMPTY_ORG, name: "Demo", legalName: "Demo Company" } : {
  ...EMPTY_ORG,
  name: "BOFFO",
  legalName: "BOFFO GRANITO LLP",
  address: "8-A National Highway, Morbi, Gujarat, India",
  phone: "+91 99256 45674",
  email: "info@boffogranito.com",
  website: "boffogranito.com",
  bankBeneficiary: "Boffo Granito LLP",
  bankName: "HDFC Bank, Morbi Branch",
  bankAccount: "5020 0045 6789 01",
  bankIfsc: "HDFC0001234",
  bankSwift: "HDFCINBB",
};

let saved: OrgProfile = EMPTY_ORG;      // what the DB holds ("" = unset)
let merged: OrgProfile = DEFAULT_ORG;   // saved over defaults
const listeners = new Set<() => void>();

function apply(raw: Partial<Record<string, string>>) {
  const next = { ...EMPTY_ORG };
  for (const [field, key] of Object.entries(ORG_KEYS) as [keyof OrgProfile, string][]) next[field] = String(raw[key] ?? "").trim();
  saved = next;
  const m = { ...DEFAULT_ORG };
  for (const f of Object.keys(ORG_KEYS) as (keyof OrgProfile)[]) if (next[f]) m[f] = next[f];
  merged = m;
  document.title = `${merged.name} Order OS`;
  listeners.forEach((l) => l());
}

/** Fetch the saved profile (public route, no token). Safe to call again after a save. */
export async function loadOrg(): Promise<OrgProfile> {
  try {
    const res = await apiGet<{ ok: boolean; profile?: Record<string, string> }>("data-ops/public/org-profile");
    if (res.ok) apply(res.profile || {});
  } catch {
    /* offline / old server: keep the fallback */
  }
  return saved;
}

/** Saved values only ("" where unset) — the Settings form edits these. */
export const getOrgSaved = (): OrgProfile => saved;
/** Effective profile (saved over the fallback) — everything else reads this. */
export const getOrg = (): OrgProfile => merged;

export function useOrg(): OrgProfile {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    getOrg,
    getOrg,
  );
}

/** Logo URL for <img>/fetch; null when the demo build has no saved logo (CR-444 keeps the demo login logo-free). */
export function orgLogoUrl(): string | null {
  if (saved.logo) return designImageUrl(saved.logo);
  return IS_DEMO ? null : boffoLogo;
}

export const orgLegalName = (): string => merged.legalName || merged.name;
export const orgContactLine = (): string => [merged.phone, merged.email, merged.website].filter(Boolean).join(" · ");
export const orgTaxLine = (): string =>
  ([["GSTIN", merged.gstin], ["PAN", merged.pan], ["IEC", merged.iec]] as const)
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(" · ");
export const orgBankRows = (): [string, string][] =>
  ([
    ["Beneficiary", merged.bankBeneficiary], ["Bank", merged.bankName], ["A/C No.", merged.bankAccount],
    ["IFSC", merged.bankIfsc], ["SWIFT", merged.bankSwift],
  ] as [string, string][]).filter(([, v]) => v);
