/* ============================================================
   SharedBatch — public, read-only production-batch slip view.

   Rendered OUTSIDE AuthGate (main.tsx branches on the #/share/batch/
   hash) so anyone scanning the QR slip on a batch opens it without a
   sign-in. Reads the unauthenticated GET /public/batch/<token>
   endpoint (keyed by the record's share_token).
   ============================================================ */
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

interface BatchData {
  batchNumber: string;
  item: string;
  size: string;
  qtyBoxes: number;
  mfgDate: string;
  loggedBy: string;
  note: string;
}

/** #/share/batch/<token> → token, or "". */
function tokenFromHash(hash: string): string {
  const m = /^#\/share\/batch\/([A-Za-z0-9]+)/.exec(hash);
  return m ? m[1] : "";
}

export function SharedBatch() {
  const token = tokenFromHash(window.location.hash);
  const [batch, setBatch] = useState<BatchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing slip token.");
      return;
    }
    let alive = true;
    fetch(`${API_BASE}/data-ops/public/batch/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((res: { ok: boolean; batch?: BatchData; error?: string }) => {
        if (!alive) return;
        setLoading(false);
        if (res.ok && res.batch) setBatch(res.batch);
        else setError(res.error || "This slip could not be found.");
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        setError("Could not reach the server. Check your connection and try again.");
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const row = { display: "flex", justifyContent: "space-between", gap: 12 } as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #f4f4f8)", padding: "24px 14px" }}>
      <div className="card" style={{ maxWidth: 560, margin: "0 auto", padding: 22 }}>
        <div style={{ ...row, alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>BOFFO</div>
            <div className="muted" style={{ fontSize: 14 }}>Batch · Plant Morbi</div>
          </div>
          {batch && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Batch {batch.batchNumber || "—"}</div>
              <div className="mono muted" style={{ fontSize: 14 }}>{batch.qtyBoxes} boxes</div>
            </div>
          )}
        </div>

        {loading && <div className="muted">Loading slip…</div>}
        {error && <div style={{ color: "var(--c-red, #c0392b)" }}>{error}</div>}

        {batch && (
          <>
            <div style={{ display: "grid", gap: 6, fontSize: 15 }}>
              <div style={row}>
                <span className="muted">Item</span>
                <b style={{ textAlign: "right" }}>
                  {batch.item || "—"}
                  {batch.size && <span className="muted"> · {batch.size}</span>}
                </b>
              </div>
              <div style={row}>
                <span className="muted">Quantity</span>
                <b className="mono">{batch.qtyBoxes} boxes</b>
              </div>
              <div style={row}>
                <span className="muted">Mfg date</span>
                <b className="mono">{batch.mfgDate || "—"}</b>
              </div>
              {batch.loggedBy && (
                <div style={row}>
                  <span className="muted">Logged by</span>
                  <b>{batch.loggedBy}</b>
                </div>
              )}
              {batch.note && (
                <div style={row}>
                  <span className="muted">Remark</span>
                  <b style={{ textAlign: "right" }}>{batch.note}</b>
                </div>
              )}
            </div>

            <div className="muted" style={{ fontSize: 13, marginTop: 18 }}>
              Read-only batch slip shared by BOFFO.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
