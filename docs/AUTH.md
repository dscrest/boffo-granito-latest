# Authentication & Zoho integration — reference

> How BOFFO signs people in, how "Sign in with Zoho" was set up on 2026-10-12 (CR-324), and how the
> Zoho Books connection behind customer mapping works (CR-325). Read this before touching
> `functions/data-ops/lib/appauth.js`, `functions/data-ops/lib/zoho.js`, `client/src/AuthGate.tsx` or
> the Zoho API console. The system reference is [`SYSTEM.md`](SYSTEM.md) §9; the request history is
> [`CHANGE-REQUESTS.md`](CHANGE-REQUESTS.md) CR-324 / CR-325.

---

## 1 · The two ways in

| | Email + password | Sign in with Zoho |
|---|---|---|
| Who | Any `AppUser` with a password (optional since CR-337) | Any `AppUser` whose **email equals the Zoho account's email** — or, since CR-337, anyone from an **allowed domain** (AppSetting `zoho_login_domains`), who is created as **Staff** on first sign-in |
| What Zoho is involved | none | the Zoho **account** (the identity behind Zoho Mail) — not Zoho Books |
| What is stored | `password_hash` on `AppUser` | `zoho_zuid` + `zoho_linked_at` on `AppUser` (first sign-in; drives the Users grid's **Sign-in** column); no Zoho token |
| Who creates the user | an Admin, Settings → Users (role defaults to Staff) | an Admin, or **self-provisioning as Staff** when the email's domain is allowed; any other unknown email is refused |
| Result | identical: 7-day `AuthSession`, httpOnly `boffo_session` cookie, `localStorage.boffo_auth` | identical (same `mintSession`) |

Auth is **app-level** (own tables `AppUser` / `Role` / `AuthSession`), not Catalyst Embedded Auth.
The Zoho flow is a custom OAuth 2.0 authorization-code flow ported from the SKU generator.

---

## 2 · Sign in with Zoho — the flow

```
Login page   "Sign in with Zoho"
   │  POST /server/data-ops/auth/zoho/start            (anonymous)
   │  ← 200 {url} + Set-Cookie boffo_oauth_state=<state> (httpOnly, Lax, 10 min)
   │     state = <nonce>.<purpose>.<expiry>.<HMAC(ZOHO_CLIENT_SECRET)>          (CR-443, signed)
   │  browser: sessionStorage.boffo_oauth_state = state; location.href = url
   ▼
accounts.zoho.in/oauth/v2/auth?client_id&redirect_uri&scope=AaaServer.profile.READ
                               &response_type=code&access_type=online&state=<nonce>
   │  user signs in / consents (first time only)
   ▼
https://<app domain>/app/?code=…&state=<nonce>&location=in|us|eu…   ← the Authorized Redirect URI
   │  AuthGate (mounted outside the HashRouter) reads location.search;
   │  the remembered sessionStorage state must equal ?state (same browser)
   │  POST /auth/zoho/exchange {code, state, location}             (anonymous)
   ▼
server: verifyState(state) — signature + expiry; if the browser sent the cookie it must equal state
        → POST https://accounts.zoho.<location>/oauth/v2/token (code→access token)
        → GET  https://accounts.zoho.<location>/oauth/user/info   (Email, name, ZUID)
        → AppUser WHERE email = <Email> AND active AND deleted_at is null
        → mintSession(): AuthSession row + boffo_session cookie + {token, user}
client: stores {token,user} in localStorage.boffo_auth, strips ?code from the URL, renders the app
```

Rules that matter:

- **Only pre-created users.** Decision 2026-10-12: the Zoho email must match an existing active
  `AppUser`. Roles stay Admin-controlled. Unknown email → `No BOFFO account for <email>. Ask your administrator.`
- **Signed state = CSRF guard (CR-443).** The state carries its own HMAC and expiry, so the exchange
  no longer depends on the `boffo_oauth_state` cookie — a cross-origin front end (Catalyst Slate)
  never sends that cookie back (SameSite) and every sign-in there used to "expire". The cookie is still
  compared when the browser does send it, and the client refuses a state it did not leave with
  (`sessionStorage`). Bad / expired / mismatched state → 400 "Sign-in request expired — try again".
  The cookie is cleared on every exchange attempt.
- **Multi-DC.** Consent starts on `accounts.zoho.<ZOHO_DC>` (`in`). Zoho appends `location` to the
  callback; the token exchange and the profile call go to **that** DC's host. Accounts on `.com`,
  `.eu`, … work with the same client because Multi-DC is on in the console.
- **Identity only.** Scope `AaaServer.profile.READ`, `access_type=online` → no refresh token; the only
  Zoho-side facts kept are `zoho_zuid` / `zoho_linked_at` on the `AppUser` (CR-337).
- `/auth/zoho/start` and `/auth/zoho/exchange` are the only anonymous routes besides `/auth/login`
  (guard allow-list in `appauth.js`).

Code: `functions/data-ops/lib/zoho.js` (hosts, `authUrl`, `exchangeCode`, `userInfo`),
`functions/data-ops/lib/appauth.js` (`/auth/zoho/*`, `mintSession`, `findUser`, `readCookie`),
`client/src/lib/auth.ts` (`startZohoSignIn`, `exchangeZohoCode`, shared `postAuth`),
`client/src/AuthGate.tsx` (button, `?code=` handler), `client/src/styles/login.css`.

---

## 3 · What we did on 2026-10-12 — step by step (repeat for a new domain / project)

### 3.1 Zoho API console (done by the OCTFIS admin)

1. https://api-console.zoho.in (the account lives on the India DC) → **Add Client** →
   **Server-based Applications**. (Not Self Client, not Client-based: they cannot do the server-side
   secret exchange.)
2. Fields used:

   | Field | Value |
   |---|---|
   | Client Name | `BOFFO Order OS` |
   | Homepage URL | `https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/app/` |
   | Authorized Redirect URI | `https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/app/` |

   Press **⊕** next to the redirect URI before Create, or it silently is not saved. The **trailing
   slash is required**: Catalyst hosting serves `/app/?code=…` (200) but `/app?code=…` is a 404.
3. **Client Secret** tab → copy Client ID (`1000.…`) and Client Secret.
4. **Settings** tab → Multi-DC: enable all data centres and tick **Use the same OAuth credentials for
   all data centers**.

The live client ID is `1000.7D08D7QDE3PN96P0K80TBKD0R5OX2C`. The secret is only in the local config
file (and should be regenerated at some point — it once passed through a chat).

### 3.2 Function environment

`functions/data-ops/catalyst-config.json` — **gitignored since CR-324** (`functions/*/catalyst-config.json`);
the committed template is `catalyst-config.example.json`. The local file must exist at deploy time
because `catalyst deploy` reads `env_variables` from it.

```json
"env_variables": {
  "FX_CRON_KEY": "<existing>",
  "ZOHO_CLIENT_ID": "1000.…",
  "ZOHO_CLIENT_SECRET": "<secret>",
  "ZOHO_DC": "in",
  "ZOHO_REDIRECT_URI": "https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/app/"
}
```

`ZOHO_REDIRECT_URI` must equal the console entry **character for character**. Until all three
`ZOHO_*` values are set, `/auth/zoho/start` answers 503 and the button shows "Zoho sign-in is not
configured".

### 3.3 Users

The Zoho account's **primary email** must exist as an active `AppUser`. On 2026-10-12 the client's
owner Raj had an Admin row under the placeholder `raj.a@boffo.com`; its email was changed to
`raj@boffogranito.com` (ROWID `69851000000255275`). OCTFIS staff (`…@octfis.com`) keep password
login unless their Zoho emails are added/matched the same way. To let someone use Zoho: Settings →
Users → create them with their Zoho email (password optional — blank = Zoho only), role as needed —
or (CR-337) list the company domain under **Zoho sign-in domains** on the Users page and let them sign
in: the first Zoho sign-in creates a **Staff** account (view + create, no edit / delete) that Admin can
upgrade afterwards.

### 3.4 Deploy and verify

```bash
npm --prefix client run build                      # tsc + vite
catalyst deploy --project boffo-granito-export-tracker --org 925638796
```

Live probes that passed (repeat after any auth change):

```bash
D=https://boffo-granito-export-tracker-925638796.development.catalystserverless.com/server/data-ops
curl -s -i -X POST -H 'Content-Type: application/json' -d '{}' $D/auth/zoho/start      # 200 {url}, Set-Cookie boffo_oauth_state
curl -s -X POST -H 'Content-Type: application/json' -d '{"code":"x","state":"y"}' $D/auth/zoho/exchange   # 400 expired
curl -s -o /dev/null -w "%{http_code}\n" $D/zoho/books/status                          # 401 (guarded)
curl -s -o /dev/null -w "%{http_code}\n" "https://…/app/?code=x&state=y"               # 200 (SPA serves)
```

Offline (no Zoho needed): `node client/src/features/masters/booksMap.check.ts`; the route handlers
can be driven with a fake Express app (see the CR-324 session smoke test: 503 unconfigured,
400 bad state, 403 non-Admin Books connect, correct scopes/cookies when configured).

Browser drive (needs a real Zoho login — Raj): Sign in with Zoho → lands signed in; sign out; password
login still works; a Zoho account whose email is not an `AppUser` sees "No BOFFO account for …".

**Never test the Zoho flow from `vite dev`:** the state cookie lands on localhost (proxy cookie
rewrite) while Zoho returns to the deployed `/app/` → guaranteed state mismatch. Test on the
Development domain, which is the live app.

---

## 4 · Zoho connection (CR-325, CR-356, CR-359) — one Admin, one organisation per provider

> **CR-359 (2026-10-21):** the active customer source is **Zoho CRM Accounts** (`ACTIVE_PROVIDER = "crm"` in `lib/zoho.js`); everything below applies per provider — routes are `/zoho/:provider/…`, the consent scope is the provider's (`SCOPE_CRM` = Accounts + Contacts read/create/update, settings.fields, org, securesearch), AppSetting rows are `zoho_<provider>_*`. Books is hidden, its rows kept.

Purpose: let users **map** an app Customer to its Zoho Books contact and pull the contact's details
into the customer form; since CR-356 the server also syncs customers from Books (CR-358: the moment they change, via a
Catalyst Signals webhook on the Books publisher; daily cron as backstop) and
pushes a customer to Books on request (scope adds `ZohoBooks.contacts.CREATE,UPDATE` — a connection
made before CR-356 is read-only until an Admin reconnects; the API console needs no change). Ordinary
users do **not** need Zoho Books access; one Admin who has it connects once.

```
Settings → Zoho Books → Connect           POST /zoho/books/connect        (Admin)
  ← {url} + cookie boffo_oauth_state=<nonce>.books
  Zoho consent: scope ZohoBooks.contacts.READ,ZohoBooks.settings.READ, access_type=offline, prompt=consent
  → back on /app/?code=…  → the SAME /auth/zoho/exchange
  server: cookie suffix "books" → caller must be a signed-in Admin → exchange → refresh token required
          → GET /books/v3/organizations → first organisation
          → 4 AppSetting rows: zoho_books_refresh_token / _dc / _org_id / _org_name
  client: AuthGate sees {books} → lands on #/settings/zoho-books ("Connected to <org>")
```

- Reads used by the mapping: `GET /zoho/books/status`, `GET /zoho/books/contacts?q=`
  (`contact_type=customer&contact_name_contains=`), `GET /zoho/books/contacts/:id`.
  `DELETE /zoho/books/connection` (Admin) revokes the refresh token and deletes the rows.
- Access tokens are refreshed server-side per warm instance (< 60 s left → refresh). A 409
  `reauth_required` from any Books route means "Connect Zoho Books in Settings".
- Guard: `ROUTE_PERM.zoho = ["customers","edit"]`; connect/disconnect re-check Admin inline.
- **Secret handling:** `SECRET_SETTINGS` (`zoho.js`) hides `zoho_books_refresh_token` from the
  generic `GET /AppSetting` reads (`isSecretSetting` in `index.js`). Only `zoho.js` writes those rows.
- **Mapping UX** (all manual): Customers ▸ **From Zoho Books** → search → pick → `/parties/new`
  prefilled; a customer's More ▸ **Map to Zoho Books** / **Re-pull from Zoho Books** / **Unmap**
  → `/parties/:code/edit` prefilled. `PartyFormPage` merges `booksContactToInput()` over the current
  values and shows the "Filled from Zoho Books" banner. **The form is the review step; nothing is
  written until Save**, which is the normal generic Customer POST/PATCH. `Customer.books_contact_id`
  is the link.
- Mapped fields: `contact_name`→name, `company_name` (fallback contact_name), `customer_sub_type`,
  `currency_code`, `payment_terms_label` (→ PaymentTerm by label), primary contact person (flagged
  one, else top-level fields), billing/shipping address (`address`→street1, `zip`→pincode), other
  contact persons → `contact_persons` JSON. **Not mapped — no column yet:** `gst_no`,
  `gst_treatment`, `place_of_contact`, `pan_no`, `website`, opening balance, tax preferences.
  Adding one = a Customer column + one line in `client/src/features/masters/booksMap.ts`.

---

## 5 · Moving to a new domain (production / custom domain)

Three things change **together, in one deploy**:

1. Zoho API console → the client → add `https://<new domain>/app/` as another Authorized Redirect URI (⊕!).
2. `ZOHO_REDIRECT_URI` in `catalyst-config.json` → the same value. One deployment serves one redirect
   URI, so switch it when the deployment itself moves.
3. `APP_CORS_ORIGINS` / the CORS allow-list in `index.js` if the client is no longer same-origin
   (see the Slate migration plan).

The Books connection is unaffected (refresh token is not tied to the redirect URI).

---

## 6 · Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Button says "Zoho sign-in is not configured" | `ZOHO_CLIENT_ID/SECRET/REDIRECT_URI` missing in the deployed function | fill `catalyst-config.json`, redeploy |
| Zoho page: `Invalid Redirect Uri` | console URI ≠ `ZOHO_REDIRECT_URI` (slash, host, http/https) | make them identical; press ⊕ in the console |
| `/app?code=…` is a 404 | redirect URI without trailing slash | use `/app/` |
| "Sign-in request expired — try again" | state cookie missing/mismatched: > 10 min, flow started from localhost, cookies blocked, or a replayed URL | start again from the deployed login page |
| "No BOFFO account for x@y" | that Zoho primary email is not an active `AppUser` | create / rename the user (Settings → Users) |
| "Your Zoho account has no email address" | phone-registered Zoho account | add an email in Zoho Accounts |
| `Zoho sign-in failed (in, 400): invalid_code` | exchange hit the wrong DC host, or the code was reused | `location` must reach the exchange; never replay a callback URL |
| `Platform not allowed` on exchange | console client type / Multi-DC setting — not a secret typo (Zoho validates the code before the secret) | client must be Server-based; Multi-DC "same credentials" on |
| Books routes → 409 `reauth_required` | no connection, refresh token revoked, or token predates a scope | Settings → Zoho Books → Connect again |
| "Zoho did not grant offline access" | consent returned no refresh token | Connect again (it forces `prompt=consent`) |
| Zoho Books shows the wrong organisation | first org of the account is taken | disconnect, connect with an account whose first org is right (picker not built) |

Reference implementation and history: sku-generator `functions/skuapi/zoho/auth.js`, `routes/zohoAuth.js`,
`ZOHO_AUTH.md`.
