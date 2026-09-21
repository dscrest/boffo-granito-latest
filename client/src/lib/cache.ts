/* ============================================================
   Generic stale-while-revalidate list cache.

   Generalises the pattern proven in quotesApi: one module-level
   snapshot per entity, painted instantly by consumers while a fresh
   fetch revalidates in the background. Adds in-flight dedupe (two
   components mounting together share one fetch) and a TTL so rapid
   navigation doesn't refetch identical data within the window.

   Results are cached only when `ok` — failures pass through to the
   caller without poisoning the last good snapshot. Mutating API
   wrappers call `invalidate()` so the next load() hits the network.
   ============================================================ */

type Listener = () => void;

export interface ListCache<R extends { ok: boolean }> {
  /** Last good snapshot, or null if never fetched this session. */
  cached(): R | null;
  /** True if a snapshot exists and is younger than the TTL. */
  isFresh(): boolean;
  /** Drop the snapshot so the next load() hits the network. */
  invalidate(): void;
  /** Replace the snapshot in place (no fetch) and notify subscribers.
      No-op if there is no snapshot yet. */
  patch(fn: (value: R) => R): void;
  /** Subscribe to snapshot changes. Returns an unsubscribe fn. */
  subscribe(cb: Listener): () => void;
  /** Fresh-aware load: returns the snapshot inside the TTL, dedupes
      concurrent calls, otherwise fetches and caches on success. */
  load(): Promise<R>;
  /** Always fetch (still dedupes concurrent calls). */
  loadFresh(): Promise<R>;
}

export function createListCache<R extends { ok: boolean }>(
  fetcher: () => Promise<R>,
  ttl = 30_000,
): ListCache<R> {
  let snapshot: { value: R; ts: number } | null = null;
  let inflight: Promise<R> | null = null;
  let gen = 0; // bumped by invalidate() — a fetch started before it must not repopulate the cache
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach((l) => l());

  function fetchAndCache(): Promise<R> {
    if (inflight) return inflight;
    const g = gen;
    const p: Promise<R> = fetcher()
      .then((r) => {
        if (r.ok && g === gen) {
          snapshot = { value: r, ts: Date.now() };
          notify();
        }
        return r;
      })
      .finally(() => {
        if (inflight === p) inflight = null;
      });
    inflight = p;
    return p;
  }

  return {
    cached: () => (snapshot ? snapshot.value : null),
    isFresh: () => !!snapshot && Date.now() - snapshot.ts < ttl,
    invalidate() {
      snapshot = null;
      inflight = null;
      gen++;
      notify();
    },
    patch(fn) {
      if (!snapshot) return;
      snapshot = { value: fn(snapshot.value), ts: snapshot.ts };
      notify();
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    load() {
      if (snapshot && Date.now() - snapshot.ts < ttl) return Promise.resolve(snapshot.value);
      return fetchAndCache();
    },
    loadFresh: fetchAndCache,
  };
}
