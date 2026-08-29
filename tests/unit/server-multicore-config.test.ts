import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);
const multicore = requireFromHere("../../server-lib/multicore.js") as {
  CGROUP_FILES: Record<string, string>;
  MIB: number;
  allocateIntegerBudget: (total: number, workers: number) => number[];
  buildWorkerEnvironment: (plan: MulticorePlan, workerIndex: number) => Record<string, string>;
  createMulticorePlan: (options: {
    env: Record<string, string | undefined>;
    resources: RuntimeResources;
  }) => MulticorePlan;
  detectRuntimeResources: (options: {
    osModule: {
      availableParallelism?: () => number;
      cpus: () => unknown[];
      totalmem: () => number;
    };
    readFileSync: (path: string) => string;
  }) => RuntimeResources;
  parseCpuMax: (raw: string) => number | null;
  parseCpuSet: (raw: string) => number | null;
  parseMemoryLimit: (raw: string) => number | null;
  hasCrossProcessInvalidation: (env: Record<string, string | undefined>) => boolean;
};
const launcher = requireFromHere("../../cluster.js") as {
  normalizeStandaloneEnvironment: (
    env: Record<string, string | undefined>
  ) => Record<string, string | undefined>;
};

type RuntimeResources = {
  availableCpu: number;
  cpuQuota: number | null;
  cpusetCpu: number | null;
  effectiveCpu: number;
  hostMemoryBytes: number;
  cgroupMemoryBytes: number | null;
  effectiveMemoryBytes: number;
};

type MulticorePlan = {
  enabled: boolean;
  mode: string;
  reason: string;
  workerCount: number;
  resources: RuntimeResources;
  aggregateBudgets: Record<string, number> | null;
  budgetAllocations: Record<string, number[]> | null;
};

const MIB = 1024 * 1024;

function resources(cpu: number, memoryMiB = 8192): RuntimeResources {
  return {
    availableCpu: cpu,
    cpuQuota: null,
    cpusetCpu: null,
    effectiveCpu: cpu,
    hostMemoryBytes: memoryMiB * MIB,
    cgroupMemoryBytes: memoryMiB * MIB,
    effectiveMemoryBytes: memoryMiB * MIB,
  };
}

function productionEnv(override: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    ENABLE_RATE_LIMIT: "true",
    REDIS_URL: "redis://redis:6379",
    ...override,
  };
}

describe("multicore resource detection", () => {
  it("uses the strictest availableParallelism, cgroup quota, cpuset and memory limits", () => {
    const files = new Map<string, string>([
      [multicore.CGROUP_FILES.cpuMaxV2, "350000 100000"],
      [multicore.CGROUP_FILES.cpusetV2, "0-2,4-6"],
      [multicore.CGROUP_FILES.memoryMaxV2, String(4096 * MIB)],
    ]);

    const detected = multicore.detectRuntimeResources({
      osModule: {
        availableParallelism: () => 8,
        cpus: () => Array.from({ length: 16 }),
        totalmem: () => 16 * 1024 * MIB,
      },
      readFileSync: (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("missing");
        return value;
      },
    });

    expect(detected).toMatchObject({
      availableCpu: 8,
      cpuQuota: 3.5,
      cpusetCpu: 6,
      effectiveCpu: 3,
      cgroupMemoryBytes: 4096 * MIB,
      effectiveMemoryBytes: 4096 * MIB,
    });
  });

  it("falls back to cgroup v1 and os.cpus when newer probes are unavailable", () => {
    const files = new Map<string, string>([
      [multicore.CGROUP_FILES.cpuQuotaV1, "400000"],
      [multicore.CGROUP_FILES.cpuPeriodV1, "100000"],
      [multicore.CGROUP_FILES.cpusetV1, "2-5"],
      [multicore.CGROUP_FILES.memoryLimitV1, String(2048 * MIB)],
    ]);

    const detected = multicore.detectRuntimeResources({
      osModule: {
        availableParallelism: () => Number.NaN,
        cpus: () => Array.from({ length: 12 }),
        totalmem: () => 32 * 1024 * MIB,
      },
      readFileSync: (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("missing");
        return value;
      },
    });

    expect(detected.effectiveCpu).toBe(4);
    expect(detected.effectiveMemoryBytes).toBe(2048 * MIB);
  });

  it("parses quota, cpuset and unlimited memory formats defensively", () => {
    expect(multicore.parseCpuMax("max 100000")).toBe(Number.POSITIVE_INFINITY);
    expect(multicore.parseCpuMax("200000 100000")).toBe(2);
    expect(multicore.parseCpuMax("broken")).toBeNull();
    expect(multicore.parseCpuSet("0-3,2-5,8")).toBe(7);
    expect(multicore.parseCpuSet("3-1")).toBeNull();
    expect(multicore.parseMemoryLimit("max")).toBe(Number.POSITIVE_INFINITY);
    expect(multicore.parseMemoryLimit("0")).toBeNull();
  });
});

describe("multicore plan", () => {
  it("restores the full owner role when multicore mode falls back to one process", () => {
    const env = {
      CCH_MULTICORE_ACTIVE: "1",
      CCH_MULTICORE_WORKER_INDEX: "7",
      CCH_MULTICORE_WORKER_COUNT: "8",
      CCH_MULTICORE_BACKGROUND_OWNER: "0",
      CCH_PROCESS_ROLE: "gateway",
      CCH_MULTICORE_EFFECTIVE_VCPUS: "8",
      CCH_MULTICORE_EFFECTIVE_MEMORY_BYTES: String(8192 * MIB),
    };

    expect(launcher.normalizeStandaloneEnvironment(env)).toMatchObject({
      CCH_MULTICORE_ACTIVE: "0",
      CCH_MULTICORE_WORKER_INDEX: "0",
      CCH_MULTICORE_WORKER_COUNT: "1",
      CCH_MULTICORE_BACKGROUND_OWNER: "1",
      CCH_PROCESS_ROLE: "gateway-control",
    });
    expect(env.CCH_MULTICORE_EFFECTIVE_VCPUS).toBeUndefined();
    expect(env.CCH_MULTICORE_EFFECTIVE_MEMORY_BYTES).toBeUndefined();
  });

  it("automatically enables two workers at 4 vCPU and preserves aggregate budgets", () => {
    const plan = multicore.createMulticorePlan({
      env: productionEnv(),
      resources: resources(4, 4096),
    });

    expect(plan).toMatchObject({
      enabled: true,
      reason: "auto_resource_eligible",
      workerCount: 2,
    });
    expect(plan.budgetAllocations).not.toBeNull();
    for (const [name, allocations] of Object.entries(plan.budgetAllocations ?? {})) {
      expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(
        plan.aggregateBudgets?.[name]
      );
    }

    const owner = multicore.buildWorkerEnvironment(plan, 0);
    const requestOnly = multicore.buildWorkerEnvironment(plan, 1);
    expect(owner).toMatchObject({
      CCH_MULTICORE_WORKER_INDEX: "0",
      CCH_MULTICORE_WORKER_COUNT: "2",
      CCH_MULTICORE_BACKGROUND_OWNER: "1",
      CCH_PROCESS_ROLE: "gateway-control",
      DB_POOL_MAX: "10",
    });
    expect(requestOnly).toMatchObject({
      CCH_MULTICORE_BACKGROUND_OWNER: "0",
      CCH_PROCESS_ROLE: "gateway",
      DB_POOL_MAX: "10",
    });
  });

  it("scales to four request processes on 8 vCPU when memory is sufficient", () => {
    const plan = multicore.createMulticorePlan({
      env: productionEnv(),
      resources: resources(8, 8192),
    });

    expect(plan.enabled).toBe(true);
    expect(plan.workerCount).toBe(4);
    expect(plan.budgetAllocations?.STREAM_GATE_GLOBAL_PREBUFFER_BYTE_CAP).toEqual([
      64 * MIB,
      64 * MIB,
      64 * MIB,
      64 * MIB,
    ]);
  });

  it.each([
    [productionEnv(), resources(3, 8192), "effective_cpu_below_four"],
    [{ NODE_ENV: "development" }, resources(8, 8192), "non_production"],
    [productionEnv({ CI: "true" }), resources(8, 8192), "ci"],
    [productionEnv(), resources(4, 1024), "insufficient_memory"],
  ])("keeps a single process when automatic eligibility is not met", (env, limits, reason) => {
    const plan = multicore.createMulticorePlan({ env, resources: limits });
    expect(plan).toMatchObject({ enabled: false, workerCount: 1, reason });
  });

  it("allows an explicit, memory-safe override below four vCPU", () => {
    const plan = multicore.createMulticorePlan({
      env: productionEnv({ CCH_MULTICORE_WORKERS: "3" }),
      resources: resources(2, 4096),
    });
    expect(plan).toMatchObject({ enabled: true, workerCount: 3, reason: "explicit_worker_count" });
    expect(plan.budgetAllocations?.DB_POOL_MAX).toEqual([7, 7, 6]);
  });

  it("rejects multiple Next development workers that would race on build state", () => {
    expect(() =>
      multicore.createMulticorePlan({
        env: { NODE_ENV: "development", CCH_MULTICORE_WORKERS: "2" },
        resources: resources(8),
      })
    ).toThrow(/NODE_ENV=production/);
  });

  it("lets off and an explicit single-worker setting disable clustering", () => {
    const off = multicore.createMulticorePlan({
      env: productionEnv({ CCH_MULTICORE_MODE: "off", CCH_MULTICORE_WORKERS: "invalid" }),
      resources: resources(8),
    });
    const single = multicore.createMulticorePlan({
      env: productionEnv({ CCH_MULTICORE_WORKERS: "1" }),
      resources: resources(8),
    });
    expect(off.reason).toBe("mode_off");
    expect(single.reason).toBe("explicit_single_worker");
  });

  it("supports an intentional on override while retaining memory guards", () => {
    const forced = multicore.createMulticorePlan({
      env: productionEnv({ CCH_MULTICORE_MODE: "on" }),
      resources: resources(2, 3072),
    });
    expect(forced).toMatchObject({ enabled: true, workerCount: 2, reason: "mode_on" });

    expect(() =>
      multicore.createMulticorePlan({
        env: productionEnv({ CCH_MULTICORE_MODE: "on" }),
        resources: resources(2, 1024),
      })
    ).toThrow(/at least two gateway workers/);
  });

  it("requires a configured cross-process invalidation channel before clustering", () => {
    expect(multicore.hasCrossProcessInvalidation(productionEnv())).toBe(true);
    expect(multicore.hasCrossProcessInvalidation(productionEnv({ REDIS_URL: undefined }))).toBe(
      false
    );
    expect(
      multicore.hasCrossProcessInvalidation(productionEnv({ ENABLE_RATE_LIMIT: "false" }))
    ).toBe(false);

    const automatic = multicore.createMulticorePlan({
      env: productionEnv({ REDIS_URL: undefined }),
      resources: resources(8),
    });
    expect(automatic).toMatchObject({
      enabled: false,
      reason: "cross_process_invalidation_unavailable",
    });

    expect(() =>
      multicore.createMulticorePlan({
        env: productionEnv({
          CCH_MULTICORE_WORKERS: "2",
          ENABLE_RATE_LIMIT: "false",
        }),
        resources: resources(8),
      })
    ).toThrow(/process-local security and routing caches/);
  });

  it("fails fast instead of multiplying memory or invalid per-worker budgets", () => {
    expect(() =>
      multicore.createMulticorePlan({
        env: productionEnv({ CCH_MULTICORE_WORKERS: "4" }),
        resources: resources(8, 3072),
      })
    ).toThrow(/safe memory\/budget capacity/);

    expect(() =>
      multicore.createMulticorePlan({
        env: productionEnv({
          CCH_MULTICORE_WORKERS: "4",
          STREAM_GATE_PREBUFFER_BYTE_CAP: String(64 * MIB),
        }),
        resources: resources(8, 8192),
      })
    ).toThrow(/safe memory\/budget capacity/);

    expect(() =>
      multicore.createMulticorePlan({
        env: productionEnv({ CCH_MULTICORE_MODE: "sometimes" }),
        resources: resources(8),
      })
    ).toThrow(/auto, on, or off/);
  });

  it("splits integer budgets deterministically with the remainder on low slots", () => {
    expect(multicore.allocateIntegerBudget(20, 3)).toEqual([7, 7, 6]);
    expect(multicore.allocateIntegerBudget(3, 5)).toEqual([1, 1, 1, 0, 0]);
    expect(() => multicore.allocateIntegerBudget(1, 0)).toThrow(/positive integer/);
  });

  it("rejects an out-of-range worker index", () => {
    const plan = multicore.createMulticorePlan({
      env: productionEnv(),
      resources: resources(4, 4096),
    });
    expect(() => multicore.buildWorkerEnvironment(plan, 2)).toThrow(/outside/);
  });
});
