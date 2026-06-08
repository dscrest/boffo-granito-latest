// Ambient types for the Catalyst Web SDK global, available only on the deployed
// Catalyst domain (injected via /__catalyst/sdk/init.js). Optional on `window`
// because under local `vite dev` it is absent.

export interface CatalystUser {
  user_id?: string;
  first_name?: string;
  last_name?: string;
  email_id?: string;
  time_zone?: string;
  role_details?: { role_name?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalystSignInConfig {
  css_url?: string;
  service_url?: string;
  signin_providers_only?: boolean;
  is_customize_forgot_password?: boolean;
}

export interface CatalystAuth {
  isUserAuthenticated(): Promise<CatalystUser>;
  signIn(elementId: string, config?: CatalystSignInConfig): void;
  signOut(redirectURL: string): void;
}

export interface CatalystGlobal {
  auth: CatalystAuth;
}

declare global {
  interface Window {
    catalyst?: CatalystGlobal;
  }
}

export {};
