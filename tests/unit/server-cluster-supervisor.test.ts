import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);
const { createMulticorePlan, WORKER_READY_MESSAGE_TYPE } = requireFromHere(
  "../../server-lib/multicore.js"
) as {
  WORKER_READY_MESSAGE_TYPE: string;
  createMulticorePlan: (options: unknown) => MulticorePlan;
};
const { createClusterSupervisor, resolveSupervisorSettings } = requireFromHere(
  "../../server-lib/cluster-supervisor.js"
) as {
  createClusterSupervisor: (options: Record<string, unknown>) => Supervisor;
  resolveSupervisorSettings: (env: Record<string, string>) => { shutdownTimeoutMs: number };
};

type MulticorePlan = { enabled: boolean; workerCount: number };
type Supervisor = {
  beginShutdown: (signal: string, exitCode?: number, reason?: string) => void;
  snapshot: () => {
    workerSlots: number[];
    readySlots: number[];
    restartSlots: number[];
    shuttingDown: boolean;
  };
  start: () => Supervisor;
};

class FakeWorker extends EventEmitter {
  readonly env: Record<string, string>;
  readonly process: { pid: number; kill: ReturnType<typeof vi.fn> };

  constructor(env: Record<string, string>, pid: number) {
    super();
    this.env = env;
    this.process = { pid, kill: vi.fn() };
  }
}

class FakeCluster {
  readonly workers: FakeWorker[] = [];
  readonly fork = vi.fn((env: Record<string, string>) => {
    const worker = new FakeWorker(env, 10_000 + this.workers.length);
    this.workers.push(worker);
    return worker;
  });
}

function plan(workerCount = 3): MulticorePlan {
  return createMulticorePlan({
    env: {
      NODE_ENV: "production",
      ENABLE_RATE_LIMIT: "true",
      REDIS_URL: "redis://redis:6379",
      CCH_MULTICORE_WORKERS: String(workerCount),
    },
    resources: {
      availableCpu: 8,
      cpuQuota: null,
      cpusetCpu: null,
      effectiveCpu: 8,
      hostMemoryBytes: 16 * 1024 * 1024 * 1024,
      cgroupMemoryBytes: 16 * 1024 * 1024 * 1024,
      effectiveMemoryBytes: 16 * 1024 * 1024 * 1024,
    },
  });
}

function ready(worker: FakeWorker) {
  worker.emit("message", { type: WORKER_READY_MESSAGE_TYPE });
}

function makeSupervisor(
  clusterModule: FakeCluster,
  override: Record<string, unknown> = {}
): { supervisor: Supervisor; exit: ReturnType<typeof vi.fn>; logs: string[] } {
  const exit = vi.fn();
  const logs: string[] = [];
  const supervisor = createClusterSupervisor({
    clusterModule,
    plan: plan(),
    processRef: Object.assign(new EventEmitter(), { env: {}, exit }),
    registerSignals: false,
    exit,
    log: (_level: string, event: string) => logs.push(event),
    settings: {
      readyTimeoutMs: 100,
      shutdownTimeoutMs: 500,
      restartWindowMs: 1000,
      maxRestartsPerWindow: 5,
      restartBaseDelayMs: 10,
      restartMaxDelayMs: 100,
      forceExitGraceMs: 10,
    },
    ...override,
  });
  return { supervisor, exit, logs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cluster supervisor", () => {
  it("rejects invalid supervisor inputs and timing values", () => {
    expect(() => createClusterSupervisor({})).toThrow(/clusterModule/);
    expect(() =>
      createClusterSupervisor({ clusterModule: new FakeCluster(), plan: { enabled: false } })
    ).toThrow(/enabled multicore plan/);
    expect(() => resolveSupervisorSettings({ CCH_MULTICORE_READY_TIMEOUT_MS: "zero" })).toThrow(
      /positive integer/
    );
  });

  it("keeps the primary shutdown deadline beyond every worker hard deadline", () => {
    expect(resolveSupervisorSettings({ SHUTDOWN_HARD_EXIT_MS: "40000" }).shutdownTimeoutMs).toBe(
      45000
    );
    expect(() =>
      resolveSupervisorSettings({
        SHUTDOWN_HARD_EXIT_MS: "40000",
        CCH_MULTICORE_SHUTDOWN_TIMEOUT_MS: "30000",
      })
    ).toThrow(/must exceed/);
  });

  it("starts only the background owner, then forks request workers after it is ready", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, logs } = makeSupervisor(clusterModule);

    supervisor.start();
    expect(clusterModule.workers).toHaveLength(1);
    expect(clusterModule.workers[0].env).toMatchObject({
      CCH_MULTICORE_WORKER_INDEX: "0",
      CCH_MULTICORE_BACKGROUND_OWNER: "1",
      CCH_PROCESS_ROLE: "gateway-control",
    });
    expect(supervisor.snapshot()).toMatchObject({ workerSlots: [0], readySlots: [] });

    clusterModule.workers[0].emit("message", { type: "unrelated" });
    expect(clusterModule.workers).toHaveLength(1);
    ready(clusterModule.workers[0]);
    expect(clusterModule.workers).toHaveLength(3);
    expect(clusterModule.workers[1].env.CCH_MULTICORE_BACKGROUND_OWNER).toBe("0");
    expect(clusterModule.workers[2].env.CCH_MULTICORE_BACKGROUND_OWNER).toBe("0");

    ready(clusterModule.workers[1]);
    ready(clusterModule.workers[2]);
    expect(supervisor.snapshot()).toMatchObject({
      workerSlots: [0, 1, 2],
      readySlots: [0, 1, 2],
    });
    expect(logs).toContain("multicore_cluster_ready");
    expect(() => supervisor.start()).toThrow(/already been started/);
  });

  it("retries a synchronous cluster fork failure", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    clusterModule.fork.mockImplementationOnce(() => {
      throw new Error("fork failed");
    });
    const { supervisor, logs } = makeSupervisor(clusterModule);

    supervisor.start();
    expect(supervisor.snapshot().restartSlots).toEqual([0]);
    vi.advanceTimersByTime(10);
    expect(clusterModule.workers).toHaveLength(1);
    expect(logs).toContain("multicore_worker_restart_scheduled");
  });

  it("absorbs asynchronous worker errors and lets exit drive one restart", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, logs } = makeSupervisor(clusterModule);
    supervisor.start();
    const failedWorker = clusterModule.workers[0];

    expect(() => failedWorker.emit("error", new Error("spawn EAGAIN"))).not.toThrow();
    expect(logs).toContain("multicore_worker_error");
    expect(supervisor.snapshot().restartSlots).toEqual([]);

    failedWorker.emit("exit", 1, null);
    expect(supervisor.snapshot().restartSlots).toEqual([0]);
    vi.advanceTimersByTime(10);

    expect(clusterModule.workers).toHaveLength(2);
    expect(clusterModule.workers[1].env.CCH_MULTICORE_WORKER_INDEX).toBe("0");
    expect(logs.filter((event) => event === "multicore_worker_exited")).toHaveLength(1);
  });

  it("restarts an unexpectedly exited worker in the same resource slot", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor } = makeSupervisor(clusterModule);
    supervisor.start();
    ready(clusterModule.workers[0]);
    const failedWorker = clusterModule.workers[1];

    failedWorker.emit("exit", 1, null);
    expect(supervisor.snapshot().restartSlots).toEqual([1]);
    vi.advanceTimersByTime(10);

    expect(clusterModule.workers).toHaveLength(4);
    expect(clusterModule.workers[3].env.CCH_MULTICORE_WORKER_INDEX).toBe("1");
    expect(clusterModule.workers[3].env.DB_POOL_MAX).toBe(failedWorker.env.DB_POOL_MAX);
  });

  it("terminates an unready worker and restarts it after exit", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, logs } = makeSupervisor(clusterModule);
    supervisor.start();
    const stalledOwner = clusterModule.workers[0];

    vi.advanceTimersByTime(100);
    expect(stalledOwner.process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(logs).toContain("multicore_worker_ready_timeout");

    stalledOwner.emit("exit", null, "SIGTERM");
    vi.advanceTimersByTime(10);
    expect(clusterModule.workers).toHaveLength(2);
    expect(clusterModule.workers[1].env.CCH_MULTICORE_WORKER_INDEX).toBe("0");
  });

  it("rejects late readiness and force-kills a startup worker after timeout", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, logs } = makeSupervisor(clusterModule, {
      settings: {
        readyTimeoutMs: 100,
        readyKillGraceMs: 20,
        shutdownTimeoutMs: 500,
        restartWindowMs: 1000,
        maxRestartsPerWindow: 5,
        restartBaseDelayMs: 10,
        restartMaxDelayMs: 100,
        forceExitGraceMs: 10,
      },
    });
    supervisor.start();
    const stalledOwner = clusterModule.workers[0];

    vi.advanceTimersByTime(100);
    ready(stalledOwner);
    expect(supervisor.snapshot().readySlots).toEqual([]);
    expect(clusterModule.workers).toHaveLength(1);
    expect(logs).toContain("multicore_worker_ready_after_timeout");

    vi.advanceTimersByTime(20);
    expect(stalledOwner.process.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(stalledOwner.process.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(logs).toContain("multicore_worker_ready_force_kill");
  });

  it("forwards shutdown, waits for workers, and never restarts them", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, exit } = makeSupervisor(clusterModule);
    supervisor.start();
    ready(clusterModule.workers[0]);

    supervisor.beginShutdown("SIGTERM");
    expect(supervisor.snapshot().shuttingDown).toBe(true);
    for (const worker of clusterModule.workers) {
      expect(worker.process.kill).toHaveBeenCalledWith("SIGTERM");
      worker.emit("exit", 0, null);
    }

    expect(exit).toHaveBeenCalledWith(0);
    vi.runAllTimers();
    expect(clusterModule.workers).toHaveLength(3);
  });

  it("fails the primary after a bounded worker crash loop", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, exit, logs } = makeSupervisor(clusterModule, {
      settings: {
        readyTimeoutMs: 100,
        shutdownTimeoutMs: 500,
        restartWindowMs: 1000,
        maxRestartsPerWindow: 2,
        restartBaseDelayMs: 10,
        restartMaxDelayMs: 100,
        forceExitGraceMs: 10,
      },
    });
    supervisor.start();
    ready(clusterModule.workers[0]);

    clusterModule.workers[1].emit("exit", 1, null);
    vi.advanceTimersByTime(10);
    clusterModule.workers[3].emit("exit", 1, null);

    expect(logs).toContain("multicore_worker_crash_loop");
    expect(clusterModule.workers[0].process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(clusterModule.workers[2].process.kill).toHaveBeenCalledWith("SIGTERM");
    clusterModule.workers[0].emit("exit", 0, null);
    clusterModule.workers[2].emit("exit", 0, null);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("uses a hard bound and SIGKILL when graceful shutdown does not finish", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, exit, logs } = makeSupervisor(clusterModule);
    supervisor.start();
    supervisor.beginShutdown("SIGTERM");

    vi.advanceTimersByTime(500);
    expect(clusterModule.workers[0].process.kill).toHaveBeenCalledWith("SIGKILL");
    expect(logs).toContain("multicore_shutdown_timeout");
    vi.advanceTimersByTime(10);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("propagates a worker cleanup failure and a repeated shutdown escalation", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const { supervisor, exit } = makeSupervisor(clusterModule);
    supervisor.start();
    supervisor.beginShutdown("SIGTERM");
    supervisor.beginShutdown("SIGTERM", 1, "escalated");
    clusterModule.workers[0].emit("exit", 1, null);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("can bind primary SIGINT/SIGTERM handlers", () => {
    vi.useFakeTimers();
    const clusterModule = new FakeCluster();
    const processRef = Object.assign(new EventEmitter(), { env: {}, exit: vi.fn() });
    const supervisor = createClusterSupervisor({
      clusterModule,
      plan: plan(2),
      processRef,
      exit: processRef.exit,
      settings: { shutdownTimeoutMs: 500 },
    });
    supervisor.start();
    processRef.emit("SIGINT");
    expect(clusterModule.workers[0].process.kill).toHaveBeenCalledWith("SIGINT");
  });
});
