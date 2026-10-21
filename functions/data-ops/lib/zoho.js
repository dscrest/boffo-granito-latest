"use strict";

/**
 * Zoho OAuth + Zoho API helpers (Books and CRM).
 *   CR-324 Sign in with Zoho — scope AaaServer.profile.READ, access_type=online, nothing stored.
 *   CR-325 Books mapping     — ONE org-wide refresh token in AppSetting (zoho_books_* keys), offline.
 *   CR-356 Books sync        — contacts.CREATE/UPDATE scope (push); sync in lib/booksSync.js.
 *   CR-359 CRM Accounts      — the customer source is a PROVIDER (books | crm); ACTIVE_PROVIDER picks
 *                              the one the UI shows. Books is hidden, not removed: its connection, code
 *                              and books_contact_id values stay. Sync core = lib/customerSync.js,
 *                              adapters = lib/booksSync.js / lib/crmSync.js.
 * One Server-based client in the Zoho API console serves everything — scopes are granted at consent,
 * nothing is configured per product in the console. Env (functions/data-ops/catalyst-config.json —
 * gitignored, copy catalyst-config.example.json):
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI (the SPA "/app/" — must match the
 *   console entry character for character), ZOHO_DC (default "in": where consent starts).
 * Multi-DC: Zoho's callback carries `location` (us|eu|in|…); the token exchange and every API
 * call must go to THAT DC's hosts (the console client runs "same credentials for all DCs").
 */
const DC = process.env.ZOHO_DC || "in";
const CLIENT_ID = process.env.ZOHO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI || "";

const DC_HOSTS = {
  us: ["accounts.zoho.com", "www.zohoapis.com"],
  eu: ["accounts.zoho.eu", "www.zohoapis.eu"],
  in: ["accounts.zoho.in", "www.zohoapis.in"],
  au: ["accounts.zoho.com.au", "www.zohoapis.com.au"],
  jp: ["accounts.zoho.jp", "www.zohoapis.jp"],
  uk: ["accounts.zoho.uk", "www.zohoapis.uk"],
  sa: ["accounts.zoho.sa", "www.zohoapis.sa"],
  ca: ["accounts.zohocloud.ca", "www.zohoapis.ca"],
};
function hosts(dc) {
  const h = DC_HOSTS[String(dc || "").toLowerCase()];
  return h ? { accounts: h[0], api: h[1] } : { accounts: `accounts.zoho.${DC}`, api: `www.zohoapis.${DC}` };
}

function httpErr(msg, code) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}
const isConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
function assertConfigured() {
  if (!isConfigured()) throw httpErr("Zoho sign-in is not configured", 503);
}

const SCOPE_LOGIN = "AaaServer.profile.READ";
const SCOPE_BOOKS = "ZohoBooks.contacts.READ,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.UPDATE,ZohoBooks.settings.READ";
const SCOPE_CRM =
  "ZohoCRM.modules.accounts.READ,ZohoCRM.modules.accounts.CREATE,ZohoCRM.modules.accounts.UPDATE," +
  "ZohoCRM.modules.contacts.READ,ZohoCRM.modules.contacts.CREATE,ZohoCRM.modules.contacts.UPDATE," +
  "ZohoCRM.settings.fields.READ,ZohoCRM.org.READ,ZohoSearch.securesearch.READ";

/* ---------------- providers ---------------- */
/** The customer source the UI shows. Books stays installed and reachable (hidden), see CR-359. */
const ACTIVE_PROVIDER = "crm";
const PROVIDERS = {
  books: { name: "books", label: "Zoho Books", scope: SCOPE_BOOKS, base: "/books/v3", orgParam: true, canWrite: /contacts\.(CREATE|ALL)/ },
  crm: { name: "crm", label: "Zoho CRM", scope: SCOPE_CRM, base: "/crm/v8", orgParam: false, canWrite: /accounts\.(CREATE|ALL)/ },
};
const providerOf = (name) => PROVIDERS[String(name || "").toLowerCase()] || null;

/** Consent URL. offline (+prompt=consent) is what yields a refresh token; sign-in is online. */
function authUrl({ scope, state, offline }) {
  assertConfigured();
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope,
    response_type: "code",
    access_type: offline ? "offline" : "online",
    state,
  });
  if (offline) p.set("prompt", "consent");
  return `https://${hosts(DC).accounts}/oauth/v2/auth?${p}`;
}

async function tokenPost(dc, params) {
  const res = await fetch(`https://${hosts(dc).accounts}/oauth/v2/token`, { method: "POST", body: new URLSearchParams(params) });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    // Zoho's error strings are undocumented: invalid_code = exchange sent to the wrong DC's
    // host; "Platform not allowed" = console client type / multi-DC setting — never a secret typo.
    throw httpErr(`Zoho sign-in failed (${dc || DC}, ${res.status}): ${data.error || JSON.stringify(data)}`, 401);
  }
  return data;
}
function exchangeCode(code, dc) {
  assertConfigured();
  return tokenPost(dc, { code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" });
}
const refreshAccessToken = (refresh, dc) =>
  tokenPost(dc, { refresh_token: refresh, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token" });

async function revokeToken(refresh, dc) {
  try {
    await fetch(`https://${hosts(dc).accounts}/oauth/v2/token/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" });
  } catch {
    /* best-effort */
  }
}

/** Zoho account profile. Email may be null for phone-registered accounts (common on .in). */
async function userInfo(accessToken, dc) {
  const res = await fetch(`https://${hosts(dc).accounts}/oauth/user/info`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
  const d = await res.json().catch(() => ({}));
  if (!d.ZUID) throw httpErr("Could not read your Zoho profile", 401);
  return { email: String(d.Email || "").toLowerCase().trim(), name: [d.First_Name, d.Last_Name].filter(Boolean).join(" "), zuid: String(d.ZUID) };
}

/* ---------------- connection: five AppSetting rows per provider ---------------- */
/** Every zoho_* AppSetting row is server-owned: generic writes from non-Admins are refused (index.js). */
const SETTING_PREFIX = "zoho_";
const keysFor = (provider) => ({
  refresh: `zoho_${provider}_refresh_token`,
  dc: `zoho_${provider}_dc`,
  orgId: `zoho_${provider}_org_id`,
  orgName: `zoho_${provider}_org_name`,
  scope: `zoho_${provider}_scope`, // CR-356: what the consent granted — decides canWrite
});
/** Setting keys that never leave the server via the generic AppSetting reads (index.js). */
const SECRET_SETTINGS = new Set(Object.keys(PROVIDERS).map((p) => keysFor(p).refresh));

/** AppSetting rows for `keys` (ROWID, setting_key, setting_value). */
async function settingRows(catalyst, rowList, keys) {
  const list = keys.map((k) => `'${k}'`).join(",");
  return rowList(
    await catalyst.zcql().executeZCQLQuery(
      `SELECT ROWID, setting_key, setting_value FROM AppSetting WHERE setting_key IN (${list}) AND deleted_at is null`,
    ),
  );
}
/** Upsert one AppSetting row. */
async function putSetting(catalyst, rowList, key, value) {
  const row = (await module.exports.settingRows(catalyst, rowList, [key]))[0];
  const table = catalyst.datastore().table("AppSetting");
  if (row) await table.updateRow({ ROWID: row.ROWID, setting_value: value });
  else await table.insertRow({ setting_key: key, setting_value: value });
}
async function getConnection(catalyst, rowList, provider = ACTIVE_PROVIDER) {
  const K = keysFor(provider);
  const rows = await module.exports.settingRows(catalyst, rowList, Object.values(K));
  const get = (k) => String((rows.find((r) => String(r.setting_key) === k) || {}).setting_value || "");
  const refresh = get(K.refresh);
  return refresh ? { provider, refresh, dc: get(K.dc) || DC, orgId: get(K.orgId), orgName: get(K.orgName), scope: get(K.scope) } : null;
}
async function saveConnection(catalyst, rowList, conn) {
  const K = keysFor(conn.provider);
  const want = { [K.refresh]: conn.refresh, [K.dc]: conn.dc, [K.orgId]: conn.orgId, [K.orgName]: conn.orgName, [K.scope]: conn.scope };
  for (const [k, v] of Object.entries(want)) await putSetting(catalyst, rowList, k, v);
}
async function clearConnection(catalyst, rowList, provider) {
  const conn = await getConnection(catalyst, rowList, provider);
  if (conn) await revokeToken(conn.refresh, conn.dc);
  const table = catalyst.datastore().table("AppSetting");
  // The sync watermark (customerSync.js) is NOT a connection row — it survives a reconnect.
  for (const r of await module.exports.settingRows(catalyst, rowList, Object.values(keysFor(provider)))) await table.deleteRow(r.ROWID);
  if (conn) tokenCache.delete(conn.refresh);
}
/** True when the stored consent allows creating/updating records (push). */
const canWrite = (conn) => !!conn && PROVIDERS[conn.provider].canWrite.test(conn.scope || "");

/* Access token per warm instance, refreshed when < 60 s remain. ONE entry per refresh token
   (CR-363): Zoho allows 10 access-token requests per 10 minutes per app, and a single slot made every
   CRM ⇄ Books switch refresh again (the 2026-10-21 import burned the quota in seconds — Books lookups
   then failed silently). A reconnect never reuses the previous connection's token (new refresh key). */
const tokenCache = new Map(); // refresh → { accessToken, exp }
function primeToken(refresh, accessToken, expiresIn) {
  tokenCache.set(refresh, { accessToken, exp: Date.now() + (Number(expiresIn) || 3600) * 1000 });
}
async function accessTokenFor(conn) {
  const hit = tokenCache.get(conn.refresh);
  if (hit && hit.exp - Date.now() > 60_000) return hit.accessToken;
  let d;
  try {
    d = await refreshAccessToken(conn.refresh, conn.dc);
  } catch (e) {
    // Throttled refresh ≠ revoked token: say so instead of sending the Admin to reconnect.
    if (/too many requests|access denied/i.test((e && e.message) || "")) throw httpErr("Zoho is rate-limiting token refreshes — wait 10 minutes and run again", 429);
    throw e;
  }
  primeToken(conn.refresh, d.access_token, d.expires_in);
  return d.access_token;
}

/* 409 reauth_required — the client shows "Connect <provider> in Settings". */
const reauth = () => httpErr("reauth_required", 409);

/** One Zoho API call for `provider`. `path` starts with "/" (after the provider base) and may carry
    a query; `body` (object) is sent as JSON for POST/PUT; `headers` are extra request headers
    (CRM If-Modified-Since). Books: `organization_id` is appended unless `noOrg`.
    CRM answers: 304 → {notModified:true}; 204 → {data:[]}; DUPLICATE_DATA → 409. */
async function apiCall(catalyst, rowList, provider, path, { method = "GET", body, headers: extra, conn: given, noOrg = false } = {}) {
  const P = providerOf(provider);
  if (!P) throw httpErr("Unknown Zoho provider", 404);
  const conn = given || (await getConnection(catalyst, rowList, P.name));
  if (!conn) throw reauth();
  let token;
  try {
    token = await accessTokenFor(conn);
  } catch (e) {
    if (e && e.statusCode === 429) throw e; // CR-363 throttle — not a reconnect case
    throw reauth(); // refresh token revoked / expired → reconnect
  }
  const sep = path.includes("?") ? "&" : "?";
  const org = P.orgParam && !noOrg ? `${sep}organization_id=${encodeURIComponent(conn.orgId)}` : "";
  const url = `https://${hosts(conn.dc).api}${P.base}${path}${org}`;
  const headers = { Authorization: `Zoho-oauthtoken ${token}`, ...(extra || {}) };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 304) return { notModified: true };
  if (res.status === 204) return { data: [] };
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || data.code === 57 || data.code === "INVALID_TOKEN" || data.code === "AUTHENTICATION_FAILURE") throw reauth();
  if (P.name === "books") {
    if (data.code !== 0) throw httpErr(`Zoho Books: ${data.message || `HTTP ${res.status}`}`, 502);
    return data;
  }
  // CRM: record-level results ride in data[]; a failed record carries its own code.
  const first = Array.isArray(data.data) ? data.data[0] : null;
  const bad = first && first.status === "error" ? first : !res.ok ? data : null;
  if (bad) {
    if (bad.code === "DUPLICATE_DATA") throw httpErr(`Zoho CRM: a record with this ${(bad.details && bad.details.api_name) || "name"} already exists`, 409);
    const detail = bad.details && typeof bad.details === "object" ? ` (${bad.details.api_name || JSON.stringify(bad.details)})` : "";
    throw httpErr(`Zoho CRM: ${bad.message || bad.code || `HTTP ${res.status}`}${detail}`, 502);
  }
  // ponytail: a 429 surfaces as the 502 above; add a retry if a user ever hits it.
  return data;
}
/* Books-flavoured aliases (lib/booksSync.js). */
const booksCall = (catalyst, rowList, path, opts) => apiCall(catalyst, rowList, "books", path, opts);
const booksGet = booksCall;
const getBooksConnection = (catalyst, rowList) => getConnection(catalyst, rowList, "books");
const canWriteBooks = canWrite;

/** After a consent exchange: name the organisation and persist the connection. */
async function connect(catalyst, rowList, tok, dc, provider) {
  const P = providerOf(provider);
  if (!P) throw httpErr("Unknown Zoho provider", 404);
  const conn = { provider: P.name, refresh: tok.refresh_token, dc: dc || DC, orgId: "", orgName: "", scope: String(tok.scope || P.scope) };
  primeToken(conn.refresh, tok.access_token, tok.expires_in);
  if (P.name === "books") {
    const orgs = (await apiCall(catalyst, rowList, "books", "/organizations", { conn, noOrg: true })).organizations || [];
    if (!orgs.length) throw httpErr("This Zoho account has no Zoho Books organisation", 400);
    // ponytail: first org; add a picker if an account ever has several.
    conn.orgId = String(orgs[0].organization_id);
    conn.orgName = String(orgs[0].name || "");
  } else {
    const org = ((await apiCall(catalyst, rowList, "crm", "/org", { conn })).org || [])[0] || {};
    conn.orgId = String(org.zgid || org.id || "");
    conn.orgName = String(org.company_name || "");
  }
  await saveConnection(catalyst, rowList, conn);
  return conn;
}
const connectBooks = (catalyst, rowList, tok, dc) => connect(catalyst, rowList, tok, dc, "books");

/* ---- /zoho/:provider/* routes (registered from appauth.register, after the guard) ---- */
function registerZoho(app, { init, rowList, sendErr, assertAdmin, writeOpLog }) {
  const sync = require("./customerSync");
  const adapters = { books: require("./booksSync"), crm: require("./crmSync") };
  const ctx = (req) => ({ catalyst: init(req), rowList, writeOpLog });
  const pick = (req) => {
    const P = providerOf(req.params.provider);
    if (!P) throw httpErr("Unknown Zoho provider", 404);
    return adapters[P.name];
  };
  const rowidOf = (req) => String(req.params.rowid || "").replace(/\D/g, "");

  /* GET /zoho/:provider/status — any signed-in user (the search modal checks it). */
  app.get("/zoho/:provider/status", async (req, res) => {
    try {
      const A = pick(req);
      const catalyst = init(req);
      const conn = await getConnection(catalyst, rowList, A.name);
      res.json({
        ok: true,
        provider: A.name,
        active: A.name === ACTIVE_PROVIDER,
        connected: !!conn,
        orgName: conn ? conn.orgName : "",
        orgId: conn ? conn.orgId : "",
        configured: isConfigured(),
        canWrite: canWrite(conn),
        lastSync: conn ? await sync.lastSummary(catalyst, rowList, A) : null,
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* POST /zoho/:provider/sync (Admin): the incremental pull, same as the webhook / cron. */
  app.post("/zoho/:provider/sync", async (req, res) => {
    try {
      assertAdmin(req);
      res.json(await sync.sync(ctx(req), pick(req), { full: false }));
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* POST /zoho/:provider/import {page} (Admin): one page of the one-time full import; the client
     loops until `done`. */
  app.post("/zoho/:provider/import", async (req, res) => {
    try {
      assertAdmin(req);
      const page = Math.max(1, Number((req.body || {}).page) || 1);
      res.json(await sync.sync(ctx(req), pick(req), { full: true, page }));
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* POST /zoho/:provider/push/:rowid (customers:edit): create or update the remote record. */
  app.post("/zoho/:provider/push/:rowid", async (req, res) => {
    try {
      res.json({ ok: true, ...(await sync.push(ctx(req), pick(req), rowidOf(req))) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* DELETE /zoho/:provider/connection (Admin) — revoke + forget. */
  app.delete("/zoho/:provider/connection", async (req, res) => {
    try {
      assertAdmin(req);
      await clearConnection(init(req), rowList, pick(req).name);
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* GET /zoho/:provider/records?q= — first 25 customer records whose name starts with q. */
  app.get("/zoho/:provider/records", async (req, res) => {
    try {
      res.json({ ok: true, records: await pick(req).search(ctx(req), String(req.query.q || "").trim()) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* GET /zoho/:provider/records/:id — the full record plus its Customer mapping (the server owns
     the mapping; the form prefill spreads `mapped` as-is). */
  app.get("/zoho/:provider/records/:id", async (req, res) => {
    try {
      const A = pick(req);
      const c = ctx(req);
      const id = String(req.params.id || "").trim();
      const aux = await A.loadAux(c);
      const record = await A.fetch(c, id, aux);
      res.json({ ok: true, record, mapped: record ? A.toCustomer(record, aux) : null });
    } catch (err) {
      sendErr(res, err);
    }
  });
}
const registerBooks = registerZoho; // name kept for appauth.js callers

module.exports = {
  SCOPE_LOGIN,
  SCOPE_BOOKS,
  SCOPE_CRM,
  SECRET_SETTINGS,
  SETTING_PREFIX,
  ACTIVE_PROVIDER,
  PROVIDERS,
  providerOf,
  isConfigured,
  authUrl,
  exchangeCode,
  userInfo,
  connect,
  connectBooks,
  registerZoho,
  registerBooks,
  apiCall,
  booksCall,
  booksGet,
  getConnection,
  getBooksConnection,
  canWrite,
  canWriteBooks,
  settingRows,
  putSetting,
  httpErr,
};
