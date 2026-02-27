const { spawn } = require("node:child_process");
const path = require("node:path");

function setDefaultEnv(key, value) {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}

setDefaultEnv("NODE_ENV", "development");
setDefaultEnv("CCH_EMBEDDED_DB", "true");
setDefaultEnv("CCH_EMBEDDED_DB_DIR", path.join(process.cwd(), "data", "pglite-demo"));
setDefaultEnv("CCH_DEMO_SEED", "true");
setDefaultEnv("ENABLE_RATE_LIMIT", "false");
setDefaultEnv("ADMIN_TOKEN", "cch-demo-admin");

const port = process.env.DEMO_PORT || "13500";

console.log("[demo] 启动参数:");
console.log(`  - PORT: ${port}`);
console.log(`  - ADMIN_TOKEN: ${process.env.ADMIN_TOKEN}`);
console.log(`  - CCH_EMBEDDED_DB_DIR: ${process.env.CCH_EMBEDDED_DB_DIR}`);
console.log("");
console.log("[demo] 访问地址:");
console.log(`  - 登录页: http://localhost:${port}/zh-CN/login`);
console.log(`  - 仪表盘: http://localhost:${port}/zh-CN/dashboard`);
console.log("");

const nextBin = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev", "--port", port], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
