"use strict";

/**
 * App-level authentication + role permissions for BOFFO.
 *
 * Tables (Data Store):
 *   Role        — name, matrix (JSON permission matrix, see below), plus legacy
 *                 features/can_update/can_delete kept in sync for display
 *   AppUser     — email (unique), name, password_hash (scrypt$salt$hash), active, role(FK), deleted_at
 *   AuthSession — token (unique), app_user(FK CASCADE), expires_at (IST "yyyy-MM-dd HH:mm:ss")
 *
 * Role.matrix: {"modules":{"quotes":["view","create","edit","delete","export"],...},
 *               "approve":["Quote","SalesOrder"]}
 * A null matrix (legacy role) is synthesized from features/can_update/can_delete.
 * The role named "Admin" is a superuser: bypasses the guard, locked against edits.
 *
 * register(app, { init, rowList, sendErr }) wires:
 *   POST /auth/login            {email,password} -> {token,user}
 *   POST /auth/logout           (Bearer) kill session
 *   GET  /auth/me               (Bearer) current user + perms
 *   GET  /auth/roles            (Bearer) role options incl. matrix + user counts
 *   POST /auth/roles            (Bearer, Admin) create role {name,matrix}
 *   PATCH /auth/roles/:rowid    (Bearer, Admin) update {name?,matrix?} (not Admin)
 *   DELETE /auth/roles/:rowid   (Bearer, Admin) delete unreferenced role (not Admin)
 *   GET  /auth/users            (Bearer, Admin) list users
 *   POST /auth/users            (Bearer, Admin) create user {email,name,password,role}
 *   PATCH /auth/users/:rowid    (Bearer, Admin) update {name?,password?,role?,active?}
 * plus a global guard: every other route requires a valid Bearer token and the
 * matrix permission for its module+action (tables/business routes are mapped
 * below; unmapped routes fall back to the legacy can_update/can_delete rules).
 */
const crypto = require("crypto");

const SESSION_HOURS = 24 * 7; // 7 days
const CACHE_TTL_MS = 60_000; // token -> user cache per warm instance

/* httpOnly session cookie: unreadable by JS (XSS-safe), Secure (https only),
   SameSite=Lax (sent on top-level navigation → opening a link in a new tab
   keeps the session). Path "/" so it rides every /server request same-origin. */
const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_HOURS * 3600 * 1000,
};

/* Catalyst datetime columns hold project-timezone (IST) strings without an
   offset marker; "yyyy-MM-dd HH:mm:ss" strings compare lexicographically. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
function istNow(plusMs = 0) {
  return new Date(Date.now() + IST_OFFSET_MS + plusMs).toISOString().slice(0, 19).replace("T", " ");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const calc = crypto.scryptSync(String(password), parts[1], 64);
  const want = Buffer.from(parts[2], "hex");
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}

function httpErr(msg, code) {
  const e = new Error(msg);
  e.statusCode = code;
  return e;
}

function parseFeatures(text) {
  try {
    const v = JSON.parse(text || "[]");
    return Array.isArray(v) ? v : ["*"];
  } catch {
    return ["*"];
  }
}

/* ---- Permission model ----
   module -> sidebar nav ids (features are derived from the matrix so the
   client's hasFeature()/nav gating keeps working unchanged). */
const MODULE_NAV = {
  quotes: ["quotes"],
  orders: ["byorder", "packing"],
  customers: ["parties"],
  items: ["design", "stock", "sizes", "pallets", "prod"],
  stages: ["po", "qc", "containers", "fit", "loadplan", "loading", "final"],
  invoices: ["invoices"],
  reports: ["reports", "ops"],
  settings: [], // settings pages live behind Admin-only routes, no nav ids
};
const MODULES = Object.keys(MODULE_NAV);
const ACTIONS = ["view", "create", "edit", "delete", "export"];
const APPROVABLES = ["Quote", "SalesOrder"];

/* Datastore table -> module, for the generic CRUD guard. Tables not listed
   (Currency, SalesPerson, Notification, logs, ...) use the legacy fallback. */
const TABLE_MODULE = {
  Quote: "quotes", QuoteItem: "quotes",
  SalesOrder: "orders", OrderItem: "orders", OrderItemEvent: "orders",
  PalletisedBatch: "orders", PalletisedBatchLine: "orders",
  Customer: "customers",
  Design: "items", DesignPallet: "items", Size: "items", Pallet: "items",
  Brand: "items", Grade: "items", Finish: "items", Glaze: "items", Category: "items",
  Container: "stages", ContainerLoading: "stages",
  PalletizationPlan: "stages", PalletizationPlanLine: "stages", LoadBox: "stages",
  Invoice: "invoices",
};

/* GET on a table not in TABLE_MODULE used to be ungated (any authed user could
   read it). Default-deny now applies, with two exceptions:
   - GET_SHARED: cross-cutting lookup/reference tables every screen needs
     regardless of module (names/codes, no sensitive content).
   - ProductionLog / OperationLog: handled specially in the guard below
     (multi-module read for stock/reports; audit trail gated to reports.view). */
const GET_SHARED = new Set([
  "Currency", "SalesPerson", "Notification", "PaymentTerm",
  "PartyBrand", "StatusTransition", "Vehicle", "TransactionSeries",
]);

/* Business route (first path segment) -> [module, action]. Approval verdicts
   are re-checked inside the status handlers via perms.approve. */
const ROUTE_PERM = {
  "quote-with-items": ["quotes", "create"],
  "update-quote-with-items": ["quotes", "edit"],
  "quote-status": ["quotes", "edit"],
  "so-with-items": ["orders", "create"],
  "convert-quote": ["orders", "create"],
  "so-status": ["orders", "edit"],
  "close-pallet": ["stages", "edit"],
  "production-log": ["stages", "edit"],
  "production-record-lines": ["stages", "edit"],
  "opening-stock": ["items", "edit"],
  "load-container": ["stages", "edit"],
  "dispatch": ["stages", "edit"],
  "pal-plan": ["stages", "create"],
  "update-pal-plan": ["stages", "edit"],
  "pal-status": ["stages", "edit"],
  "pal-line-status": ["stages", "edit"],
  "pal-vehicle": ["stages", "edit"],
  "pal-line-box": ["stages", "edit"],
  "load-box": ["stages", "edit"],
  "load-box-share": ["stages", "edit"],
  "load-box-update": ["stages", "edit"],
  "load-box-delete": ["stages", "edit"],
  "load-box-dispatch": ["stages", "edit"],
  "invoice-for-container": ["invoices", "create"],
};

function isAdminName(roleName) {
  return String(roleName || "").trim().toLowerCase() === "admin";
}

/* Parse Role.matrix; a null/invalid matrix is synthesized from the legacy
   features/can_update/can_delete columns so un-migrated roles keep working. */
function roleMatrix(role) {
  if (!role) return { modules: {}, approve: [] };
  if (role.matrix) {
    try {
      const m = JSON.parse(role.matrix);
      if (m && typeof m === "object" && m.modules)
        return { modules: m.modules, approve: Array.isArray(m.approve) ? m.approve : [] };
    } catch {
      /* fall through to synthesis */
    }
  }
  const features = parseFeatures(role.features);
  const all = features.includes("*");
  const up = String(role.can_update) === "true";
  const del = String(role.can_delete) === "true";
  const modules = {};
  for (const mod of MODULES) {
    if (!all && !MODULE_NAV[mod].some((id) => features.includes(id))) continue;
    const acts = ["view", "export"];
    if (up) acts.push("create", "edit");
    if (del) acts.push("delete");
    modules[mod] = acts;
  }
  return { modules, approve: [] };
}

function hasPerm(perms, module, action) {
  const acts = (perms.matrix || {})[module];
  return Array.isArray(acts) && acts.includes(action);
}

function derivedFeatures(matrix) {
  const feats = ["dashboard"];
  for (const [mod, acts] of Object.entries(matrix.modules)) {
    if (Array.isArray(acts) && acts.includes("view")) feats.push(...(MODULE_NAV[mod] || []));
  }
  if (matrix.approve.length) feats.push("approvals");
  return feats;
}

function publicUser(u, role) {
  const roleName = role ? role.name : null;
  const admin = isAdminName(roleName);
  const matrix = roleMatrix(role);
  const anyAct = (a) => Object.values(matrix.modules).some((acts) => Array.isArray(acts) && acts.includes(a));
  return {
    rowid: String(u.ROWID),
    email: u.email,
    name: u.name || u.email,
    role: roleName,
    perms: {
      features: !role ? [] : admin ? ["*"] : derivedFeatures(matrix),
      can_update: admin || anyAct("create") || anyAct("edit"),
      can_delete: admin || anyAct("delete"),
      matrix: matrix.modules,
      approve: admin ? APPROVABLES.slice() : matrix.approve,
    },
  };
}

module.exports.hashPassword = hashPassword;

module.exports.register = function register(app, { init, rowList, sendErr }) {
  const sessionCache = new Map(); // token -> { user, expiresAtStr, cachedAt }

  async function loadSession(catalyst, token) {
    const hit = sessionCache.get(token);
    if (hit && Date.now() - hit.cachedAt < CACHE_TTL_MS) return hit;

    const safe = token.replace(/'/g, "");
    const sess = rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, app_user, expires_at FROM AuthSession WHERE token = '${safe}'`),
    )[0];
    if (!sess || !sess.app_user) return null;
    const user = rowList(
      await catalyst.zcql().executeZCQLQuery(
        `SELECT ROWID, email, name, active, role FROM AppUser WHERE ROWID = ${sess.app_user} AND deleted_at is null`,
      ),
    )[0];
    if (!user || String(user.active) !== "true") return null;
    let role = null;
    if (user.role) {
      role = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, name, features, can_update, can_delete, matrix FROM Role WHERE ROWID = ${user.role}`,
        ),
      )[0];
    }
    const entry = { user: publicUser(user, role), expiresAtStr: String(sess.expires_at || ""), cachedAt: Date.now() };
    sessionCache.set(token, entry);
    return entry;
  }

  // Read the session token from the httpOnly cookie (no cookie-parser dep).
  function cookieToken(req) {
    const m = /(?:^|;\s*)boffo_session=([^;]+)/.exec(req.headers.cookie || "");
    return m ? decodeURIComponent(m[1]).trim() : "";
  }

  function bearer(req) {
    // Preferred: httpOnly `boffo_session` cookie (not readable by JS → XSS-safe).
    // Fallback: X-App-Token header — kept for backward compat during the cookie
    // rollout and as the fallback path if the gateway strips cookies. The
    // Catalyst gateway intercepts `Authorization: Bearer` (validates it as a Zoho
    // OAuth token, 401s before the function runs), so that is last-resort only.
    const cookie = cookieToken(req);
    if (cookie) return cookie;
    const custom = req.headers["x-app-token"];
    if (custom) return String(custom).trim();
    const h = req.headers["authorization"] || "";
    return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  }

  /* ---- Global guard. Registered before all business/CRUD routes. ---- */
  // POST routes that are read-only computations — any authenticated role may call.
  const READONLY_POST = new Set(["/fit-suggest"]);

  app.use(async (req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const path = req.path || req.url;
    if (path === "/" || path === "") return next(); // health probe
    if (path === "/auth/login") return next();

    const token = bearer(req);
    if (!token) return res.status(401).json({ ok: false, error: "Sign in required" });
    try {
      const catalyst = init(req);
      const entry = await loadSession(catalyst, token);
      if (!entry || (entry.expiresAtStr && entry.expiresAtStr < istNow())) {
        sessionCache.delete(token);
        return res.status(401).json({ ok: false, error: "Session expired — sign in again" });
      }
      req.appUser = entry.user;
      req.authToken = token;

      if (path.startsWith("/auth/")) return next(); // auth routes do their own admin checks
      if (isAdminName(entry.user.role)) return next(); // Admin bypasses the matrix

      const perms = entry.user.perms;
      const seg = path.split("/")[1] || "";

      // Business routes with an explicit module+action mapping.
      const biz = ROUTE_PERM[seg];
      if (biz) {
        if (!hasPerm(perms, biz[0], biz[1]))
          return res.status(403).json({ ok: false, error: `Your role cannot ${biz[1]} ${biz[0]}` });
        return next();
      }

      if (READONLY_POST.has(path)) return next();

      // Generic CRUD on a mapped table -> matrix check by HTTP method.
      const module = TABLE_MODULE[seg];
      if (module) {
        const action =
          req.method === "GET" ? "view"
          : req.method === "DELETE" ? "delete"
          : req.method === "PATCH" ? "edit"
          : path.endsWith("/restore") ? "edit"
          : "create";
        if (!hasPerm(perms, module, action))
          return res.status(403).json({ ok: false, error: `Your role cannot ${action} ${module}` });
        return next();
      }

      // Default-deny GET on unmapped tables (previously ungated → any authed
      // user could read audit logs, production, etc). Writes still fall through
      // to the legacy fallback below (unchanged).
      if (req.method === "GET") {
        if (GET_SHARED.has(seg)) return next(); // shared reference lookups
        // ProductionLog feeds item stock + production + reports; allow any of those.
        if (seg === "ProductionLog") {
          if (hasPerm(perms, "items", "view") || hasPerm(perms, "stages", "view") || hasPerm(perms, "reports", "view"))
            return next();
          return res.status(403).json({ ok: false, error: "Your role cannot view this data" });
        }
        // OperationLog is the audit trail (change payloads) — reports.view only.
        if (seg === "OperationLog") {
          if (hasPerm(perms, "reports", "view")) return next();
          return res.status(403).json({ ok: false, error: "Your role cannot view this data" });
        }
        return res.status(403).json({ ok: false, error: "Your role cannot view this data" });
      }

      // Legacy fallback: side tables and unmapped routes keep today's rules (writes).
      if (req.method === "DELETE" && !perms.can_delete)
        return res.status(403).json({ ok: false, error: "Your role cannot delete records" });
      if ((req.method === "POST" || req.method === "PATCH") && !perms.can_update)
        return res.status(403).json({ ok: false, error: "Your role is read-only" });
      return next();
    } catch (err) {
      return sendErr(res, err);
    }
  });

  /* ---- SalesPerson auto-sync ----
     Every AppUser gets a SalesPerson row (linked via app_user) so reps never
     need separate maintenance. Full sync on each successful login: inserts
     missing rows, updates drifted name/email/active. Never touches the
     SalesPerson-only fields (phone/region). Must never fail the login. */
  async function syncSalesPersons(catalyst) {
    try {
      const users = rowList(
        await catalyst.zcql().executeZCQLQuery(
          "SELECT ROWID, email, name, active FROM AppUser WHERE deleted_at is null",
        ),
      );
      const reps = rowList(
        await catalyst.zcql().executeZCQLQuery("SELECT ROWID, name, email, active, app_user FROM SalesPerson"),
      );
      const byUser = new Map(reps.filter((r) => r.app_user).map((r) => [String(r.app_user), r]));
      const names = new Set(reps.map((r) => String(r.name || "").toLowerCase()));
      const ds = catalyst.datastore();
      for (const u of users) {
        const rep = byUser.get(String(u.ROWID));
        const active = String(u.active) === "true";
        const wantName = String(u.name || u.email || "").trim();
        if (!wantName) continue;
        if (!rep) {
          // Name collision with an unlinked rep → fall back to email as name.
          const name = names.has(wantName.toLowerCase()) ? String(u.email) : wantName;
          if (names.has(name.toLowerCase())) continue; // still colliding — leave for manual fix
          await ds.table("SalesPerson").insertRow({ name, email: u.email || "", active, app_user: String(u.ROWID) });
          names.add(name.toLowerCase());
        } else {
          const canRename =
            String(rep.name) !== wantName &&
            (wantName.toLowerCase() === String(rep.name || "").toLowerCase() || !names.has(wantName.toLowerCase()));
          const drifted =
            canRename || String(rep.email || "") !== String(u.email || "") || (String(rep.active) === "true") !== active;
          if (drifted) {
            await ds.table("SalesPerson").updateRow({
              ROWID: rep.ROWID,
              ...(canRename ? { name: wantName } : {}),
              email: u.email || "",
              active,
            });
            if (canRename) names.add(wantName.toLowerCase());
          }
        }
      }
    } catch (e) {
      console.error("SalesPerson sync failed:", e && e.message);
    }
  }

  /* ---- POST /auth/login ---- */
  app.post("/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) throw httpErr("Email and password are required", 400);
      const catalyst = init(req);
      const safe = String(email).toLowerCase().replace(/'/g, "");
      const user = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, email, name, password_hash, active, role FROM AppUser WHERE email = '${safe}' AND deleted_at is null`,
        ),
      )[0];
      if (!user || String(user.active) !== "true" || !verifyPassword(password, user.password_hash))
        throw httpErr("Invalid email or password", 401);

      let role = null;
      if (user.role) {
        role = rowList(
          await catalyst.zcql().executeZCQLQuery(
            `SELECT ROWID, name, features, can_update, can_delete, matrix FROM Role WHERE ROWID = ${user.role}`,
          ),
        )[0];
      }
      const token = crypto.randomBytes(32).toString("hex");
      await catalyst.datastore().table("AuthSession").insertRow({
        token,
        app_user: String(user.ROWID),
        expires_at: istNow(SESSION_HOURS * 3600 * 1000),
      });
      // Deliver the token in an httpOnly cookie (JS can't read it → XSS-safe).
      // `token` stays in the JSON body too during rollout for back-compat.
      res.cookie("boffo_session", token, SESSION_COOKIE_OPTS);
      res.json({ ok: true, token, user: publicUser(user, role) });
      syncSalesPersons(catalyst); // fire-and-forget — reps mirror app users
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- POST /auth/logout ---- */
  app.post("/auth/logout", async (req, res) => {
    try {
      const catalyst = init(req);
      const safe = req.authToken.replace(/'/g, "");
      const sess = rowList(
        await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM AuthSession WHERE token = '${safe}'`),
      )[0];
      if (sess) await catalyst.datastore().table("AuthSession").deleteRow(sess.ROWID);
      sessionCache.delete(req.authToken);
      res.clearCookie("boffo_session", { path: "/" });
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- GET /auth/me ---- */
  app.get("/auth/me", (req, res) => {
    res.json({ ok: true, user: req.appUser });
  });

  function assertAdmin(req) {
    const role = req.appUser && req.appUser.role;
    if (!role || String(role).trim().toLowerCase() !== "admin")
      throw httpErr("Admin role required", 403);
  }

  /* Drop unknown modules/actions/doc-types from a client-supplied matrix. */
  function sanitizeMatrix(input) {
    const src = input && typeof input === "object" ? input : {};
    const srcMods = src.modules && typeof src.modules === "object" ? src.modules : {};
    const modules = {};
    for (const mod of MODULES) {
      const acts = Array.isArray(srcMods[mod]) ? srcMods[mod] : [];
      const clean = ACTIONS.filter((a) => acts.includes(a));
      if (clean.length) modules[mod] = clean;
    }
    const approve = APPROVABLES.filter((d) => Array.isArray(src.approve) && src.approve.includes(d));
    return { modules, approve };
  }

  /* Legacy columns (features/can_update/can_delete) stay in sync with the
     matrix so nothing that still reads them drifts. */
  function legacyColumns(matrix) {
    const anyAct = (a) => Object.values(matrix.modules).some((acts) => acts.includes(a));
    return {
      features: JSON.stringify(derivedFeatures(matrix)),
      can_update: anyAct("create") || anyAct("edit"),
      can_delete: anyAct("delete"),
    };
  }

  async function loadRole(catalyst, rowid) {
    const safe = String(rowid).replace(/\D/g, "");
    return rowList(
      await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, name FROM Role WHERE ROWID = ${safe}`),
    )[0];
  }

  /* ---- GET /auth/roles ---- */
  app.get("/auth/roles", async (req, res) => {
    try {
      const catalyst = init(req);
      const roles = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, name, features, can_update, can_delete, matrix FROM Role ORDER BY name`,
        ),
      );
      const users = rowList(
        await catalyst.zcql().executeZCQLQuery(`SELECT role FROM AppUser WHERE deleted_at is null`),
      );
      const counts = new Map();
      for (const u of users) {
        if (u.role) counts.set(String(u.role), (counts.get(String(u.role)) || 0) + 1);
      }
      res.json({
        ok: true,
        roles: roles.map((r) => {
          const m = roleMatrix(r);
          return {
            rowid: String(r.ROWID),
            name: r.name,
            can_update: String(r.can_update) === "true",
            can_delete: String(r.can_delete) === "true",
            matrix: m.modules,
            approve: m.approve,
            users: counts.get(String(r.ROWID)) || 0,
            locked: isAdminName(r.name),
          };
        }),
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- POST /auth/roles (Admin) ---- */
  app.post("/auth/roles", async (req, res) => {
    try {
      assertAdmin(req);
      const name = String((req.body || {}).name || "").trim();
      if (!name) throw httpErr("Role name is required", 400);
      if (isAdminName(name)) throw httpErr('"Admin" is reserved', 400);
      const catalyst = init(req);
      const safe = name.replace(/'/g, "");
      const dup = rowList(
        await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Role WHERE name = '${safe}'`),
      )[0];
      if (dup) throw httpErr(`Role already exists: ${name}`, 409);
      const matrix = sanitizeMatrix((req.body || {}).matrix);
      const row = await catalyst.datastore().table("Role").insertRow({
        name,
        matrix: JSON.stringify(matrix),
        ...legacyColumns(matrix),
      });
      res.json({ ok: true, rowid: String(row.ROWID) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- PATCH /auth/roles/:rowid (Admin) ---- */
  app.patch("/auth/roles/:rowid", async (req, res) => {
    try {
      assertAdmin(req);
      const catalyst = init(req);
      const role = await loadRole(catalyst, req.params.rowid);
      if (!role) throw httpErr("Role not found", 404);
      if (isAdminName(role.name)) throw httpErr("The Admin role cannot be modified", 403);

      const patch = { ROWID: role.ROWID };
      const body = req.body || {};
      if (body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (!name) throw httpErr("Role name is required", 400);
        if (isAdminName(name)) throw httpErr('"Admin" is reserved', 400);
        const safe = name.replace(/'/g, "");
        const dup = rowList(
          await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM Role WHERE name = '${safe}'`),
        )[0];
        if (dup && String(dup.ROWID) !== String(role.ROWID)) throw httpErr(`Role already exists: ${name}`, 409);
        patch.name = name;
      }
      if (body.matrix !== undefined) {
        const matrix = sanitizeMatrix(body.matrix);
        patch.matrix = JSON.stringify(matrix);
        Object.assign(patch, legacyColumns(matrix));
      }
      await catalyst.datastore().table("Role").updateRow(patch);
      sessionCache.clear(); // perms take effect on next request
      res.json({ ok: true, rowid: String(role.ROWID) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- DELETE /auth/roles/:rowid (Admin) ---- */
  app.delete("/auth/roles/:rowid", async (req, res) => {
    try {
      assertAdmin(req);
      const catalyst = init(req);
      const role = await loadRole(catalyst, req.params.rowid);
      if (!role) throw httpErr("Role not found", 404);
      if (isAdminName(role.name)) throw httpErr("The Admin role cannot be deleted", 403);
      const assigned = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID FROM AppUser WHERE role = ${role.ROWID} AND deleted_at is null`,
        ),
      );
      if (assigned.length)
        throw httpErr(`Role is assigned to ${assigned.length} user(s) — reassign them first`, 409);
      await catalyst.datastore().table("Role").deleteRow(role.ROWID);
      sessionCache.clear();
      res.json({ ok: true, rowid: String(role.ROWID) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- GET /auth/users (Admin) ---- */
  app.get("/auth/users", async (req, res) => {
    try {
      assertAdmin(req);
      const catalyst = init(req);
      const users = rowList(
        await catalyst.zcql().executeZCQLQuery(
          `SELECT ROWID, email, name, active, role, CREATEDTIME, MODIFIEDTIME FROM AppUser WHERE deleted_at is null ORDER BY email`,
        ),
      );
      const roles = rowList(await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, name FROM Role`));
      const roleName = new Map(roles.map((r) => [String(r.ROWID), r.name]));
      res.json({
        ok: true,
        users: users.map((u) => ({
          rowid: String(u.ROWID),
          email: u.email,
          name: u.name || "",
          active: String(u.active) === "true",
          role: u.role ? String(u.role) : null,
          roleName: u.role ? roleName.get(String(u.role)) || "" : "",
          createdTime: u.CREATEDTIME ? String(u.CREATEDTIME) : "",
          modifiedTime: u.MODIFIEDTIME ? String(u.MODIFIEDTIME) : "",
        })),
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- POST /auth/users (Admin) ---- */
  app.post("/auth/users", async (req, res) => {
    try {
      assertAdmin(req);
      const { email, name, password, role } = req.body || {};
      if (!email || !password) throw httpErr("email and password are required", 400);
      if (String(password).length < 6) throw httpErr("Password must be at least 6 characters", 400);
      const catalyst = init(req);
      const safe = String(email).toLowerCase().trim().replace(/'/g, "");
      const dup = rowList(
        await catalyst.zcql().executeZCQLQuery(`SELECT ROWID FROM AppUser WHERE email = '${safe}'`),
      )[0];
      if (dup) throw httpErr(`User already exists: ${safe}`, 409);
      const row = await catalyst.datastore().table("AppUser").insertRow({
        email: safe,
        name: name || "",
        password_hash: hashPassword(password),
        active: true,
        ...(role ? { role: String(role) } : {}),
      });
      res.json({ ok: true, rowid: String(row.ROWID) });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- PATCH /auth/users/:rowid (Admin) ---- */
  app.patch("/auth/users/:rowid", async (req, res) => {
    try {
      assertAdmin(req);
      const { name, password, role, active } = req.body || {};
      const patch = { ROWID: req.params.rowid };
      if (name != null) patch.name = name;
      if (password) {
        if (String(password).length < 6) throw httpErr("Password must be at least 6 characters", 400);
        patch.password_hash = hashPassword(password);
      }
      if (role !== undefined) patch.role = role ? String(role) : null;
      if (active !== undefined) patch.active = !!active;
      const catalyst = init(req);
      await catalyst.datastore().table("AppUser").updateRow(patch);
      sessionCache.clear(); // role/active changes take effect on next request
      res.json({ ok: true, rowid: String(req.params.rowid) });
    } catch (err) {
      sendErr(res, err);
    }
  });
};
