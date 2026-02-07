const fs = require("node:fs");
const path = require("node:path");

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
