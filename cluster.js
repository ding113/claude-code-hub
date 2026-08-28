// claude-code-hub 的资源感知型生产启动器。
//
// 每个 cluster worker 独占完整的请求生命周期。主进程只分发已接受的 socket
// 句柄，绝不传递请求正文或解析后的对象图，避免大请求跨越 IPC 序列化边界。

"use strict";

const cluster = require("node:cluster");
const path = require("node:path");
const { createClusterSupervisor } = require("./server-lib/cluster-supervisor");
const {
  createMulticorePlan,
  detectRuntimeResources,
  hasCrossProcessInvalidation,
} = require("./server-lib/multicore");

function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, msg, ...(extra || {}) };
  try {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch {
    // 日志写入失败不应影响启动监督。
  }
}

function loadLauncherEnvironment() {
  try {
    // worker 数必须在 Next 启动前确定。复用 Next 的 .env 加载语义，确保
    // `bun run start` 与容器注入环境变量时行为一致。
    const { loadEnvConfig } = require("@next/env");
    loadEnvConfig(__dirname, process.env.NODE_ENV !== "production");
  } catch (error) {
    log("warn", "multicore_env_load_failed", {
      error: String(error?.message || error),
    });
  }
}

async function main() {
  if (!cluster.isPrimary) {
    throw new Error("cluster.js must only run as the primary process");
  }

  loadLauncherEnvironment();
  const resources = detectRuntimeResources();
  const plan = createMulticorePlan({ env: process.env, resources });
  log("info", "multicore_plan_resolved", {
    enabled: plan.enabled,
    mode: plan.mode,
    reason: plan.reason,
    workerCount: plan.workerCount,
    effectiveVcpus: resources.effectiveCpu,
    cpuQuota: resources.cpuQuota,
    cpusetVcpus: resources.cpusetCpu,
    crossProcessInvalidation: hasCrossProcessInvalidation(process.env),
    effectiveMemoryMiB: Math.floor(resources.effectiveMemoryBytes / (1024 * 1024)),
    memoryPerWorkerMiB: plan.memoryPerWorkerBytes
      ? Math.floor(plan.memoryPerWorkerBytes / (1024 * 1024))
      : null,
  });

  if (!plan.enabled) {
    const { main: startServer } = require("./server");
    await startServer();
    return;
  }

  // 轮询调度比任由少数 keep-alive listener 获得大部分连接更均衡。Windows
  // 保留原生策略；生产容器运行于 Linux，因此使用 SCHED_RR。
  cluster.schedulingPolicy = process.platform === "win32" ? cluster.SCHED_NONE : cluster.SCHED_RR;
  cluster.setupPrimary({
    exec: path.join(__dirname, "server.js"),
    execArgv: process.execArgv,
  });

  createClusterSupervisor({
    clusterModule: cluster,
    plan,
    processRef: process,
    env: process.env,
    log,
  }).start();
}

module.exports = { loadLauncherEnvironment, main };

if (require.main === module) {
  main().catch((error) => {
    log("error", "multicore_bootstrap_failed", {
      error: String(error?.stack || error),
    });
    process.exit(1);
  });
}
