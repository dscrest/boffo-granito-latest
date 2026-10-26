/* Login gate. State machine: checking → (authed | anon).
   - authed: render the app.
   - anon: a two-column BOFFO sign-in screen (Sign in with Zoho on top, the
     email+password form below, illustration right). Auth is app-level:
     data-ops /auth/login verifies against the AppUser table and returns a
     session token + role permissions (see lib/auth.ts). Themed via login.css.
   CR-324: Zoho's consent screen sends the browser back to /app/?code=…;
   this gate (mounted outside the HashRouter, so location.search is intact)
   exchanges the code before the usual session check. */
import { useEffect, useState } from "react";
import { checkSession, exchangeZohoCode, signIn, startZohoSignIn, takeOauthState, type SessionUser } from "./lib/auth";
import { orgLogoUrl, useOrg } from "./lib/org";
import { BoffoLoader } from "./ui/BoffoLoader";
import "./styles/login.css";

type Status = "checking" | "anon" | "authed";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const org = useOrg(); // CR-445: logo + name from Settings ▸ Organization
  const logoUrl = orgLogoUrl();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams(window.location.search);
    const code = qs.get("code");
    const oauthError = qs.get("error");
    // Drop ?code=… from the address bar (a code is single-use and expires in 2 min).
    const scrub = () => window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    const run = async () => {
      if (code) {
        try {
          const state = qs.get("state") ?? "";
          // CR-443: the state we left with must come back (ponytail: lenient when storage had none —
          // the server still verifies the state's signature and expiry).
          const left = takeOauthState();
          if (left && left !== state) throw new Error("Sign-in request expired — try again");
          const r = await exchangeZohoCode(code, state, qs.get("location") ?? "");
          scrub();
          // An Admin's "Connect Zoho …" round trip: already signed in — land on the pane.
          if (r.zoho) window.location.hash = "#/settings/zoho";
        } catch (err) {
          scrub();
          setError(err instanceof Error ? err.message : "Zoho sign-in failed");
        }
      } else if (oauthError) {
        scrub();
        setError(oauthError === "access_denied" ? "Zoho sign-in was cancelled" : `Zoho sign-in failed (${oauthError})`);
      }
      const user: SessionUser | null = await checkSession();
      if (!alive) return;
      setStatus(user ? "authed" : "anon");
    };
    void run();
    return () => {
      alive = false;
    };
  }, []);

  const onZoho = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await startZohoSignIn(); // navigates away on success
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zoho sign-in failed");
      setBusy(false);
    }
  };

  // The app is laid out for a fixed 1440px desktop viewport (set in index.html),
  // but the login screen should be responsive so it never forces horizontal scroll /
  // zoom-out on smaller screens. Swap the viewport while the login gate is showing
  // and restore it once the app renders.
  useEffect(() => {
    if (status !== "anon") return;
    const vp = document.querySelector('meta[name="viewport"]');
    if (!vp) return;
    const prev = vp.getAttribute("content");
    vp.setAttribute("content", "width=device-width, initial-scale=1");
    return () => {
      if (prev !== null) vp.setAttribute("content", prev);
    };
  }, [status]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      setStatus("authed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") {
    return (
      <div className="boffo-auth boffo-auth--center">
        <BoffoLoader label="Loading…" />
      </div>
    );
  }

  if (status === "anon") {
    return (
      <div className="boffo-auth">
        <div className="boffo-auth-split">
          {/* ---- Left: the sign-in form ---- */}
          <div className="boffo-auth-pane">
            <form className="boffo-auth-form" onSubmit={onSubmit}>
              <div className="boffo-auth-brand">
                {/* CR-445: the org logo from Settings ▸ Organization; the bundled
                    BOFFO logo is the fallback (skipped on the demo build, CR-444). */}
                {logoUrl && <img className="logo" src={logoUrl} alt={org.name} />}
                <span className="sub">Order OS</span>
              </div>

              <h1 className="boffo-auth-h1">Welcome back</h1>
              <p className="boffo-auth-tag">
                Sign in to manage quotes, orders, production and dispatch.
              </p>

              <button type="button" className="boffo-zoho-btn" onClick={() => void onZoho()} disabled={busy}>
                <ZohoMark />
                {busy ? "Opening Zoho…" : "Sign in with Zoho"}
              </button>
              <div className="boffo-auth-or"><span>or use your password</span></div>

              <label className="boffo-auth-field">
                <span>Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="username"
                  required
                  autoFocus
                />
              </label>
              <label className="boffo-auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </label>

              {error && <p className="boffo-auth-error">{error}</p>}

              <button type="submit" className="boffo-zoho-btn boffo-auth-submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <p className="boffo-auth-hint">
                Use your Zoho account, or the password your administrator created for you.
              </p>

              <div className="boffo-auth-foot">
                <span className="dot" />
                Secure access
              </div>
            </form>
          </div>

          {/* ---- Right: branded illustration panel ---- */}
          <div className="boffo-auth-art" aria-hidden="true">
            <FactoryArt />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/* Zoho "Z" glyph for the sign-in button (inline so login.css owns the colour). */
function ZohoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" opacity="0.15" />
      <path d="M7 7.5h10L7 16.5h10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* Decorative line-art for the right panel: an Order-OS motif — stacked dispatch
   cartons, a delivery truck, a tile grid and floating status glyphs — drawn in
   translucent white over the accent gradient (set in CSS). Purely ornamental. */
function FactoryArt() {
  return (
    <svg viewBox="0 0 520 520" className="boffo-art-svg" fill="none" focusable="false">
      <g
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* scatter of order / status glyphs */}
        <circle cx="92" cy="86" r="22" />
        <path d="M83 86l6 6 11-12" />
        <rect x="150" y="58" width="58" height="40" rx="6" />
        <path d="M150 70h58M163 84h20" />
        <circle cx="430" cy="78" r="20" />
        <path d="M430 70v8l5 4" />
        <path d="M250 92h44M250 104h30" />
        <rect x="392" y="150" width="60" height="44" rx="6" />
        <path d="M392 164h60M404 178h22" />

        {/* tile / granito grid */}
        <g opacity="0.8">
          <rect x="60" y="168" width="84" height="84" rx="8" />
          <path d="M102 168v84M60 210h84" />
        </g>

        {/* central isometric carton stack */}
        <g transform="translate(196 188)">
          <path d="M64 24l64 32v76l-64 32-64-32V56z" fill="rgba(255,255,255,0.10)" />
          <path d="M0 56l64 32 64-32M64 88v76" />
          <path d="M64 24l64 32-64 32-64-32z" fill="rgba(255,255,255,0.18)" />
          <path d="M30 40l64 32" opacity="0.6" />
        </g>

        {/* delivery truck */}
        <g transform="translate(112 372)">
          <rect x="0" y="18" width="120" height="64" rx="8" fill="rgba(255,255,255,0.08)" />
          <path d="M120 40h54l30 30v12h-84z" fill="rgba(255,255,255,0.08)" />
          <path d="M120 40v42" />
          <circle cx="160" cy="92" r="16" />
          <path d="M0 70h300" opacity="0.5" />
        </g>

        {/* connection dots */}
        <circle cx="356" cy="300" r="4" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="404" cy="356" r="4" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="452" cy="280" r="4" fill="rgba(255,255,255,0.7)" stroke="none" />
        <path d="M356 300l48 56M404 356l48-76" opacity="0.45" />
      </g>
    </svg>
  );
}
