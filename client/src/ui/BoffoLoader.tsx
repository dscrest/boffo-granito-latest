/* ============================================================
   BoffoLoader — the house "processing" indicator (CR-293): the org
   name (Settings ▸ Organization, CR-445) as a wordmark with its letters
   pulsing in sequence. Use it wherever the UI waits on a request
   (uploads, auth check). Styles: theme.css.
   CR-454: the demo build shows no wordmark — just the label (default
   "Processing…") pulsing.
   ============================================================ */
import { IS_DEMO, useOrg } from "@/lib/org";

export function BoffoLoader({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) {
  const org = useOrg();
  return (
    <div className={`boffo-loader ${size}`} role="status" aria-live="polite" aria-label={label || "Processing"}>
      {IS_DEMO ? (
        <span className="boffo-loader-label pulse">{label || "Processing…"}</span>
      ) : (
        <>
          <span className="boffo-loader-word" aria-hidden="true">
            {org.name.toUpperCase().split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s` }}>{ch}</span>
            ))}
          </span>
          {label && <span className="boffo-loader-label">{label}</span>}
        </>
      )}
    </div>
  );
}
