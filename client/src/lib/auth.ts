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
  | "panel_craft"
  | "stages"
  | "invoices"
  | "reports"
  | "settings";
export type PermAction = "view" | "create" | "edit" | "delete" | "export";
export type ApprovableDoc = "Quote" | "SalesOrder" | "Production";

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
      // credentials:include → the httpOnly session cookie rides the request.
      // X-App-Token stays as the back-compat/fallback path until the cookie
      // spike confirms the gateway forwards cookies (then it can be dropped).
      credentials: "include",
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

/* One POST helper for the sign-in legs (/auth/login, /auth/zoho/*). credentials:include
   receives the httpOnly session cookie; X-App-Token rides along when a session exists
   (the Books connect exchange must prove the caller is a signed-in Admin). */
async function postAuth<T>(path: string, body: unknown): Promise<T> {
  const token = storedAuth()?.token;
  const res = await fetch(`${API_BASE}/data-ops/${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { "X-App-Token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { ok: boolean; error?: string }) | null;
  if (!res.ok || !json?.ok) throw new Error(json?.error || "Sign-in failed");
  return json;
}

type Minted = { token?: string; user?: SessionUser };
/* The localStorage write happens BEFORE the caller flips to "authed" — App.tsx and
   lib/api.ts read boffo_auth directly on their first render. */
function storeMinted(json: Minted): SessionUser | undefined {
  if (json.token && json.user) localStorage.setItem(KEY, JSON.stringify({ token: json.token, user: json.user }));
  return json.user;
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const user = storeMinted(await postAuth<Minted>("auth/login", { email, password }));
  if (!user) throw new Error("Sign-in failed");
  return user;
}

/* ---- Sign in with Zoho (CR-324) ----
   start → Zoho consent → back on /app/?code=…&state=…&location=… → exchange.
   The same exchange also completes an Admin's "Connect Zoho Books / CRM" (CR-325/359):
   then nothing is minted and `zoho` names the provider + connected organisation. */
/* CR-443: bind the Zoho round trip to THIS browser without a cookie — a cross-origin host (Slate)
   never gets the server's state cookie back. Remember the state we leave with; AuthGate compares on
   return and the server independently verifies the state's signature + expiry. */
const OAUTH_STATE_KEY = "boffo_oauth_state";
export function rememberOauthState(consentUrl: string): void {
  try {
    const s = new URL(consentUrl).searchParams.get("state");
    if (s) sessionStorage.setItem(OAUTH_STATE_KEY, s);
  } catch {
    /* storage blocked — the server-side signature check still applies */
  }
}
/** The remembered state (cleared on read); "" when none / storage blocked. */
export function takeOauthState(): string {
  try {
    const s = sessionStorage.getItem(OAUTH_STATE_KEY) || "";
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    return s;
  } catch {
    return "";
  }
}

export async function startZohoSignIn(): Promise<void> {
  const json = await postAuth<{ url: string }>("auth/zoho/start", {});
  rememberOauthState(json.url);
  window.location.href = json.url;
}

export async function exchangeZohoCode(
  code: string,
  state: string,
  dc: string,
): Promise<{ user?: SessionUser; zoho?: { provider: string; orgName: string } }> {
  const json = await postAuth<Minted & { zoho?: { provider: string; orgName: string } }>("auth/zoho/exchange", { code, state, location: dc });
  return { user: storeMinted(json), zoho: json.zoho };
}

export function signOut(): void {
  const stored = storedAuth();
  if (stored) {
    void fetch(`${API_BASE}/data-ops/auth/logout`, {
      method: "POST",
      credentials: "include", // send the cookie so the server can clear it
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
