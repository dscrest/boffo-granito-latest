// Auth abstraction with a build-time split:
//  - Prod (deployed Catalyst domain): use the real Catalyst Web SDK (window.catalyst.auth).
//  - Dev (vite): /__catalyst/sdk/init.js 404s so window.catalyst is absent; return a stub
//    that resolves a fake Admin user. The UI gate is convenience only — every function
//    re-verifies the user server-side via getCurrentUser().
import type { CatalystUser } from "../types/catalyst";

export interface SessionUser {
  email: string;
  name: string;
  role: string;
}

const DEV_USER: SessionUser = { email: "dev@boffo.local", name: "Dev Admin", role: "Admin" };

function toSessionUser(u: CatalystUser): SessionUser {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return {
    email: u.email_id ?? "",
    name: name || (u.email_id ?? "User"),
    role: u.role_details?.role_name ?? "User",
  };
}

const useStub = import.meta.env.DEV || !window.catalyst?.auth;

export async function checkSession(): Promise<SessionUser | null> {
  if (useStub) {
    // Dev-only preview escape hatch: append `?login` to view the anon login screen
    // (the stub otherwise auto-authenticates and you never see it).
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("login")) {
      return null;
    }
    return DEV_USER;
  }
  try {
    const u = await window.catalyst!.auth.isUserAuthenticated();
    return toSessionUser(u);
  } catch {
    return null;
  }
}

export function showLogin(elementId: string): void {
  if (useStub) return;
  // The form renders in a cross-origin iframe. Do NOT pass css_url: it makes Zoho
  // load our stylesheet *instead of* its own, which drops the display:none rules that
  // hide inactive steps — so every panel (email/password/OTP/CAPTCHA/MFA…) renders at
  // once. Letting Zoho use its own complete stylesheet gives a clean single-step form;
  // the surrounding BOFFO card supplies the branding. service_url returns to the SPA.
  window.catalyst!.auth.signIn(elementId, {
    service_url: "/app/index.html",
  });
}

// Full-page Zoho sign-in via Catalyst's hosted login page. Distinct from the
// embedded email widget above: this hands the whole sign-in (incl. MFA / OneAuth)
// to Zoho's hosted page, which redirects back to the app on success (return target
// is set by the console's hosted-login redirect config). The `/__catalyst/auth/login`
// route only exists on the deployed/served Catalyst domain.
export function signInWithZoho(): void {
  if (useStub) {
    // Dev stub: no real auth available; the gate already treats us as signed in.
    window.location.assign("/app/index.html");
    return;
  }
  window.location.assign("/__catalyst/auth/login");
}

export function signOut(): void {
  if (useStub) return;
  window.catalyst!.auth.signOut("/app/index.html");
}
