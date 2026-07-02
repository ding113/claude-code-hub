// Helper used by the custom Node server (server.js) to surface the Next.js
// configuration that `next build` baked into `.next/required-server-files.json`.
//
// Why this exists: in standalone mode there is no `next.config.{js,ts,mjs}`
// next to the entrypoint, so Next's `loadConfig()` would fall back to
// defaults and silently drop overrides such as
// `experimental.proxyClientMaxBodySize` (clamping proxied request bodies to
// the 10MB DEFAULT_BODY_CLONE_SIZE_LIMIT in body-streams.js). Next's own
// generated standalone server.js sets the same env var
// (`__NEXT_PRIVATE_STANDALONE_CONFIG`) that `loadConfig()` reads before
// falling back; we mirror that here for our custom server.
//
// Extracted to its own module so it can be unit-tested in isolation —
// requiring server.js would also start the HTTP listener.

"use strict";

const path = require("node:path");
const fs = require("node:fs");

function applyStandaloneNextConfig({ rootDir, env, log } = {}) {
  if (!env || typeof env !== "object") {
    throw new TypeError("applyStandaloneNextConfig requires an env object");
  }
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new TypeError("applyStandaloneNextConfig requires a rootDir string");
  }

  if (env.__NEXT_PRIVATE_STANDALONE_CONFIG) {
    return { applied: false, reason: "preset" };
  }

  const manifestPath = path.join(rootDir, ".next", "required-server-files.json");

  let manifest;
  try {
    // Read the manifest fresh each call so unit tests can swap fixtures via
    // tmp directories without fighting Node's module cache.
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    if (typeof log === "function") {
      log("warn", "standalone_config_load_failed", {
        error: String(err && err.message ? err.message : err),
        manifestPath,
      });
    }
    return { applied: false, reason: "load_error", error: err };
  }

  if (!manifest || typeof manifest !== "object" || !manifest.config) {
    if (typeof log === "function") {
      log("warn", "standalone_config_missing_field", { manifestPath });
    }
    return { applied: false, reason: "missing_config" };
  }

  env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(manifest.config);
  return { applied: true, manifestPath };
}

module.exports = { applyStandaloneNextConfig };
