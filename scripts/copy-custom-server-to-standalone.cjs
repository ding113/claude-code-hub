/**
 * 将支持 WebSocket upgrade 的自定义 Node 服务和资源感知型 cluster 启动器
 * 复制到 Next.js standalone 产物。
 *
 * 同时复制其依赖的 `server-lib/` helper 目录（例如 standalone-config 注入器）。
 * Next 的文件追踪只跟随编译后应用的 import，不会追踪自定义服务入口，因此
 * server.js 从 node_modules 之外 `require()` 的内容必须显式复制。
 *
 * 自动生成的 standalone server.js 是 Next.js 默认最小服务；本项目入口通过
 * 编程方式封装 Next.js，并为 /v1/responses 增加 WebSocket upgrade 处理。
 * 完整设计原因参见仓库根目录的 server.js。
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

const clusterSrc = path.resolve(cwd, "cluster.js");
if (!fs.existsSync(clusterSrc)) {
  console.error(`[copy-custom-server] Cluster launcher not found at ${clusterSrc}`);
  process.exit(1);
}
const clusterDst = path.join(dstDir, "cluster.js");
fs.copyFileSync(clusterSrc, clusterDst);
console.log(`[copy-custom-server] Copied ${clusterSrc} -> ${clusterDst}`);

// server.js 会从 server-lib/ 加载依赖；缺失它会让 standalone 产物启动即崩溃，
// 因此直接令构建失败，而不是只告警。
const libSrc = path.resolve(cwd, "server-lib");
if (!fs.existsSync(libSrc)) {
  console.error(
    `[copy-custom-server] server-lib/ not found at ${libSrc}; refusing to produce a broken standalone artifact`
  );
  process.exit(1);
}
const libDst = path.join(dstDir, "server-lib");
fs.cpSync(libSrc, libDst, { recursive: true });
console.log(`[copy-custom-server] Copied ${libSrc} -> ${libDst}`);
