/* ============================================================
   SharedPallet — public, read-only pallet/container label view.

   Rendered OUTSIDE AuthGate (main.tsx branches on the #/share/box/
   hash) so anyone scanning the QR on a container opens it without a
   sign-in. Reads the unauthenticated GET /public/pallet/<token>
   endpoint (keyed by the box's share_token) and lays out the
   shipment essentials in order: items, destinations, container,
   vehicle, and the salesperson to call back.
   ============================================================ */
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

interface Item {
  item: string;
  size: string;
  boxes: number;
  order: string;
  customer: string;
  country: string;
  salesperson: string;
  salespersonPhone: string;
  salespersonEmail: string;
}
interface BoxData {
  boxNumber: number;
  container: string;
  status: string;
  dispatchDate: string;
  vehicle: { number: string; driver: string; mobile: string } | null;
  totalBoxes: number;
  items: Item[];
  destinations: string[];
  salespersons: { name: string; phone: string; email: string }[];
}

/** #/share/box/<token> → token, or "". */
function tokenFromHash(hash: string): string {
  const m = /^#\/share\/box\/([A-Za-z0-9]+)/.exec(hash);
  return m ? m[1] : "";
}

export function SharedPallet() {
  const token = tokenFromHash(window.location.hash);
  const [box, setBox] = useState<BoxData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("Missing label token.");
      return;
    }
    let alive = true;
    fetch(`${API_BASE}/data-ops/public/pallet/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((res: { ok: boolean; box?: BoxData; error?: string }) => {
        if (!alive) return;
        setLoading(false);
        if (res.ok && res.box) setBox(res.box);
        else setError(res.error || "This label could not be found.");
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
            <div style={{ fontSize: 20, fontWeight: 700 }}>BOFFO</div>
            <div className="muted" style={{ fontSize: 12 }}>Pallet · Plant Morbi</div>
          </div>
          {box && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Box {box.boxNumber}</div>
              <div className="mono muted" style={{ fontSize: 12 }}>{box.totalBoxes} boxes</div>
            </div>
          )}
        </div>

        {loading && <div className="muted">Loading label…</div>}
        {error && <div style={{ color: "var(--c-red, #c0392b)" }}>{error}</div>}

        {box && (
          <>
            {/* Container / vehicle / status */}
            <div style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 16 }}>
              <div style={row}>
                <span className="muted">Container</span>
                <b className="mono">{box.container || "—"}</b>
              </div>
              <div style={row}>
                <span className="muted">Status</span>
                <b>{box.status || "—"}</b>
              </div>
              {box.dispatchDate && (
                <div style={row}>
                  <span className="muted">Dispatch date</span>
                  <b className="mono">{box.dispatchDate}</b>
                </div>
              )}
              <div style={row}>
                <span className="muted">Vehicle</span>
                <b className="mono" style={{ textAlign: "right" }}>
                  {box.vehicle
                    ? [box.vehicle.number, box.vehicle.driver, box.vehicle.mobile].filter(Boolean).join(" · ") || "—"
                    : "—"}
                </b>
              </div>
            </div>

            {/* Items */}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted, #667)", marginBottom: 6 }}>ITEMS</div>
            <table className="tbl" style={{ width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Boxes</th>
                  <th>Destination</th>
                </tr>
              </thead>
              <tbody>
                {box.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.item}
                      {it.size && <span className="dim" style={{ fontSize: 12 }}> · {it.size}</span>}
                      {it.order && <div className="dim" style={{ fontSize: 11 }}>{it.order}</div>}
                    </td>
                    <td className="num mono">{it.boxes}</td>
                    <td>
                      {it.customer || "—"}
                      {it.country && <span className="muted"> ({it.country})</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Salesperson call-back */}
            {box.salespersons.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted, #667)", marginBottom: 6 }}>
                  CONTACT
                </div>
                {box.salespersons.map((s, i) => (
                  <div key={i} style={{ ...row, alignItems: "center", fontSize: 13, marginBottom: 6 }}>
                    <span>{s.name}</span>
                    <span style={{ display: "flex", gap: 10 }}>
                      {s.phone && (
                        <a className="hbtn" href={`tel:${s.phone.replace(/\s+/g, "")}`} style={{ textDecoration: "none" }}>
                          Call {s.phone}
                        </a>
                      )}
                      {s.email && (
                        <a href={`mailto:${s.email}`} className="muted mono" style={{ fontSize: 12 }}>
                          {s.email}
                        </a>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="muted" style={{ fontSize: 11, marginTop: 18 }}>
              Read-only pallet label shared by BOFFO.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
