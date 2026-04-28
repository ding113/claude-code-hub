/**
 * Copy the custom Node server (with WebSocket upgrade support) into the
 * Next.js standalone output, overwriting the generated server.js so Docker
 * runtime (`CMD ["node", "server.js"]`) boots the custom one instead.
 *
 * The generated standalone server.js is the default Next.js minimal server;
 * ours wraps Next.js programmatically plus adds WebSocket upgrade handling
 * on /v1/responses. See server.js at the repo root for the full rationale.
 */

const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(process.cwd(), "server.js");
const dstDir = path.resolve(process.cwd(), ".next", "standalone");
const dst = path.join(dstDir, "server.js");

if (!fs.existsSync(src)) {
  console.error(`[copy-custom-server] Custom server not found at ${src}`);
  process.exit(1);
}

if (!fs.existsSync(dstDir)) {
  console.warn(
    `[copy-custom-server] Standalone output dir missing at ${dstDir}; skipping (did next build run?)`
  );
  process.exit(0);
}

fs.copyFileSync(src, dst);
console.log(`[copy-custom-server] Copied ${src} -> ${dst}`);
