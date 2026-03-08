const fs = require("node:fs");
const path = require("node:path");

function copyDirIfExists(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`[copy-standalone] Skip missing dir: ${srcDir}`);
    return;
  }

  fs.mkdirSync(path.dirname(dstDir), { recursive: true });
  fs.cpSync(srcDir, dstDir, { recursive: true, force: true });
  console.log(`[copy-standalone] Copied ${srcDir} -> ${dstDir}`);
}


function extractStandaloneNextConfig(serverJsPath) {
  if (!fs.existsSync(serverJsPath)) {
    throw new Error(`[copy-standalone] Generated server not found: ${serverJsPath}`);
  }

  const content = fs.readFileSync(serverJsPath, "utf8");
  const match = content.match(/const nextConfig = (.+?)\n\nprocess\.env\.__NEXT_PRIVATE_STANDALONE_CONFIG/s);
  if (!match) {
    throw new Error("[copy-standalone] Failed to extract standalone nextConfig");
  }

  return JSON.parse(match[1]);
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

const standaloneServerPath = path.join(dstDir, "server.js");
const nextConfig = extractStandaloneNextConfig(standaloneServerPath);
fs.writeFileSync(
  path.join(dstDir, "standalone-next-config.json"),
  JSON.stringify(nextConfig)
);
fs.copyFileSync(path.resolve(process.cwd(), "server.js"), standaloneServerPath);
console.log(`[copy-standalone] Replaced standalone server -> ${standaloneServerPath}`);

// Make standalone output self-contained for local `node .next/standalone/server.js` runs.
// Next.js standalone requires `.next/static` and `public` to exist next to `server.js`.
copyDirIfExists(
  path.resolve(process.cwd(), ".next", "static"),
  path.resolve(dstDir, ".next", "static")
);
copyDirIfExists(path.resolve(process.cwd(), "public"), path.resolve(dstDir, "public"));
