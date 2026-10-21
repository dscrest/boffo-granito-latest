/* ============================================================
   Settings → Zoho (CR-325/356/358/359). One org-wide connection to the
   active customer source (ZOHO in zohoApi.ts — Zoho CRM Accounts since
   CR-359; Books hidden, its connection kept). Customers sync in: changes
   arrive via the webhook / URL cron hitting the server's incremental pull
   ("Refresh now" runs the same pull), a one-time "Import all" pages through
   every record, and a per-customer Push from the customer page (needs the
   write scope — an older consent shows Reconnect).
   ============================================================ */
import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/Toast";
import { BoffoLoader } from "@/ui/BoffoLoader";
import { BackToSettings } from "@/ui/primitives";
import { confirmDialog } from "@/ui/ConfirmDialog";
import { Note } from "@/ui/States";
import {
  connectZoho,
  disconnectZoho,
  importZohoPage,
  isReauth,
  REAUTH_HINT,
  syncZoho,
  ZOHO,
  zohoStatus,
  type SyncSummary,
  type ZohoStatus,
} from "@/features/masters/zohoApi";
import { invalidateCustomers } from "@/features/masters/customersApi";

const errMsg = (e: unknown, fallback: string) => (isReauth(e) ? REAUTH_HINT : e instanceof Error ? e.message : fallback);
const EMPTY: ZohoStatus = { provider: ZOHO.provider, active: true, connected: false, orgName: "", orgId: "", configured: false, canWrite: false, lastSync: null };

export function ZohoSyncSettings() {
  const [status, setStatus] = useState<ZohoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null); // import page counter
  const load = () => zohoStatus().then(setStatus).catch(() => setStatus(EMPTY));
  useEffect(() => {
    void load();
  }, []);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connectZoho(); // navigates away
    } catch (e) {
      toast.error(errMsg(e, "Could not start the Zoho connection"));
      setBusy(false);
    }
  };
  const onDisconnect = async () => {
    const ok = await confirmDialog({
      title: `Disconnect ${ZOHO.label}?`,
      message: "Customer sync and mapping stop until an Admin connects again. Existing customers keep their details.",
      confirmLabel: "Yes, disconnect",
      cancelLabel: "No, keep it",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await disconnectZoho();
      toast.success(`${ZOHO.label} disconnected`);
      await load();
    } catch (e) {
      toast.error(errMsg(e, "Disconnect failed"));
    } finally {
      setBusy(false);
    }
  };

  const onRefresh = async () => {
    setBusy(true);
    try {
      const r = await syncZoho();
      invalidateCustomers();
      if (r.note) toast.info(r.note);
      else toast.success(`Refreshed — ${r.created} new, ${r.updated} updated, ${r.linked} linked`);
      await load();
    } catch (e) {
      toast.error(errMsg(e, "Refresh failed"));
    } finally {
      setBusy(false);
    }
  };

  /* One page per request (the server caps a page so a call stays inside its timeout). */
  const onImport = async () => {
    const ok = await confirmDialog({
      title: `Import all ${ZOHO.label} customers?`,
      message: `Every customer ${ZOHO.noun} in ${ZOHO.label} is pulled in: existing customers with the same name are linked, the rest are created. One ${ZOHO.label} call per ${ZOHO.noun}${ZOHO.provider === "crm" ? " plus one for its contacts and one Zoho Books check (the CRM & Books status)" : ""}. Safe to run again — ${ZOHO.noun}s already imported and unchanged are skipped, only their Zoho Books link is re-checked.`,
      confirmLabel: "Yes, import",
      cancelLabel: "No",
    });
    if (!ok) return;
    setBusy(true);
    const total = { created: 0, updated: 0, linked: 0, skipped: 0, errors: [] as string[] };
    let page = 1;
    try {
      for (; ; page++) {
        setProgress(`Importing page ${page}…`);
        const r = await importZohoPage(page);
        total.created += r.created;
        total.updated += r.updated;
        total.linked += r.linked;
        total.skipped += Math.max(0, r.skipped);
        total.errors.push(...r.errors);
        if (r.done) break;
      }
      invalidateCustomers();
      toast.success(`Imported — ${total.created} new, ${total.updated} updated, ${total.linked} linked${total.skipped ? `, ${total.skipped} already up to date` : ""}${total.errors.length ? `, ${total.errors.length} errors` : ""}`);
      await load();
    } catch (e) {
      // CR-362: a page can still time out — what landed is kept, a re-run skips it.
      invalidateCustomers();
      toast.error(`${errMsg(e, "Import failed")} — stopped at page ${page} after ${total.created + total.updated + total.linked} ${ZOHO.noun}s. Run Import all again; imported ${ZOHO.noun}s are skipped.`);
      await load();
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const last: SyncSummary | null = status?.lastSync ?? null;

  return (
    <div>
      <div className="page-head">
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <BackToSettings />
          <div>
            <div className="title">{ZOHO.label}</div>
            <div className="sub">Customers sync from this organisation as they change in {ZOHO.label}; new add-on customers are pushed by hand</div>
          </div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card">
          <div className="card-head">
            <Icon name="refresh" size={13} className="ic" />
            <div className="title">Connection</div>
          </div>
          <div className="card-body" style={{ padding: 16 }}>
            {!status || busy ? (
              <BoffoLoader size="sm" label={progress ?? (busy ? "Working…" : "Loading…")} />
            ) : status.connected ? (
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Connected to {status.orgName || ZOHO.label}</div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    {status.canWrite
                      ? `Reads and writes customers. Open a customer → More → Push / Map to ${ZOHO.label}.`
                      : `Read-only connection — reconnect once to allow creating customers in ${ZOHO.label}.`}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  {!status.canWrite && (
                    <button className="hbtn primary" onClick={() => void onConnect()}>
                      Reconnect
                    </button>
                  )}
                  <button className="hbtn" onClick={() => void onDisconnect()}>
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Not connected</div>
                  <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                    {status.configured
                      ? `Sign in with the Zoho account that can see your ${ZOHO.label} organisation.`
                      : "Zoho sign-in is not set up on the server yet."}
                  </div>
                </div>
                <button className="hbtn primary" style={{ marginLeft: "auto" }} onClick={() => void onConnect()} disabled={!status.configured}>
                  Connect {ZOHO.label}
                </button>
              </div>
            )}
          </div>
        </div>

        {status?.connected && !busy && (
          <div className="card">
            <div className="card-head">
              <Icon name="refresh" size={13} className="ic" />
              <div className="title">Customer sync</div>
            </div>
            <div className="card-body" style={{ padding: 16 }}>
              <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  {last ? (
                    <>
                      <div style={{ fontWeight: 600 }}>
                        Last {last.mode === "import" ? "import" : "refresh"}: {last.at}
                      </div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>
                        {last.note ?? `${last.created} new · ${last.updated} updated · ${last.linked} linked${last.errors.length ? ` · ${last.errors.length} errors` : ""}`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontWeight: 600 }}>Never synced</div>
                      <div className="dim" style={{ fontSize: "var(--t-sm)" }}>Run Import all customers once to start.</div>
                    </>
                  )}
                </div>
                <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
                  <button className="hbtn" onClick={() => void onRefresh()}>
                    Refresh now
                  </button>
                  <button className="hbtn primary" onClick={() => void onImport()}>
                    Import all customers
                  </button>
                </div>
              </div>
              {last && last.errors.length > 0 && (
                <Note tone="warn" style={{ marginTop: 12 }}>
                  <div>Skipped on the last run (they retry next time):</div>
                  <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
                    {last.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </Note>
              )}
              <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 12 }}>
                Changes in {ZOHO.label} reach the add-on through the webhook / scheduled pull, which picks up only customers changed
                since the last run; {ZOHO.label} values overwrite the customer here. Import all pages through every customer once and
                is the only full pull.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
