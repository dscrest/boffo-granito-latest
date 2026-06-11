/* ============================================================
   Shared feedback-state primitives: empty lists, load errors with
   retry, and skeleton placeholders shown while a list hydrates.
   Used by every data-backed table/list page for a consistent feel.
   ============================================================ */
import type { ReactNode } from "react";
import { Icon } from "@/ui/Icon";

/** Friendly empty-list placeholder. `action` is an optional CTA button. */
export function EmptyState({
  icon = "search",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="es-ico">
        <Icon name={icon} size={22} />
      </div>
      <div className="es-title">{title}</div>
      {hint && <div className="es-hint">{hint}</div>}
      {action && <div className="es-action">{action}</div>}
    </div>
  );
}

/** Load-failure card with a Retry button (keeps the ops-log link pattern). */
export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card error-card">
      <div className="ec-msg">
        <Icon name="bell" size={14} />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Shimmering placeholder rows while a table/list loads. */
export function SkeletonRows({ rows = 6, height = 34 }: { rows?: number; height?: number }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height }} />
      ))}
    </div>
  );
}
