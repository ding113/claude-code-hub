import { describe, expect, it } from "vitest";
import { readResourceSnapshot } from "../../server-lib/resource-snapshot";
import { createMemoryPlan } from "../../server-lib/memory-plan";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function fixture(extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    "/proc/meminfo":
      "MemTotal: 16777216 kB\nMemAvailable: 10485760 kB\nSwapTotal: 4194304 kB\nSwapFree: 2097152 kB\n",
    "/proc/self/cgroup": "0::/service/worker",
    "/proc/self/mountinfo": "29 23 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup rw",
    ...extra,
  };
  return readResourceSnapshot({
    platform: "linux",
    readFileSync(path: string) {
      if (!(path in files)) throw new Error("文件不存在");
      return files[path];
    },
    freeMemory: () => 10 * GiB,
  });
}

describe("内存与 swap 的实际剩余容量", () => {
  it("容器只使用成员组 PSI，不被其他服务的换页和祖先压力持续缩容", () => {
    const files = {
      "/sys/fs/cgroup/service/worker/memory.current": String(GiB),
      "/sys/fs/cgroup/service/worker/memory.max": String(8 * GiB),
      "/sys/fs/cgroup/service/worker/memory.pressure": "full avg10=0.10 avg60=0 total=1",
      "/sys/fs/cgroup/service/memory.pressure": "full avg10=80.00 avg60=0 total=1",
      "/proc/pressure/memory": "full avg10=90.00 avg60=0 total=1",
      "/proc/vmstat": "pswpin 100000\npswpout 200000",
    };
    expect(fixture(files)).toMatchObject({ memoryPressure: 0.1, swapIO: 0 });
    expect(fixture({ ...files, "/proc/vmstat": "pswpin 900000\npswpout 900000" })).toMatchObject({
      memoryPressure: 0.1,
      swapIO: 0,
    });
    expect(
      fixture({
        "/proc/pressure/memory": files["/proc/pressure/memory"],
        "/proc/vmstat": files["/proc/vmstat"],
      })
    ).toMatchObject({ memoryPressure: 90, swapIO: 300000 });
  });

  it("无配额时使用 MemAvailable 和 SwapFree", () => {
    expect(fixture()).toMatchObject({ availableRamBytes: 10 * GiB, availableSwapBytes: 2 * GiB });
  });

  it("读取嵌套 cgroup 并同时遵守祖先配额与 swap 禁用", () => {
    expect(
      fixture({
        "/sys/fs/cgroup/service/worker/memory.max": String(8 * GiB),
        "/sys/fs/cgroup/service/worker/memory.current": String(2 * GiB),
        "/sys/fs/cgroup/service/memory.max": String(4 * GiB),
        "/sys/fs/cgroup/service/memory.current": String(3 * GiB),
        "/sys/fs/cgroup/service/memory.swap.max": "0",
        "/sys/fs/cgroup/service/memory.swap.current": "0",
      })
    ).toMatchObject({ availableRamBytes: GiB, availableSwapBytes: 0 });
  });

  it("memory.high 构成性能边界，max 字面量不当成零", () => {
    expect(
      fixture({
        "/sys/fs/cgroup/service/worker/memory.max": "max",
        "/sys/fs/cgroup/service/worker/memory.high": String(4 * GiB),
        "/sys/fs/cgroup/service/worker/memory.current": String(3 * GiB),
        "/sys/fs/cgroup/service/worker/memory.swap.max": String(GiB),
        "/sys/fs/cgroup/service/worker/memory.swap.current": String(512 * MiB),
      })
    ).toMatchObject({ availableRamBytes: GiB, availableSwapBytes: 512 * MiB });
  });

  it("cgroup v1 的 memsw 是联合限制，不能重复计入", () => {
    expect(
      fixture({
        "/proc/self/cgroup": "5:memory:/service",
        "/proc/self/mountinfo": "29 23 0:26 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory",
        "/sys/fs/cgroup/memory/service/memory.limit_in_bytes": String(2 * GiB),
        "/sys/fs/cgroup/memory/service/memory.usage_in_bytes": String(GiB),
        "/sys/fs/cgroup/memory/service/memory.memsw.limit_in_bytes": String(2.5 * GiB),
        "/sys/fs/cgroup/memory/service/memory.memsw.usage_in_bytes": String(1.25 * GiB),
      })
    ).toMatchObject({ availableRamBytes: GiB, availableSwapBytes: 256 * MiB });
  });

  it("容器挂载根路径不同于 cgroup 路径时仍正确定位", () => {
    expect(
      fixture({
        "/proc/self/cgroup": "0::/docker/abc/service",
        "/proc/self/mountinfo": "29 23 0:26 /docker/abc /sys/fs/cgroup rw - cgroup2 cgroup rw",
        "/sys/fs/cgroup/service/memory.max": String(GiB),
        "/sys/fs/cgroup/service/memory.current": String(768 * MiB),
      }).availableRamBytes
    ).toBe(256 * MiB);
  });

  it("无法测量 swap 的平台保守地只计算物理内存", () => {
    expect(readResourceSnapshot({ platform: "win32", freeMemory: () => 2 * GiB })).toMatchObject({
      availableRamBytes: 2 * GiB,
      availableSwapBytes: 0,
    });
  });

  it("cgroup namespace 中的根成员仍遵守挂载根限制", () => {
    expect(
      fixture({
        "/proc/self/cgroup": "0::/",
        "/proc/self/mountinfo": "29 23 0:26 /docker/abc /sys/fs/cgroup rw - cgroup2 cgroup rw",
        "/sys/fs/cgroup/memory.max": String(GiB),
        "/sys/fs/cgroup/memory.current": String(768 * MiB),
      }).availableRamBytes
    ).toBe(256 * MiB);
  });
});

describe("自动规划与显式限制", () => {
  it("显式小预算可以覆盖自动保留量，仍不能超过物理余量", () => {
    expect(
      createMemoryPlan({
        env: { CCH_MEMORY_BUDGET_BYTES: String(16 * MiB) },
        snapshot: { availableRamBytes: 128 * MiB, availableSwapBytes: 0 },
      })
    ).toMatchObject({ budgetBytes: 16 * MiB, hotBudgetBytes: 16 * MiB, source: "explicit" });
  });
  it("按可用内存加一半 swap 计算，保留基础余量", () => {
    const p = createMemoryPlan({ env: {}, snapshot: fixture() });
    expect(p.weightedAvailableBytes).toBe(11 * GiB);
    expect(p.budgetBytes).toBe(6 * GiB);
    expect(p.hotBudgetBytes).toBe(6 * GiB);
    expect(p.source).toBe("auto");
  });

  it("显式业务预算不因空闲内存很大而被放大", () => {
    expect(
      createMemoryPlan({ env: { CCH_MEMORY_BUDGET_BYTES: String(512 * MiB) }, snapshot: fixture() })
    ).toMatchObject({ budgetBytes: 512 * MiB, source: "explicit" });
  });

  it("资源不足时预算为零，swap 不能伪造热点物理余量", () => {
    const p = createMemoryPlan({
      env: {},
      snapshot: { availableRamBytes: 0, availableSwapBytes: 8 * GiB },
    });
    expect(p.hotBudgetBytes).toBe(0);
    expect(p.budgetBytes).toBeGreaterThan(0);
    expect(
      createMemoryPlan({ env: {}, snapshot: { availableRamBytes: MiB, availableSwapBytes: 0 } })
        .budgetBytes
    ).toBe(0);
  });

  it.each(["-1", "NaN", "0.2", "Infinity"])("非法显式预算 %s 不静默回退", (raw) => {
    expect(() =>
      createMemoryPlan({ env: { CCH_MEMORY_BUDGET_BYTES: raw }, snapshot: fixture() })
    ).toThrow();
  });
});
