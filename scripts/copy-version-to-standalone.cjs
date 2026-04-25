const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function copyDirIfExists(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[copy-standalone] Skip missing dir: ${srcDir}`);
    return;
  }

  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  fs.cpSync(srcDir, dstDir, { recursive: true, force: true });
  console.log(`[copy-standalone] Copied ${srcDir} -> ${dstDir}`);
}

const src = path.resolve(process.cwd(), "VERSION");
const dstDir = path.resolve(process.cwd(), ".next", "standalone");
const dst = path.join(dstDir, "VERSION");

if (!fs.existsSync(src)) {
  console.error(`[copy-version] VERSION not found at ${src}`);
  process.exit(1);
}

fs.mkdirSync(dstDir, { recursive: true });
fs.copyFileSync(src, dst);
console.log(`[copy-version] Copied VERSION -> ${dst}`);

// Make standalone output self-contained for local `node .next/standalone/server.js` runs.
// Next.js standalone requires `.next/static` and `public` to exist next to `server.js`.
copyDirIfExists(
  path.resolve(process.cwd(), ".next", "static"),
  path.resolve(dstDir, ".next", "static")
);
copyDirIfExists(path.resolve(process.cwd(), "public"), path.resolve(dstDir, "public"));

const generatedServer = path.resolve(dstDir, "server.js");
const nextServer = path.resolve(dstDir, "next-server.js");
const wrapperSource = path.resolve(process.cwd(), "scripts", "responses-websocket-standalone-server.ts");

if (!fs.existsSync(generatedServer)) {
  console.error(`[responses-ws-standalone] Next standalone server not found at ${generatedServer}`);
  process.exit(1);
}

fs.copyFileSync(generatedServer, nextServer);
console.log(`[responses-ws-standalone] Copied ${generatedServer} -> ${nextServer}`);

const buildWrapper = spawnSync(
  "bun",
  [
    "build",
    wrapperSource,
    "--target=node",
    "--format=cjs",
    "--conditions=react-server",
    `--outfile=${generatedServer}`,
  ],
  { encoding: "utf8" }
);

if (buildWrapper.stdout) process.stdout.write(buildWrapper.stdout);
if (buildWrapper.stderr) process.stderr.write(buildWrapper.stderr);

if (buildWrapper.status !== 0) {
  console.error("[responses-ws-standalone] Failed to build standalone WebSocket wrapper");
  process.exit(buildWrapper.status ?? 1);
}

console.log(`[responses-ws-standalone] Installed WebSocket wrapper at ${generatedServer}`);
