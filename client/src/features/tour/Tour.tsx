/* ============================================================
   Onboarding tours — welcome modal on first login + Next/Back/Skip
   coach marks. The "main" tour navigates the business flow spotlighting
   sidebar items; page tours (AUTO_TOURS) auto-start on a user's first
   visit to that page and explain its process (anchored steps spotlight
   a control, anchor-less steps render a centered explainer card).

   Mirrors ConfirmDialog's module-level pub/sub: startTour(id) callable
   from anywhere (UserMenu "Take a tour" / "Page guide"), one <TourHost/>
   in App. Seen-flags live in localStorage per user per tour; bump a key
   version to re-trigger after a rework.

   Adding a contextual tour = a new TOURS entry (+ AUTO_TOURS row for
   first-visit auto-start) — no engine changes.
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useModalA11y } from "@/ui/useModalA11y";
import { storedAuth } from "@/lib/auth";

export interface TourStep {
  /** Matches a data-tour="…" attribute in the DOM. Omit → centered card, no
      spotlight. Missing at runtime (role-filtered) → step auto-skips. */
  anchor?: string;
  title: string;
  body: string;
  /** Sidebar group label to force-open before measuring ("Inventory" | "Sales" | "Reports"). */
  group?: string;
  /** Navigate here when the step shows, so the real page renders behind the card. */
  route?: string;
  /** Keep retrying the anchor lookup this long — for controls that mount only
      after the lazy page chunk + data load (default 0 = one attempt). */
  waitMs?: number;
}

/** Page tours that auto-start on a user's first visit to the route. */
export const AUTO_TOURS: Record<string, string> = {
  "/packing": "packing",
  "/loading": "loading",
};

export const TOURS: Record<string, TourStep[]> = {
  main: [
    {
      anchor: "nav-dashboard",
      route: "/dashboard",
      title: "Dashboard",
      body: "Your home page. Today's numbers at a glance — open orders, production, and dispatches — so you always know what needs attention first.",
    },
    {
      anchor: "nav-design",
      group: "Inventory",
      route: "/design",
      title: "Items",
      body: "Every tile design you sell starts here, with its sizes, packing details and rates. Keep this master accurate — quotes, production and pallets all read from it.",
    },
    {
      anchor: "nav-parties",
      group: "Sales",
      route: "/parties",
      title: "Customers",
      body: "Create the customer first. Quotes and orders inherit their address, currency and terms automatically, so you never retype them.",
    },
    {
      anchor: "nav-quotes",
      group: "Sales",
      route: "/quotes",
      title: "Quotes",
      body: "Price an enquiry here. Once a quote is Accepted, one click converts it into a Sales Order — this is where every deal begins.",
    },
    {
      anchor: "nav-byorder",
      group: "Sales",
      route: "/orders",
      title: "Sales Orders",
      body: "The confirmed order. It owns the container plan and drives everything downstream — production, palletization and loading all trace back here.",
    },
    {
      anchor: "nav-prod",
      group: "Inventory",
      route: "/prod",
      title: "Production",
      body: "Record what the factory produced, batch-wise. Finished quantities queue up for palletization on their own — no manual step needed.",
    },
    {
      anchor: "nav-packing",
      group: "Sales",
      route: "/packing",
      title: "Palletization",
      body: "Pack produced stock onto pallets, batch by batch. Completed pallets become ready for loading.",
    },
    {
      anchor: "nav-loading",
      group: "Sales",
      route: "/loading",
      title: "Loading and Dispatch",
      body: "Plan containers, load pallets, then assign the vehicle and seals to dispatch. The last stop of the flow — goods leave the factory from here.",
    },
    {
      anchor: "nav-reports",
      group: "Reports",
      route: "/reports",
      title: "Reports",
      body: "Stock, batch and dispatch reports for the full picture across everything you just saw.",
    },
    {
      anchor: "search",
      title: "Global search",
      body: "Jump to any record — a customer, quote, order or item — from anywhere. Press ⌘K to open it.",
    },
    {
      anchor: "settings",
      title: "Settings",
      body: "Masters and app configuration — sizes, containers, users, roles and more. Admin only.",
    },
    {
      anchor: "usermenu",
      title: "That's the flow!",
      body: "Customer → Quote → Sales Order → Production → Palletization → Loading. Replay this tour anytime from this menu.",
    },
  ],

  packing: [
    {
      route: "/packing",
      title: "Palletization",
      body: "Stage four of the flow: Customer → Quote → Sales Order → Production → Palletization → Loading. Order items appear here on their own as production is recorded — or create a plan yourself with New Palletization Plan.",
    },
    {
      anchor: "pal-view-toggle",
      route: "/packing",
      waitMs: 5000,
      title: "Views and stages",
      body: "Kanban shows the three stages — Ready for Palletization, In Palletization, Ready for Loading. Sheet is the same data as an editable grid. Use Group to band rows by Customer, Order, Batch or Item.",
    },
    {
      route: "/packing",
      title: "Where the quantities come from",
      body: "Recording production feeds this board. On the Production page, use Record New Production (or the + on a production row) to enter output batch-wise — the recorded boxes queue up here automatically.",
    },
    {
      anchor: "pal-selbar",
      route: "/packing",
      waitMs: 5000,
      title: "Palletising",
      body: "Each line's + menu holds the actions: Start Palletisation, Top Up Batch (mix a same-design batch in) and Complete Palletisation — or tick several rows and use this bar to palletise them together. Partial is fine: a Partial chip marks order items not yet fully palletised.",
    },
    {
      anchor: "pal-report",
      route: "/packing",
      waitMs: 5000,
      title: "Prints",
      body: "All prints are on demand. Today's Report prints everything palletised today; select pallets below and Packing Report and Pallet Slips buttons appear in the selection bar.",
    },
    {
      route: "/packing",
      title: "On to loading",
      body: "When a line reaches Ready for Loading, its Load button puts it into a container. A batch can only be loaded once it is fully palletised — a partly palletised batch stays back in In Palletization.",
    },
  ],

  loading: [
    {
      route: "/loading",
      title: "Loading and Dispatch",
      body: "The last stage: pallets go into containers, the vehicle is assigned, goods dispatch. Only loaded (boxed) lines live here — loading starts from Palletization's Load button, or from New Loading on this page.",
    },
    {
      anchor: "load-view-toggle",
      route: "/loading",
      waitMs: 5000,
      title: "Four views",
      body: "Workspace plans one sales order end-to-end; Sheet lists every loaded line; Loadings lists the containers; Customer Sheet groups by customer with edit-in-place.",
    },
    {
      anchor: "load-new",
      route: "/loading",
      waitMs: 5000,
      title: "New Loading",
      body: "Pick a sales order — its container plan prefills the remaining quantities against Ready-for-Loading stock. One submit creates one container; vehicle and seal details come later.",
    },
    {
      route: "/loading",
      title: "Partial loading",
      body: "You never have to load everything at once. In Workspace → Items, tick items, choose a container and Assign to Loading — then edit each Load quantity; what's left stays in Ready for Loading for the next container. Loading from Palletization can likewise take part of a pallet (\"N of M — rest stays in Ready\").",
    },
    {
      route: "/loading",
      title: "Assign vehicle, then dispatch",
      body: "Every action sits in a row's + menu. First Assign Vehicle — container number, seals, transporter, LR — then Dispatch. Status moves IL → RFD → DSP (In Loading → Ready for Dispatch → Dispatched).",
    },
    {
      route: "/loading",
      title: "Prints",
      body: "The + menu also prints: Print QR label (a public scan page for the container) and Dispatch Copy. After you dispatch, the printable Dispatch Entry opens on its own.",
    },
  ],
};

const listeners = new Set<(id: string) => void>();
/** Start (or replay) a tour from anywhere — no-op if TourHost isn't mounted. */
export function startTour(id = "main") {
  listeners.forEach((l) => l(id));
}

function seenKey(id: string) {
  const rid = storedAuth()?.user.rowid ?? "anon";
  return id === "main" ? `tour.seen.v1.${rid}` : `tour.seen.${id}.v1.${rid}`;
}

function WelcomeModal({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const panelRef = useModalA11y(onSkip);
  return (
    <div className="modal-backdrop" style={{ zIndex: 1100, alignItems: "center" }}>
      <div ref={panelRef} className="modal-panel card" role="dialog" aria-modal="true" aria-label="Welcome" style={{ maxWidth: 440 }}>
        <div className="confirm-head">
          <span className="confirm-ttl">Welcome to Boffo Order OS</span>
        </div>
        <div className="confirm-msg">
          This app takes an order from quote to dispatched container. Take a two-minute tour to see
          what each menu does and where your work flows next.
        </div>
        <div className="confirm-foot">
          <button className="btn" onClick={onSkip}>
            Skip
          </button>
          <button className="hbtn primary" onClick={onStart}>
            Start tour
          </button>
        </div>
      </div>
    </div>
  );
}

const CARD_W = 300;
const PAD = 4;
const RETRY_MS = 200;

export function TourHost({
  userReady,
  expandSidebar,
  openGroup,
}: {
  userReady: boolean;
  expandSidebar: () => void;
  openGroup: (label: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "welcome" | "steps">("idle");
  const [tourId, setTourId] = useState("main");
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dirRef = useRef<1 | -1>(1);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const steps = TOURS[tourId] ?? [];
  const step = phase === "steps" ? steps[stepIndex] : undefined;

  const begin = (id: string) => {
    dirRef.current = 1;
    setTourId(id);
    setStepIndex(0);
    setRect(null);
    setPhase("steps");
  };
  const end = () => {
    localStorage.setItem(seenKey(tourId), "1");
    setPhase("idle");
    setRect(null);
    setPos(null);
  };
  const next = () => {
    dirRef.current = 1;
    if (stepIndex >= steps.length - 1) end();
    else setStepIndex(stepIndex + 1);
  };
  const back = () => {
    dirRef.current = -1;
    if (stepIndex > 0) setStepIndex(stepIndex - 1);
  };

  // First login (per user per browser): offer the main tour once.
  useEffect(() => {
    if (userReady && !localStorage.getItem(seenKey("main"))) setPhase("welcome");
  }, [userReady]);

  // Page tours: auto-start on the first visit to a mapped route.
  useEffect(() => {
    if (!userReady || phase !== "idle") return;
    const id = AUTO_TOURS[location.pathname];
    if (id && TOURS[id] && !localStorage.getItem(seenKey(id))) begin(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userReady, phase, location.pathname]);

  // startTour() subscription — replay skips the welcome modal.
  useEffect(() => {
    listeners.add(begin);
    return () => {
      listeners.delete(begin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show the current step: open the sidebar/group so a nav anchor is mounted,
  // navigate to the step's page, then measure. A missing anchor auto-advances
  // in the travel direction after waitMs (grace for lazy page content); walking
  // off either end finishes the tour. Anchor-less steps center the card.
  useEffect(() => {
    if (!step) return;
    if (step.group || step.anchor?.startsWith("nav-")) expandSidebar();
    if (step.group) openGroup(step.group);
    if (step.route && location.pathname !== step.route) navigate(step.route);
    if (!step.anchor) {
      setRect(null);
      return;
    }
    let cancelled = false;
    const deadline = Date.now() + (step.waitMs ?? 0);
    const attempt = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest" });
        setRect(el.getBoundingClientRect());
        return;
      }
      if (Date.now() < deadline) {
        window.setTimeout(attempt, RETRY_MS);
        return;
      }
      const n = stepIndex + dirRef.current;
      if (n < 0 || n >= steps.length) end();
      else setStepIndex(n);
    };
    const raf = requestAnimationFrame(attempt);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // expandSidebar/openGroup are inline props from App — deliberately not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tourId, stepIndex]);

  // Focus Next when a step shows (after the card is in the DOM).
  useEffect(() => {
    if (step) nextRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stepIndex, rect === null]);

  // Track the anchor on scroll/resize (same shape as MoreMenu in DetailBits).
  useEffect(() => {
    if (!step?.anchor) return;
    const update = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [step]);

  // Keyboard while touring: Esc ends, arrows step.
  useEffect(() => {
    if (phase !== "steps") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Place the anchored card once its height is measurable: prefer right of the
  // anchor, fall below for header anchors, flip above when the bottom is tight.
  useLayoutEffect(() => {
    if (!rect) {
      setPos(null);
      return;
    }
    const h = cardRef.current?.offsetHeight ?? 0;
    let left = rect.right + 12;
    let top = rect.top;
    if (left + CARD_W > window.innerWidth - 8) {
      left = Math.max(8, Math.min(rect.right - CARD_W, window.innerWidth - CARD_W - 8));
      top = rect.bottom + 12;
    }
    if (top + h > window.innerHeight - 8) {
      top = rect.top - h - 12 > 8 ? rect.top - h - 12 : Math.max(8, window.innerHeight - h - 8);
    }
    setPos({ left, top });
  }, [rect, stepIndex]);

  const centered = !!step && !step.anchor;
  return (
    <>
      {phase === "welcome" && (
        <WelcomeModal
          onStart={() => {
            localStorage.setItem(seenKey("main"), "1");
            begin("main");
          }}
          onSkip={() => {
            localStorage.setItem(seenKey("main"), "1");
            setPhase("idle");
          }}
        />
      )}
      {step &&
        createPortal(
          <>
            {step.anchor && rect && (
              <div
                className="tour-spotlight"
                style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
              />
            )}
            <div
              ref={cardRef}
              className={`tour-card${centered ? " center" : ""}`}
              role="dialog"
              aria-label={step.title}
              style={
                centered
                  ? undefined
                  : { left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }
              }
            >
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="tour-foot">
                {/* ponytail: counter is against the raw list — role-skipped steps make it jump. */}
                <span className="tour-count">
                  {stepIndex + 1}/{steps.length}
                </span>
                <button className="tour-skip" onClick={end}>
                  Skip tour
                </button>
                {stepIndex > 0 && (
                  <button className="btn" onClick={back}>
                    Back
                  </button>
                )}
                <button className="hbtn primary" ref={nextRef} onClick={next}>
                  {stepIndex === steps.length - 1 ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
