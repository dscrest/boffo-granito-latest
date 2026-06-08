// API base resolution:
//  - Prod (deployed): client + functions share the Catalyst domain → same-origin "/server".
//  - Dev (vite): the dev server proxies "/server" to the Catalyst Development domain
//    (see vite.config.ts), so "/server" works there too.
// VITE_API_BASE can override for special setups.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "/server";

function buildUrl(path: string): string {
  return `${API_BASE}/${path.replace(/^\/+/, "")}`;
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
    const msg =
      (json && typeof json === "object" && "error" in json && (json as { error?: string }).error) ||
      `${res.status} ${res.statusText}`;
    throw new Error(String(msg));
  }
  return json as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(buildUrl(path), { headers: { Accept: "application/json" } });
  return parse<T>(res);
}

async function apiSend<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return parse<T>(res);
}

export const apiPost = <T = unknown>(path: string, body?: unknown) => apiSend<T>("POST", path, body);
export const apiPatch = <T = unknown>(path: string, body?: unknown) => apiSend<T>("PATCH", path, body);
export const apiDelete = <T = unknown>(path: string) => apiSend<T>("DELETE", path);
