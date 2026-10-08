/* ============================================================
   BoffoLoader — the house "processing" indicator (CR-293): the BOFFO
   wordmark with its letters pulsing in sequence. Use it wherever the
   UI waits on a request (uploads, auth check). Styles: theme.css.
   ============================================================ */
export function BoffoLoader({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) {
  return (
    <div className={`boffo-loader ${size}`} role="status" aria-live="polite" aria-label={label || "Processing"}>
      <span className="boffo-loader-word" aria-hidden="true">
        {"BOFFO".split("").map((ch, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.12}s` }}>{ch}</span>
        ))}
      </span>
      {label && <span className="boffo-loader-label">{label}</span>}
    </div>
  );
}
