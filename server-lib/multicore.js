"use strict";

const fs = require("node:fs");
const os = require("node:os");

const MIB = 1024 * 1024;
const WORKER_READY_MESSAGE_TYPE = "cch:gateway-ready";
const DEFAULT_AUTO_MAX_WORKERS = 4;
const MAX_EXPLICIT_WORKERS = 32;
const DEFAULT_MEMORY_PER_WORKER_MB = 1024;
const DEFAULT_PRIMARY_MEMORY_RESERVE_MB = 256;

const CGROUP_FILES = Object.freeze({
  cpuMaxV2: "/sys/fs/cgroup/cpu.max",
  cpuQuotaV1: "/sys/fs/cgroup/cpu/cpu.cfs_quota_us",
  cpuPeriodV1: "/sys/fs/cgroup/cpu/cpu.cfs_period_us",
  cpuQuotaV1Combined: "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_quota_us",
  cpuPeriodV1Combined: "/sys/fs/cgroup/cpu,cpuacct/cpu.cfs_period_us",
  cpuQuotaV1Root: "/sys/fs/cgroup/cpu.cfs_quota_us",
  cpuPeriodV1Root: "/sys/fs/cgroup/cpu.cfs_period_us",
  cpusetV2: "/sys/fs/cgroup/cpuset.cpus.effective",
  cpusetV1: "/sys/fs/cgroup/cpuset/cpuset.cpus",
  cpusetV1Root: "/sys/fs/cgroup/cpuset.cpus",
  memoryMaxV2: "/sys/fs/cgroup/memory.max",
  memoryLimitV1: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
  memoryLimitV1Root: "/sys/fs/cgroup/memory.limit_in_bytes",
});

function readTextFile(readFileSync, filePath) {
  try {
    return String(readFileSync(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

function parseCpuMax(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const [quotaRaw, periodRaw] = raw.trim().split(/\s+/);
  if (quotaRaw === "max") return Number.POSITIVE_INFINITY;
  const quota = Number(quotaRaw);
  const period = Number(periodRaw);
  if (!Number.isFinite(quota) || quota <= 0 || !Number.isFinite(period) || period <= 0) {
    return null;
  }
  return quota / period;
}

function parseCpuSet(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  const ranges = [];
  for (const item of raw.split(",")) {
    const token = item.trim();
    if (!token) return null;
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    ranges.push([start, end]);
  }

  ranges.sort((left, right) => left[0] - right[0]);
  let count = 0;
  let currentStart = ranges[0][0];
  let currentEnd = ranges[0][1];
  for (let index = 1; index < ranges.length; index += 1) {
    const [start, end] = ranges[index];
    if (start <= currentEnd + 1) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }
    count += currentEnd - currentStart + 1;
    currentStart = start;
    currentEnd = end;
  }
  count += currentEnd - currentStart + 1;
  return count > 0 ? count : null;
}

function parseMemoryLimit(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.trim() === "max") return Number.POSITIVE_INFINITY;
  if (!/^\d+$/.test(raw.trim())) return null;
  const bytes = Number(raw.trim());
  return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

function detectRuntimeResources(options = {}) {
  const osModule = options.osModule || os;
  const readFileSync = options.readFileSync || fs.readFileSync;

  let availableCpu;
  try {
    availableCpu = Number(osModule.availableParallelism?.());
  } catch {
    availableCpu = Number.NaN;
  }
  if (!Number.isFinite(availableCpu) || availableCpu < 1) {
    try {
      availableCpu = osModule.cpus().length;
    } catch {
      availableCpu = 1;
    }
  }
  availableCpu = Math.max(1, Math.floor(availableCpu));

  const cpuMaxV2Raw = readTextFile(readFileSync, CGROUP_FILES.cpuMaxV2);
  let cpuQuota = parseCpuMax(cpuMaxV2Raw);
  if (cpuQuota === null) {
    const v1CpuPaths = [
      [CGROUP_FILES.cpuQuotaV1, CGROUP_FILES.cpuPeriodV1],
      [CGROUP_FILES.cpuQuotaV1Combined, CGROUP_FILES.cpuPeriodV1Combined],
      [CGROUP_FILES.cpuQuotaV1Root, CGROUP_FILES.cpuPeriodV1Root],
    ];
    for (const [quotaPath, periodPath] of v1CpuPaths) {
      const quota = Number(readTextFile(readFileSync, quotaPath));
      const period = Number(readTextFile(readFileSync, periodPath));
      if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
        cpuQuota = quota / period;
        break;
      }
    }
  }

  const cpusetRaw =
    readTextFile(readFileSync, CGROUP_FILES.cpusetV2) ||
    readTextFile(readFileSync, CGROUP_FILES.cpusetV1) ||
    readTextFile(readFileSync, CGROUP_FILES.cpusetV1Root);
  const cpusetCpu = parseCpuSet(cpusetRaw);

  const cpuCandidates = [availableCpu];
  if (Number.isFinite(cpuQuota)) cpuCandidates.push(cpuQuota);
  if (Number.isFinite(cpusetCpu)) cpuCandidates.push(cpusetCpu);
  const effectiveCpu = Math.max(1, Math.floor(Math.min(...cpuCandidates)));

  let hostMemoryBytes;
  try {
    hostMemoryBytes = Number(osModule.totalmem());
  } catch {
    hostMemoryBytes = Number.MAX_SAFE_INTEGER;
  }
  if (!Number.isFinite(hostMemoryBytes) || hostMemoryBytes <= 0) {
    hostMemoryBytes = Number.MAX_SAFE_INTEGER;
  }

  const memoryMaxV2Raw = readTextFile(readFileSync, CGROUP_FILES.memoryMaxV2);
  let cgroupMemoryBytes = parseMemoryLimit(memoryMaxV2Raw);
  if (cgroupMemoryBytes === null) {
    cgroupMemoryBytes = parseMemoryLimit(
      readTextFile(readFileSync, CGROUP_FILES.memoryLimitV1)
    );
  }
  if (cgroupMemoryBytes === null) {
    cgroupMemoryBytes = parseMemoryLimit(
      readTextFile(readFileSync, CGROUP_FILES.memoryLimitV1Root)
    );
  }
  const finiteCgroupMemoryBytes = Number.isFinite(cgroupMemoryBytes)
    ? cgroupMemoryBytes
    : null;
  const effectiveMemoryBytes = Math.floor(
    Math.min(hostMemoryBytes, finiteCgroupMemoryBytes ?? hostMemoryBytes)
  );

  return {
    availableCpu,
    cpuQuota: Number.isFinite(cpuQuota) ? cpuQuota : null,
    cpusetCpu,
    effectiveCpu,
    hostMemoryBytes: Math.floor(hostMemoryBytes),
    cgroupMemoryBytes: finiteCgroupMemoryBytes,
    effectiveMemoryBytes,
  };
}

function parseOptionalInteger(env, name, constraints = {}) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const normalized = String(raw).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be an integer`);
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} is outside the safe integer range`);
  if (constraints.min !== undefined && value < constraints.min) {
    throw new Error(`${name} must be at least ${constraints.min}`);
  }
  if (constraints.max !== undefined && value > constraints.max) {
    throw new Error(`${name} must be at most ${constraints.max}`);
  }
  return value;
}

function parseIntegerWithDefault(env, name, defaultValue, constraints = {}) {
  return parseOptionalInteger(env, name, constraints) ?? defaultValue;
}

function parseMulticoreMode(raw) {
  const normalized = String(raw ?? "auto")
    .trim()
    .toLowerCase();
  if (normalized === "auto") return "auto";
  if (["on", "true", "enabled"].includes(normalized)) return "on";
  if (["off", "false", "disabled"].includes(normalized)) return "off";
  throw new Error("CCH_MULTICORE_MODE must be one of auto, on, or off");
}

function hasCrossProcessInvalidation(env) {
  const redisUrl = String(env.REDIS_URL ?? "").trim();
  const rateLimitMode = String(env.ENABLE_RATE_LIMIT ?? "true")
    .trim()
    .toLowerCase();
  return redisUrl.length > 0 && rateLimitMode !== "false" && rateLimitMode !== "0";
}

function assertCrossProcessInvalidation(env) {
  if (hasCrossProcessInvalidation(env)) return;
  throw new Error(
    "Multicore gateway workers require REDIS_URL and ENABLE_RATE_LIMIT must not be false, " +
      "so process-local security and routing caches can be invalidated across workers"
  );
}

function allocateIntegerBudget(total, workerCount) {
  if (!Number.isSafeInteger(total) || total < 0) throw new TypeError("total must be an integer");
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
    throw new TypeError("workerCount must be a positive integer");
  }
  const base = Math.floor(total / workerCount);
  const remainder = total % workerCount;
  return Array.from({ length: workerCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

function resolveAggregateBudgets(env) {
  const production = env.NODE_ENV === "production";
  const streamGatePerRequestBytes = parseIntegerWithDefault(
    env,
    "STREAM_GATE_PREBUFFER_BYTE_CAP",
    10 * MIB,
    { min: 1024, max: 64 * MIB }
  );

  const definitions = [
    {
      name: "DB_POOL_MAX",
      defaultValue: production ? 20 : 10,
      minPerWorker: 1,
      max: 200,
    },
    {
      name: "MESSAGE_REQUEST_ASYNC_MAX_PENDING",
      defaultValue: 5000,
      minPerWorker: 100,
      max: 200000,
    },
    {
      name: "DETACHED_STREAM_MAX_CONCURRENCY",
      defaultValue: 64,
      minPerWorker: 1,
      max: 4096,
    },
    {
      name: "DETACHED_STREAM_BUDGET_BYTES",
      defaultValue: 64 * MIB,
      minPerWorker: 3 * MIB + 64 * 1024,
      max: 1024 * MIB,
    },
    {
      name: "DETACHED_STREAM_METERING_RESERVE_BYTES",
      defaultValue: 16 * MIB,
      minPerWorker: 64 * 1024,
      max: 1024 * MIB,
    },
    {
      name: "STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP",
      defaultValue: 256 * MIB,
      minPerWorker: streamGatePerRequestBytes * 4,
      max: 2 * 1024 * MIB,
    },
    {
      name: "REPLAY_MAX_CONCURRENT_SPOOLS",
      defaultValue: 64,
      minPerWorker: 1,
      max: 1024,
    },
  ];

  const totals = {};
  for (const definition of definitions) {
    totals[definition.name] = parseIntegerWithDefault(
      env,
      definition.name,
      definition.defaultValue,
      { min: definition.minPerWorker, max: definition.max }
    );
  }

  if (
    totals.DETACHED_STREAM_METERING_RESERVE_BYTES > totals.DETACHED_STREAM_BUDGET_BYTES
  ) {
    throw new Error(
      "DETACHED_STREAM_METERING_RESERVE_BYTES cannot exceed DETACHED_STREAM_BUDGET_BYTES"
    );
  }

  return { definitions, totals, streamGatePerRequestBytes };
}

function buildBudgetAllocations(resolvedBudgets, workerCount) {
  const allocations = {};
  for (const definition of resolvedBudgets.definitions) {
    const total = resolvedBudgets.totals[definition.name];
    const values = allocateIntegerBudget(total, workerCount);
    if (values.some((value) => value < definition.minPerWorker)) {
      throw new Error(
        `${definition.name}=${total} cannot safely support ${workerCount} gateway workers`
      );
    }
    allocations[definition.name] = values;
  }

  const detachedBudgets = allocations.DETACHED_STREAM_BUDGET_BYTES;
  const detachedReserves = allocations.DETACHED_STREAM_METERING_RESERVE_BYTES;
  for (let index = 0; index < workerCount; index += 1) {
    if (detachedReserves[index] > detachedBudgets[index]) {
      throw new Error(
        `Detached stream reserve exceeds its worker budget at worker index ${index}`
      );
    }
  }

  return allocations;
}

function calculateBudgetCapacity(resolvedBudgets) {
  return Math.min(
    ...resolvedBudgets.definitions.map((definition) =>
      Math.floor(resolvedBudgets.totals[definition.name] / definition.minPerWorker)
    )
  );
}

function createDisabledPlan({ mode, reason, resources, explicitWorkers }) {
  return {
    enabled: false,
    mode,
    reason,
    workerCount: 1,
    explicitWorkers: explicitWorkers ?? null,
    resources,
    aggregateBudgets: null,
    budgetAllocations: null,
  };
}

function createMulticorePlan(options = {}) {
  const env = options.env || process.env;
  const resources = options.resources || detectRuntimeResources(options.resourceOptions);
  const mode = parseMulticoreMode(env.CCH_MULTICORE_MODE);
  if (mode === "off") {
    // 关闭模式也是紧急回滚入口，应忽略残留的 worker 数配置。
    return createDisabledPlan({ mode, reason: "mode_off", resources });
  }
  const explicitWorkers = parseOptionalInteger(env, "CCH_MULTICORE_WORKERS", {
    min: 1,
    max: MAX_EXPLICIT_WORKERS,
  });

  if (explicitWorkers === 1) {
    return createDisabledPlan({
      mode,
      reason: "explicit_single_worker",
      resources,
      explicitWorkers,
    });
  }
  if (env.NODE_ENV !== "production" && (mode === "on" || explicitWorkers !== undefined)) {
    throw new Error("Multicore gateway workers require NODE_ENV=production");
  }

  const memoryPerWorkerMb = parseIntegerWithDefault(
    env,
    "CCH_MULTICORE_MEMORY_PER_WORKER_MB",
    DEFAULT_MEMORY_PER_WORKER_MB,
    { min: 256, max: 65536 }
  );
  const primaryMemoryReserveMb = parseIntegerWithDefault(
    env,
    "CCH_MULTICORE_PRIMARY_MEMORY_RESERVE_MB",
    DEFAULT_PRIMARY_MEMORY_RESERVE_MB,
    { min: 64, max: 16384 }
  );
  const memoryPerWorkerBytes = memoryPerWorkerMb * MIB;
  const primaryMemoryReserveBytes = primaryMemoryReserveMb * MIB;
  const memoryCapacity = Math.max(
    0,
    Math.floor(
      (resources.effectiveMemoryBytes - primaryMemoryReserveBytes) / memoryPerWorkerBytes
    )
  );

  const resolvedBudgets = resolveAggregateBudgets(env);
  const budgetCapacity = calculateBudgetCapacity(resolvedBudgets);
  const safeCapacity = Math.min(memoryCapacity, budgetCapacity, MAX_EXPLICIT_WORKERS);

  let workerCount;
  let reason;
  if (explicitWorkers !== undefined) {
    assertCrossProcessInvalidation(env);
    workerCount = explicitWorkers;
    reason = "explicit_worker_count";
    if (workerCount > safeCapacity) {
      throw new Error(
        `CCH_MULTICORE_WORKERS=${workerCount} exceeds the safe memory/budget capacity ${safeCapacity}`
      );
    }
  } else if (mode === "on") {
    assertCrossProcessInvalidation(env);
    workerCount = Math.min(
      Math.max(2, Math.floor(resources.effectiveCpu / 2)),
      DEFAULT_AUTO_MAX_WORKERS,
      safeCapacity
    );
    reason = "mode_on";
    if (workerCount < 2) {
      throw new Error(
        "CCH_MULTICORE_MODE=on requires capacity for at least two gateway workers"
      );
    }
  } else {
    if (env.NODE_ENV !== "production") {
      return createDisabledPlan({
        mode,
        reason: "non_production",
        resources,
        explicitWorkers,
      });
    }
    if (String(env.CI ?? "").toLowerCase() === "true") {
      return createDisabledPlan({ mode, reason: "ci", resources, explicitWorkers });
    }
    if (resources.effectiveCpu < 4) {
      return createDisabledPlan({
        mode,
        reason: "effective_cpu_below_four",
        resources,
        explicitWorkers,
      });
    }
    if (!hasCrossProcessInvalidation(env)) {
      return createDisabledPlan({
        mode,
        reason: "cross_process_invalidation_unavailable",
        resources,
        explicitWorkers,
      });
    }

    workerCount = Math.min(
      Math.floor(resources.effectiveCpu / 2),
      DEFAULT_AUTO_MAX_WORKERS,
      safeCapacity
    );
    reason = "auto_resource_eligible";
    if (workerCount < 2) {
      return createDisabledPlan({
        mode,
        reason: memoryCapacity < 2 ? "insufficient_memory" : "insufficient_shared_budget",
        resources,
        explicitWorkers,
      });
    }
  }

  const budgetAllocations = buildBudgetAllocations(resolvedBudgets, workerCount);
  return {
    enabled: true,
    mode,
    reason,
    workerCount,
    explicitWorkers: explicitWorkers ?? null,
    resources,
    memoryPerWorkerBytes,
    primaryMemoryReserveBytes,
    memoryCapacity,
    budgetCapacity,
    aggregateBudgets: resolvedBudgets.totals,
    budgetAllocations,
  };
}

function buildWorkerEnvironment(plan, workerIndex) {
  if (!plan?.enabled) throw new TypeError("An enabled multicore plan is required");
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= plan.workerCount) {
    throw new RangeError("workerIndex is outside the multicore plan");
  }

  const workerEnv = {
    CCH_MULTICORE_ACTIVE: "1",
    CCH_MULTICORE_WORKER_INDEX: String(workerIndex),
    CCH_MULTICORE_WORKER_COUNT: String(plan.workerCount),
    CCH_MULTICORE_BACKGROUND_OWNER: workerIndex === 0 ? "1" : "0",
    CCH_PROCESS_ROLE: workerIndex === 0 ? "gateway-control" : "gateway",
    CCH_MULTICORE_EFFECTIVE_VCPUS: String(plan.resources.effectiveCpu),
    CCH_MULTICORE_EFFECTIVE_MEMORY_BYTES: String(plan.resources.effectiveMemoryBytes),
  };

  for (const [name, allocations] of Object.entries(plan.budgetAllocations)) {
    workerEnv[name] = String(allocations[workerIndex]);
  }
  return workerEnv;
}

module.exports = {
  CGROUP_FILES,
  DEFAULT_AUTO_MAX_WORKERS,
  DEFAULT_MEMORY_PER_WORKER_MB,
  DEFAULT_PRIMARY_MEMORY_RESERVE_MB,
  MIB,
  WORKER_READY_MESSAGE_TYPE,
  allocateIntegerBudget,
  buildBudgetAllocations,
  buildWorkerEnvironment,
  createMulticorePlan,
  detectRuntimeResources,
  hasCrossProcessInvalidation,
  parseCpuMax,
  parseCpuSet,
  parseMemoryLimit,
  parseMulticoreMode,
  resolveAggregateBudgets,
};
