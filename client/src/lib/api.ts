// API base resolution:
//  - Prod (deployed): client + functions share the Catalyst domain → same-origin "/server".
//  - Dev (vite): the dev server proxies "/server" to the Catalyst Development domain
//    (see vite.config.ts), so "/server" works there too.
// VITE_API_BASE can override for special setups.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "/server";

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const url = `${API_BASE}/${path.replace(/^\/+/, "")}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}
