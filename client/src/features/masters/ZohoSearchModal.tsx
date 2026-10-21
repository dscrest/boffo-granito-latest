/* ============================================================
   Zoho record search (CR-325/359) — same chrome as CustomerSearchModal.
   Type a name → the server searches the connected organisation → a row
   click fetches the full record + its Customer mapping and hands both to
   the caller, who opens PartyForm prefilled (always reviewed, never
   written automatically). Provider/labels come from ZOHO (zohoApi.ts).
   ============================================================ */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/Icon";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { useModalA11y } from "@/ui/useModalA11y";
import { isAdmin } from "@/lib/auth";
import { getZohoRecord, isReauth, REAUTH_HINT, searchZoho, ZOHO, type ZohoHit } from "./zohoApi";
import type { CustomerInput } from "./customersApi";

export interface ZohoPick {
  id: string;
  name: string;
  mapped: Partial<CustomerInput>;
}

export function ZohoSearchModal({
  initialQuery = "",
  onPick,
  onClose,
}: {
  initialQuery?: string;
  onPick: (p: ZohoPick) => void;
  onClose: () => void;
}) {
  const panelRef = useModalA11y(onClose);
  const navigate = useNavigate();
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<ZohoHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  // Search as the user types (debounced) — the server returns the first 25 matches.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setError(null);
      searchZoho(q.trim())
        .then((rows) => alive && setHits(rows))
        .catch((e: unknown) => {
          if (!alive) return;
          if (isReauth(e)) setNotConnected(true);
          else setError(e instanceof Error ? e.message : "Search failed");
          setHits([]);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const pick = async (h: ZohoHit) => {
    if (picking) return;
    setPicking(h.id);
    try {
      const r = await getZohoRecord(h.id);
      if (!r) throw new Error(`${ZOHO.noun[0].toUpperCase() + ZOHO.noun.slice(1)} not found in ${ZOHO.label}`);
      onPick({ id: h.id, name: h.name, mapped: r.mapped });
      onClose();
    } catch (e) {
      setError(isReauth(e) ? REAUTH_HINT : e instanceof Error ? e.message : `Could not load the ${ZOHO.noun}`);
      setPicking(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={`Search ${ZOHO.label}`} className="modal-panel card df-modal" onClick={(e) => e.stopPropagation()}>
        <div className="df-head">
          <div className="ico"><Icon name="search" size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="ttl">Search {ZOHO.label}</div>
          </div>
          <button className="btn x" onClick={onClose} title="Close" tabIndex={-1}>✕</button>
        </div>
        <div className="df-body">
          {notConnected ? (
            <div className="dim" style={{ padding: "18px 6px", lineHeight: 1.6 }}>
              {REAUTH_HINT}
              {isAdmin() && (
                <div style={{ marginTop: 10 }}>
                  <button className="hbtn primary" onClick={() => { onClose(); navigate("/settings/zoho"); }}>
                    Connect {ZOHO.label}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
              <div className="lp-search">
                <Icon name="search" size={13} />
                <input type="text" placeholder={`Search customers in ${ZOHO.label} by name…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${ZOHO.label}`} autoFocus />
              </div>
              <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
                {hits === null || picking ? (
                  <div style={{ padding: 18 }}><BoffoLoader size="sm" label={picking ? `Loading ${ZOHO.noun}…` : "Searching…"} /></div>
                ) : (
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Details</th>
                        <th>Phone</th>
                        <th>{ZOHO.provider === "crm" ? "City" : "GSTIN"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {error && <tr><td colSpan={4} className="form-error">{error}</td></tr>}
                      {!error && hits.length === 0 && <tr><td colSpan={4} className="dim">No {ZOHO.label} customers match.</td></tr>}
                      {hits.map((h) => (
                        <tr
                          key={h.id}
                          tabIndex={0}
                          style={{ cursor: "pointer" }}
                          onClick={() => void pick(h)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void pick(h);
                            }
                          }}
                        >
                          <td style={{ fontWeight: 600 }}>{h.name}</td>
                          <td>{h.detail}</td>
                          <td className="mono">{h.phone}</td>
                          <td>{h.place}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
