/* ============================================================
   Shared building blocks for the Zoho-style record detail pages
   (ItemDetail, SizeDetail). Extracted so every detail page shows
   the same label/value row, the same "More ▾" actions menu, and
   the same related-record list.
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

/** "More ▾" actions dropdown (Zoho-style) — reuses the .hdr-menu styles.
    `kebab` swaps the trigger for a compact icon-only ⋮ button (row menus);
    `icon` swaps that glyph (e.g. "plus"). Disabled items stay visible but dim. */
export function MoreMenu({ items, kebab, label, icon, title }: {
  items: { label: string; danger?: boolean; disabled?: boolean; title?: string; onClick: () => void }[];
  kebab?: boolean;
  label?: string;
  icon?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const width = kebab ? (icon ? 200 : 140) : 210;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* Portaled + fixed so no overflow:auto table wrapper can clip the menu;
     right-aligned to the trigger, flipped above it when the bottom is tight. */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return;
      const h = menuRef.current?.offsetHeight ?? 0;
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
      const top = r.bottom + 8 + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8;
      setPos({ left, top });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, width]);

  if (items.length === 0) return null;
  return (
    <div className="hdr-pop" ref={ref}>
      <button className={kebab ? "btn x" : "hbtn"} onClick={() => setOpen((v) => !v)} title={title ?? "More actions"}>
        {kebab ? <Icon name={icon ?? "more-v"} size={14} /> : <>{label ?? "More"} <Icon name="more" size={13} /></>}
      </button>
      {open && createPortal(
        <div
          className="hdr-menu"
          ref={menuRef}
          style={{
            position: "fixed",
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            width,
            padding: 6,
            zIndex: 1000,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              disabled={it.disabled}
              title={it.title}
              onClick={() => {
                if (it.disabled) return;
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
                cursor: it.disabled ? "default" : "pointer",
                color: it.disabled ? "var(--muted)" : it.danger ? "var(--c-red)" : "inherit",
                opacity: it.disabled ? 0.6 : 1,
                font: "inherit",
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--accent-soft)"; }}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>,
        document.body
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
