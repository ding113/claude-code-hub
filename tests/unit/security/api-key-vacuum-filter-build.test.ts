import { describe, expect, test, vi } from "vitest";

describe("buildVacuumFilterFromKeyStrings", () => {
  test("应去重并忽略空字符串，且覆盖所有 key", async () => {
    const { buildVacuumFilterFromKeyStrings } = await import(
      "@/lib/security/api-key-vacuum-filter"
    );
    const vf = buildVacuumFilterFromKeyStrings({
      keyStrings: ["k1", "k2", "k1", ""],
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: Buffer.from("unit-test-seed"),
    });

    expect(vf.size()).toBe(2);
    expect(vf.has("k1")).toBe(true);
    expect(vf.has("k2")).toBe(true);
  });

  test("空数组输入：应返回空 filter", async () => {
    const { buildVacuumFilterFromKeyStrings } = await import(
      "@/lib/security/api-key-vacuum-filter"
    );
    const vf = buildVacuumFilterFromKeyStrings({
      keyStrings: [],
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: Buffer.from("unit-test-seed"),
    });

    expect(vf.size()).toBe(0);
  });

  test("全空字符串：应返回空 filter", async () => {
    const { buildVacuumFilterFromKeyStrings } = await import(
      "@/lib/security/api-key-vacuum-filter"
    );
    const vf = buildVacuumFilterFromKeyStrings({
      keyStrings: ["", "", ""],
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: Buffer.from("unit-test-seed"),
    });

    expect(vf.size()).toBe(0);
  });

  test("构建失败时应扩容重试", async () => {
    vi.resetModules();
    const maxItemsSeen: number[] = [];

    vi.doMock("@/lib/vacuum-filter/vacuum-filter", () => {
      class VacuumFilter {
        private readonly maxItems: number;

        constructor(options: { maxItems: number }) {
          this.maxItems = options.maxItems;
          maxItemsSeen.push(options.maxItems);
        }

        add(_keyString: string): boolean {
          // 强制第一次失败（maxItems=128），第二次成功（maxItems=ceil(128*1.6)=205）
          return this.maxItems >= 205;
        }
      }

      return { VacuumFilter };
    });

    const { buildVacuumFilterFromKeyStrings } = await import(
      "@/lib/security/api-key-vacuum-filter"
    );
    buildVacuumFilterFromKeyStrings({
      keyStrings: ["k1"],
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: Buffer.from("unit-test-seed"),
    });

    expect(maxItemsSeen).toEqual([128, 205]);

    vi.doUnmock("@/lib/vacuum-filter/vacuum-filter");
    vi.resetModules();
  });
});
