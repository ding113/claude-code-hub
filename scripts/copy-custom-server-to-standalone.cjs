/**
 * Copy the custom Node server (with WebSocket upgrade support) into the
 * Next.js standalone output, overwriting the generated server.js so Docker
 * runtime (`CMD ["node", "server.js"]`) boots the custom one instead.
 *
 * Also copies the `server-lib/` helper directory it depends on (e.g. the
 * standalone-config injector). Next's traced files only follow imports from
 * the compiled app, not from our custom server entry, so anything server.js
 * `require()`s from outside node_modules must be copied explicitly.
 *
 * The generated standalone server.js is the default Next.js minimal server;
 * ours wraps Next.js programmatically plus adds WebSocket upgrade handling
 * on /v1/responses. See server.js at the repo root for the full rationale.
 */

const fs = require("node:fs");
const path = require("node:path");

const cwd = process.cwd();
const dstDir = path.resolve(cwd, ".next", "standalone");

if (!fs.existsSync(dstDir)) {
  console.warn(
    `[copy-custom-server] Standalone output dir missing at ${dstDir}; skipping (did next build run?)`
  );
  process.exit(0);
}

const serverSrc = path.resolve(cwd, "server.js");
if (!fs.existsSync(serverSrc)) {
  console.error(`[copy-custom-server] Custom server not found at ${serverSrc}`);
  process.exit(1);
}
const serverDst = path.join(dstDir, "server.js");
fs.copyFileSync(serverSrc, serverDst);
console.log(`[copy-custom-server] Copied ${serverSrc} -> ${serverDst}`);

const libSrc = path.resolve(cwd, "server-lib");
if (fs.existsSync(libSrc)) {
  const libDst = path.join(dstDir, "server-lib");
  fs.cpSync(libSrc, libDst, { recursive: true });
  console.log(`[copy-custom-server] Copied ${libSrc} -> ${libDst}`);
} else {
  console.warn(`[copy-custom-server] server-lib/ not found at ${libSrc}; skipping`);
}
