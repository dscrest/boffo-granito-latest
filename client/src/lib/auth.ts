// App-level auth backed by the data-ops /auth/* endpoints (AppUser/Role/
// AuthSession tables). The session token + user/permissions snapshot live in
// localStorage (shared across tabs of the origin, so opening a link in a new
// tab stays signed in); lib/api.ts attaches the token to every request and
// clears the session on 401. Trade-off vs the old sessionStorage: the token now
// survives browser restart until sign-out / server-side expiry — the server
// token TTL + the 401-clear + explicit sign-out are what end a session.
// The old Catalyst-hosted-login / dev-stub split is gone.
import { API_BASE } from "./api";

export type PermModule =
  | "quotes"
  | "orders"
  | "customers"
  | "items"
  | "stages"
  | "invoices"
  | "reports"
  | "settings";
export type PermAction = "view" | "create" | "edit" | "delete" | "export";
export type ApprovableDoc = "Quote" | "SalesOrder";

export interface Perms {
  features: string[]; // nav ids the role may see; ["*"] = all (derived from matrix)
  can_update: boolean; // legacy rollup: any module has create|edit
  can_delete: boolean; // legacy rollup: any module has delete
  matrix?: Record<string, string[]>; // module -> allowed actions
  approve?: string[]; // doc types this role may approve ("Quote" | "SalesOrder")
}

export interface SessionUser {
  rowid: string;
  email: string;
  name: string;
  role: string | null;
  perms: Perms;
}

const KEY = "boffo_auth";

interface Stored {
  token: string;
  user: SessionUser;
}

export function storedAuth(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

export function authToken(): string {
  return storedAuth()?.token ?? "";
}

export function clearAuth(): void {
  localStorage.removeItem(KEY);
}

/** Validate the stored token server-side; null if absent/expired. */
export async function checkSession(): Promise<SessionUser | null> {
  const stored = storedAuth();
  if (!stored) return null;
  try {
    const res = await fetch(`${API_BASE}/data-ops/auth/me`, {
      // X-App-Token, not Authorization: the Catalyst gateway treats a Bearer
      // header as a Zoho OAuth token and rejects it before the function runs.
      headers: { Accept: "application/json", "X-App-Token": stored.token },
    });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const json = (await res.json()) as { ok: boolean; user: SessionUser };
    // Refresh the stored perms snapshot: role edits reach signed-in users on
    // their next reload (the server guard is authoritative in the meantime).
    localStorage.setItem(KEY, JSON.stringify({ token: stored.token, user: json.user }));
    return json.user;
  } catch {
    // Network hiccup: keep the stored session rather than logging the user out.
    return stored.user;
  }
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const res = await fetch(`${API_BASE}/data-ops/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; token?: string; user?: SessionUser; error?: string }
    | null;
  if (!res.ok || !json?.ok || !json.token || !json.user) {
    throw new Error(json?.error || "Sign-in failed");
  }
  localStorage.setItem(KEY, JSON.stringify({ token: json.token, user: json.user }));
  return json.user;
}

export function signOut(): void {
  const stored = storedAuth();
  if (stored) {
    void fetch(`${API_BASE}/data-ops/auth/logout`, {
      method: "POST",
      headers: { "X-App-Token": stored.token },
    }).catch(() => undefined);
  }
  clearAuth();
  window.location.reload();
}

/* ---- Permission helpers (synchronous; read the stored snapshot) ---- */

export function perms(): Perms {
  return storedAuth()?.user.perms ?? { features: [], can_update: false, can_delete: false };
}

export function hasFeature(id: string): boolean {
  const f = perms().features;
  return f.includes("*") || f.includes(id);
}

export function canUpdate(): boolean {
  return perms().can_update;
}

export function canDelete(): boolean {
  return perms().can_delete;
}

export function isAdmin(): boolean {
  return storedAuth()?.user.role === "Admin";
}

/** Per-module permission check against the role's matrix. Falls back to the
 * legacy global flags for sessions minted before the matrix existed. */
export function can(module: PermModule, action: PermAction): boolean {
  if (isAdmin()) return true;
  const p = perms();
  if (p.matrix) return (p.matrix[module] ?? []).includes(action);
  // Legacy snapshot: view/export were never gated; delete/update were global.
  if (action === "view" || action === "export") return true;
  return action === "delete" ? p.can_delete : p.can_update;
}

/** May the signed-in role approve/reject the given document type? */
export function canApprove(doc: ApprovableDoc): boolean {
  return isAdmin() || (perms().approve ?? []).includes(doc);
}
