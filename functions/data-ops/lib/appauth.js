"use strict";

/**
 * App-level authentication + role permissions for BOFFO.
 *
 * Tables (Data Store):
 *   Role        — name, features (JSON array of nav ids or ["*"]), can_update, can_delete
 *   AppUser     — email (unique), name, password_hash (scrypt$salt$hash), active, role(FK), deleted_at
 *   AuthSession — token (unique), app_user(FK CASCADE), expires_at (IST "yyyy-MM-dd HH:mm:ss")
 *
 * register(app, { init, rowList, sendErr }) wires:
 *   POST /auth/login            {email,password} -> {token,user}
 *   POST /auth/logout           (Bearer) kill session
 *   GET  /auth/me               (Bearer) current user + perms
 *   GET  /auth/roles            (Bearer) role options
 *   GET  /auth/users            (Bearer, Admin) list users
 *   POST /auth/users            (Bearer, Admin) create user {email,name,password,role}
 *   PATCH /auth/users/:rowid    (Bearer, Admin) update {name?,password?,role?,active?}
 * plus a global guard: every other route requires a valid Bearer token;
 * POST/PATCH need role.can_update, DELETE needs role.can_delete.
 */
const crypto = require("crypto");

const SESSION_HOURS = 24 * 7; // 7 days
const CACHE_TTL_MS = 60_000; // token -> user cache per warm instance

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

function publicUser(u, role) {
  return {
    rowid: String(u.ROWID),
    email: u.email,
    name: u.name || u.email,
    role: role ? role.name : null,
    perms: {
      features: role ? parseFeatures(role.features) : [],
      can_update: role ? String(role.can_update) === "true" : false,
      can_delete: role ? String(role.can_delete) === "true" : false,
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
          `SELECT ROWID, name, features, can_update, can_delete FROM Role WHERE ROWID = ${user.role}`,
        ),
      )[0];
    }
    const entry = { user: publicUser(user, role), expiresAtStr: String(sess.expires_at || ""), cachedAt: Date.now() };
    sessionCache.set(token, entry);
    return entry;
  }

  function bearer(req) {
    // Primary: X-App-Token. The Catalyst gateway intercepts `Authorization:
    // Bearer` and validates it as a Zoho OAuth token (401 INVALID_TOKEN before
    // the function runs), so the app token must travel in a custom header.
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

      const perms = entry.user.perms;
      if (req.method === "DELETE" && !perms.can_delete)
        return res.status(403).json({ ok: false, error: "Your role cannot delete records" });
      if ((req.method === "POST" || req.method === "PATCH") && !READONLY_POST.has(path) && !perms.can_update)
        return res.status(403).json({ ok: false, error: "Your role is read-only" });
      return next();
    } catch (err) {
      return sendErr(res, err);
    }
  });

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
            `SELECT ROWID, name, features, can_update, can_delete FROM Role WHERE ROWID = ${user.role}`,
          ),
        )[0];
      }
      const token = crypto.randomBytes(32).toString("hex");
      await catalyst.datastore().table("AuthSession").insertRow({
        token,
        app_user: String(user.ROWID),
        expires_at: istNow(SESSION_HOURS * 3600 * 1000),
      });
      res.json({ ok: true, token, user: publicUser(user, role) });
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
      res.json({ ok: true });
    } catch (err) {
      sendErr(res, err);
    }
  });

  /* ---- GET /auth/me ---- */
  app.get("/auth/me", (req, res) => {
    res.json({ ok: true, user: req.appUser });
  });

  /* ---- GET /auth/roles ---- */
  app.get("/auth/roles", async (req, res) => {
    try {
      const catalyst = init(req);
      const roles = rowList(
        await catalyst.zcql().executeZCQLQuery(`SELECT ROWID, name, can_update, can_delete FROM Role ORDER BY name`),
      );
      res.json({
        ok: true,
        roles: roles.map((r) => ({
          rowid: String(r.ROWID),
          name: r.name,
          can_update: String(r.can_update) === "true",
          can_delete: String(r.can_delete) === "true",
        })),
      });
    } catch (err) {
      sendErr(res, err);
    }
  });

  function assertAdmin(req) {
    const role = req.appUser && req.appUser.role;
    if (!role || String(role).trim().toLowerCase() !== "admin")
      throw httpErr("Admin role required", 403);
  }

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
