// API base resolution:
//  - Prod (deployed): client + functions share the Catalyst domain → same-origin "/server".
//  - Dev (vite): the dev server proxies "/server" to the Catalyst Development domain
//    (see vite.config.ts), so "/server" works there too.
// VITE_API_BASE can override for special setups.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "/server";

function buildUrl(path: string): string {
  return `${API_BASE}/${path.replace(/^\/+/, "")}`;
}

/* Session token lives in localStorage under "boffo_auth" (see lib/auth.ts) —
   localStorage so a link opened in a new tab stays signed in.
   Read it directly here to avoid an api<->auth circular import.
   Sent as X-App-Token: the Catalyst gateway hijacks `Authorization: Bearer`
   (validates it as a Zoho OAuth token and 401s before our function runs). */
function authHeader(): Record<string, string> {
  try {
    const raw = localStorage.getItem("boffo_auth");
    const token = raw ? (JSON.parse(raw) as { token?: string }).token : "";
    return token ? { "X-App-Token": token } : {};
  } catch {
    return {};
  }
}

function onUnauthorized(): void {
  // Stale/expired session: drop it and bounce to the login gate.
  localStorage.removeItem("boffo_auth");
  window.location.reload();
}

/** Parse a JSON response; throw a useful Error (with server message) on failure. */
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const msg =
      (json && typeof json === "object" && "error" in json && (json as { error?: string }).error) ||
      `${res.status} ${res.statusText}`;
    throw new Error(String(msg));
  }
  return json as T;
}

/* In-flight GET dedupe: concurrent requests for the same URL share one
   fetch (e.g. ordersApi + quotesApi both listing Customer on mount, or
   rapid sidebar navigation re-firing a list that's already loading). */
const inflightGets = new Map<string, Promise<unknown>>();

export function apiGet<T = unknown>(path: string): Promise<T> {
  const url = buildUrl(path);
  const existing = inflightGets.get(url);
  if (existing) return existing as Promise<T>;
  const p = fetch(url, { credentials: "include", headers: { Accept: "application/json", ...authHeader() } })
    .then((res) => parse<T>(res))
    .finally(() => inflightGets.delete(url));
  inflightGets.set(url, p);
  return p;
}

async function apiSend<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method,
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeader() },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

export const apiPost = <T = unknown>(path: string, body?: unknown) => apiSend<T>("POST", path, body);
export const apiPatch = <T = unknown>(path: string, body?: unknown) => apiSend<T>("PATCH", path, body);
export const apiDelete = <T = unknown>(path: string) => apiSend<T>("DELETE", path);

/* ---- Design images (#12): File Store upload + public serving URL ---- */

/** Public URL for a Design image stored in File Store (no auth needed). */
export const designImageUrl = (id: string): string =>
  `${API_BASE}/data-ops/public/design-image/${encodeURIComponent(id)}`;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s); // strip data-URL prefix
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Upload one image to File Store; returns its file id + stored filename. */
export async function uploadDesignImage(file: File): Promise<{ id: string; name: string }> {
  const data = await fileToBase64(file);
  const res = await apiPost<{ ok: boolean; id: string; name: string }>("data-ops/upload/design-image", {
    name: file.name,
    data,
  });
  return { id: res.id, name: res.name || file.name };
}
