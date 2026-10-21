/* ============================================================
   Zoho customer source (CR-325/356/359) — thin wrappers over data-ops
   /zoho/:provider/*. ONE const below says which provider the UI shows;
   the server's twin is ACTIVE_PROVIDER in functions/data-ops/lib/zoho.js.
   Books (CR-325/356) is hidden since CR-359, not removed: flip both
   consts to { provider: "books", label: "Zoho Books", noun: "contact",
   linkField: "books_contact_id" } to bring it back.

   The server owns the record → Customer mapping: getRecord() returns
   `mapped`, which the customer form spreads as-is (the form is the
   review step). A 409 "reauth_required" = "Connect <label> in Settings".
   ============================================================ */
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type { ChipTone } from "@/ui/Chip";
import type { CustomerInput } from "./customersApi";

export const ZOHO = {
  provider: "crm",
  label: "Zoho CRM",
  noun: "account", // what a remote customer record is called there
  linkField: "crm_account_id", // Customer column holding the remote id
} as const;

/* CR-362: which Zoho systems hold this customer — both ids live on the Customer row
   (crm_account_id from the CRM sync, books_contact_id confirmed via Books' zcrm_account_id). */
export type ZohoLink = "both" | "crm" | "books" | "none";
export const zohoLinkOf = (x: { crm_account_id?: string; books_contact_id?: string }): ZohoLink =>
  x.crm_account_id ? (x.books_contact_id ? "both" : "crm") : x.books_contact_id ? "books" : "none";
export const ZOHO_LINK: Record<ZohoLink, { chip: string; text: string; tone: ChipTone }> = {
  both: { chip: "CRM & Books", text: "Synced in Zoho CRM & Zoho Books", tone: "green" },
  crm: { chip: "CRM only", text: "In Zoho CRM, not synced with Zoho Books", tone: "amber" },
  books: { chip: "Books only", text: "In Zoho Books, not in Zoho CRM", tone: "sky" },
  none: { chip: "", text: "Not linked to Zoho", tone: "gray" },
};

const base = `data-ops/zoho/${ZOHO.provider}`;

export interface ZohoStatus {
  provider: string;
  active: boolean;
  connected: boolean;
  orgName: string;
  orgId: string;
  /** False until ZOHO_CLIENT_ID/SECRET/REDIRECT_URI are set on the server. */
  configured: boolean;
  /** The stored consent allows creating/updating records (push). */
  canWrite: boolean;
  lastSync: SyncSummary | null;
}

/** One sync run (or one import page) as the server reports it. */
export interface SyncSummary {
  provider: string;
  mode: "refresh" | "import";
  page: number;
  done: boolean;
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  errors: string[];
  at: string; // IST "yyyy-MM-dd HH:mm:ss"
  note?: string;
}

/** One picker row (server-trimmed). */
export interface ZohoHit {
  id: string;
  name: string;
  detail: string; // company / website
  phone: string;
  place: string; // city (CRM) / GSTIN (Books)
}

export const zohoStatus = (): Promise<ZohoStatus> => apiGet<{ ok: boolean } & ZohoStatus>(`${base}/status`);

/** Admin: starts the consent; the browser leaves for Zoho and returns to /app/?code=… */
export async function connectZoho(): Promise<void> {
  const r = await apiPost<{ ok: boolean; url: string }>(`${base}/connect`, {});
  window.location.href = r.url;
}
export const disconnectZoho = (): Promise<unknown> => apiDelete(`${base}/connection`);

export const searchZoho = (q: string): Promise<ZohoHit[]> =>
  apiGet<{ ok: boolean; records: ZohoHit[] }>(`${base}/records?q=${encodeURIComponent(q)}`).then((r) => r.records);

/** The full remote record plus its Customer mapping (null when it no longer exists). */
export const getZohoRecord = (id: string): Promise<{ record: unknown; mapped: Partial<CustomerInput> } | null> =>
  apiGet<{ ok: boolean; record: unknown; mapped: Partial<CustomerInput> | null }>(`${base}/records/${encodeURIComponent(id)}`).then((r) =>
    r.record && r.mapped ? { record: r.record, mapped: r.mapped } : null,
  );

/** Admin: the incremental pull (same as the webhook / cron). */
export const syncZoho = (): Promise<SyncSummary> => apiPost<SyncSummary>(`${base}/sync`, {});
/** Admin: one page of the one-time import; call again with page+1 until `done`. */
export const importZohoPage = (page: number): Promise<SyncSummary> => apiPost<SyncSummary>(`${base}/import`, { page });
/** Create (unlinked) or update (linked) the customer's remote record. */
export const pushCustomerToZoho = (rowid: string): Promise<{ id: string; created: boolean }> =>
  apiPost<{ ok: boolean; id: string; created: boolean }>(`${base}/push/${encodeURIComponent(rowid)}`, {});

export const isReauth = (e: unknown): boolean => e instanceof Error && e.message === "reauth_required";
export const REAUTH_HINT = `${ZOHO.label} is not connected. An Admin can connect it under Settings → ${ZOHO.label}.`;
