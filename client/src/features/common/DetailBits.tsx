/* ============================================================
   Shared building blocks for the Zoho-style record detail pages
   (ItemDetail, SizeDetail). Extracted so every detail page shows
   the same label/value row, the same "More ▾" actions menu, and
   the same related-record list.
   ============================================================ */
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/ui/Icon";
import { SkeletonRows } from "@/ui/States";
import type { PalletOrder, PalletRow } from "@/features/masters/palletsApi";

export function DetailRow({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted" style={{ width: 160, flexShrink: 0, fontSize: "var(--t-sm)" }}>{label}</span>
      <span className={dim ? "dim" : ""} style={{ minWidth: 0, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}

/** "More ▾" actions dropdown (Zoho-style) — reuses the .hdr-menu styles. */
export function MoreMenu({ items }: { items: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div className="hdr-pop" ref={ref}>
      <button className="hbtn" onClick={() => setOpen((v) => !v)} title="More actions">
        More <Icon name="more" size={13} />
      </button>
      {open && (
        <div className="hdr-menu" style={{ right: 0, width: 210, padding: 6 }}>
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                border: "none",
                background: "transparent",
                borderRadius: 6,
                cursor: "pointer",
                color: it.danger ? "var(--c-red)" : "inherit",
                font: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-soft)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* lib/format's fmt() rounds to whole numbers — coverage (1.44 m²) needs decimals. */
const nfmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format;

/** Join the parts a record actually carries; a zero box count says nothing worth printing. */
const facts = (parts: (string | false | 0)[]) => parts.filter(Boolean).join("  ·  ");

/**
 * Pallets pointing at the record being viewed (Pallet.size → Size). `pallets`
 * is null while the cache is cold. Navigation stays with the caller so this
 * file keeps no router dependency.
 */
export function AssociatedPallets({
  pallets,
  onOpen,
}: {
  pallets: PalletRow[] | null;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div className="form-section-title" style={{ marginBottom: 8 }}>
        Associated Pallets
        {pallets && pallets.length > 0 && <span className="dim"> ({pallets.length})</span>}
      </div>

      {pallets === null ? (
        <SkeletonRows rows={2} />
      ) : pallets.length === 0 ? (
        <div className="dim" style={{ padding: "6px 0" }}>No pallets linked to this size.</div>
      ) : (
        pallets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="rel-row"
            onClick={() => onOpen(p.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "9px 10px",
              border: "none",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              cursor: "pointer",
              font: "inherit",
            }}
            title={`Open pallet ${p.name}`}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-soft)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <span
                className="linkish"
                style={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {p.name || "—"}
              </span>
              <span className="dim" style={{ marginLeft: "auto", fontSize: "var(--t-sm)", flexShrink: 0 }}>
                {facts([p.palletType, p.palletSizeLabel]) || "No type set"}
              </span>
            </div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
              {facts([
                p.boxesPerPallet > 0 && `${p.boxesPerPallet} box/pallet`,
                p.palletsPerContainer > 0 && `${p.palletsPerContainer} pallet/container`,
              ]) || "No arrangement set"}
            </div>
            <div className="dim" style={{ fontSize: "var(--t-sm)", marginTop: 2 }}>
              {facts([
                p.totalBoxesPerContainer > 0 && `${nfmt(p.totalBoxesPerContainer)} boxes/container`,
                p.totalSqmPerContainer > 0 && `${nfmt(p.totalSqmPerContainer)} m²`,
                p.totalBoxWeightPerContainer > 0 && `${nfmt(p.totalBoxWeightPerContainer)} kg`,
              ])}
            </div>
          </button>
        ))
      )}
    </>
  );
}

/**
 * Orders packed on the pallet being viewed (PalletisedBatch.pallet → Pallet),
 * one row per order with its box total. `orders` is null while the cache is
 * cold. `onOpen` receives a SalesOrder ROWID — /orders/:id resolves either that
 * or an OrderItem id. Navigation stays with the caller, as above.
 */
export function AssociatedOrders({
  orders,
  onOpen,
}: {
  orders: PalletOrder[] | null;
  onOpen: (salesOrderId: string) => void;
}) {
  const totalBoxes = orders?.reduce((sum, o) => sum + o.boxes, 0) ?? 0;

  return (
    <>
      <div className="form-section-title" style={{ marginBottom: 8 }}>
        Associated Orders
        {orders && orders.length > 0 && <span className="dim"> ({orders.length})</span>}
      </div>

      {orders === null ? (
        <SkeletonRows rows={2} />
      ) : orders.length === 0 ? (
        <div className="dim" style={{ padding: "6px 0" }}>No orders packed on this pallet.</div>
      ) : (
        <>
          <div
            className="muted"
            style={{
              display: "flex",
              gap: 12,
              padding: "6px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: "var(--t-sm)",
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>Order</span>
            <span style={{ flexShrink: 0 }}>Boxes</span>
          </div>
          {orders.map((o) => (
            <div
              key={o.salesOrderId}
              style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)" }}
            >
              <button
                type="button"
                className="linkish"
                onClick={() => onOpen(o.salesOrderId)}
                title={`Open order ${o.orderNo}`}
                style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
              >
                {o.orderNo}
              </button>
              <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{nfmt(o.boxes)}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 12, padding: "6px 0", fontWeight: 500 }}>
            <span style={{ flex: 1, minWidth: 0 }}>Total</span>
            <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{nfmt(totalBoxes)}</span>
          </div>
        </>
      )}
    </>
  );
}
