"use strict";

/**
 * BOFFO — api-health (Advanced I/O Function, Node.js + Express).
 * Phase 0 smoke test of the deploy pipe. Reachable at:
 *   https://<project-domain>/server/api-health/
 *
 * The wildcard GET responds OK for any sub-path and echoes back the path/method
 * Express actually receives — useful for confirming how Catalyst routes Advanced
 * I/O requests (with or without the /server/api-health prefix) during Phase 0.
 */
const express = require("express");

const app = express();

// Same-origin in prod; permissive here so the dev proxy / probes never trip CORS.
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("*", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "api-health",
    time: Date.now(),
    seen_path: req.path,
    method: req.method,
  });
});

module.exports = app;
