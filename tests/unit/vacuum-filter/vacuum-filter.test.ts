import { describe, expect, test } from "vitest";
import { VacuumFilter } from "@/lib/vacuum-filter/vacuum-filter";

describe("VacuumFilter", () => {
  test("add/has/delete 基本语义正确", () => {
    const vf = new VacuumFilter({
      maxItems: 1000,
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: "unit-test-seed",
    });

    expect(vf.has("k1")).toBe(false);
    expect(vf.add("k1")).toBe(true);
    expect(vf.has("k1")).toBe(true);

    expect(vf.delete("k1")).toBe(true);
    expect(vf.has("k1")).toBe(false);

    // 删除不存在的 key
    expect(vf.delete("k1")).toBe(false);
  });

  test("高负载下插入与查询稳定（无假阴性）", () => {
    const n = 20_000;
    const vf = new VacuumFilter({
      maxItems: n,
      fingerprintBits: 32,
      maxKickSteps: 1000,
      seed: "unit-test-high-load",
    });

    for (let i = 0; i < n; i++) {
      const ok = vf.add(`key_${i}`);
      expect(ok).toBe(true);
    }

    for (let i = 0; i < n; i++) {
      expect(vf.has(`key_${i}`)).toBe(true);
    }

    // 删除一小部分（碰撞概率极低；使用 32-bit fingerprint 避免测试随机性）
    for (let i = 0; i < 200; i++) {
      expect(vf.delete(`key_${i}`)).toBe(true);
      expect(vf.has(`key_${i}`)).toBe(false);
    }
  });

  test("插入失败必须回滚（不丢元素，不引入假阴性）", () => {
    const vf = new VacuumFilter({
      maxItems: 10,
      fingerprintBits: 32,
      maxKickSteps: 50,
      seed: "unit-test-rollback-on-failure",
    });

    const inserted: string[] = [];
    let failed = false;

    for (let i = 0; i < 5000; i++) {
      const key = `key_${i}`;
      const ok = vf.add(key);
      if (!ok) {
        failed = true;
        break;
      }
      inserted.push(key);
    }

    expect(failed).toBe(true);
    expect(vf.size()).toBe(inserted.length);

    // 已插入的元素必须都能查到（无假阴性）
    for (const key of inserted) {
      expect(vf.has(key)).toBe(true);
    }
  });

  test("构造参数包含 NaN 时应使用默认值（不崩溃）", () => {
    const vf = new VacuumFilter({
      maxItems: 1000,
      // @ts-expect-error: 用于覆盖运行时边界情况
      fingerprintBits: Number.NaN,
      // @ts-expect-error: 用于覆盖运行时边界情况
      maxKickSteps: Number.NaN,
      // @ts-expect-error: 用于覆盖运行时边界情况
      targetLoadFactor: Number.NaN,
      seed: "unit-test-nan-options",
    });

    expect(vf.add("k1")).toBe(true);
    expect(vf.has("k1")).toBe(true);
  });

  test("非 ASCII 字符串也应可用（UTF-8 编码路径）", () => {
    const vf = new VacuumFilter({
      maxItems: 1000,
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: "unit-test-non-ascii",
    });

    const keys = ["你好", "ключ", "テスト"];
    for (const key of keys) {
      expect(vf.add(key)).toBe(true);
      expect(vf.has(key)).toBe(true);
    }
  });

  test("超长 key 也应可用（避免 scratch32 对齐导致 RangeError）", () => {
    const vf = new VacuumFilter({
      maxItems: 1000,
      fingerprintBits: 32,
      maxKickSteps: 500,
      seed: "unit-test-long-key",
    });

    // 触发 scratch 扩容：> DEFAULT_SCRATCH_BYTES*2 且不是 4 的倍数
    const longKey = "a".repeat(1001);
    expect(vf.add(longKey)).toBe(true);
    expect(vf.has(longKey)).toBe(true);
    expect(vf.delete(longKey)).toBe(true);
    expect(vf.has(longKey)).toBe(false);
  });

  test("alternate index 应为可逆映射（alt(alt(i,tag),tag)=i）且不越界", () => {
    const vf = new VacuumFilter({
      maxItems: 50_000,
      fingerprintBits: 32,
      maxKickSteps: 1000,
      seed: "unit-test-alt-index-involution",
    });

    const numBuckets = vf.capacitySlots() / 4;
    // @ts-expect-error: 单测需要覆盖私有方法的核心不变量
    const altIndex = (index: number, tag: number) => vf.altIndex(index, tag) as number;

    for (let i = 0; i < 10_000; i++) {
      const index = i % numBuckets;
      const tag = (i * 2654435761) >>> 0;
      const alt = altIndex(index, tag);
      expect(alt).toBeGreaterThanOrEqual(0);
      expect(alt).toBeLessThan(numBuckets);

      const back = altIndex(alt, tag);
      expect(back).toBe(index);
    }
  });
});
