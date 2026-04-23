/**
 * @vitest-environment happy-dom
 */

import { describe, expect, test } from "vitest";
import {
  computeQuickEditLimit,
  parseQuickEditDraft,
} from "@/components/quota/quota-quick-edit-popover";

describe("parseQuickEditDraft", () => {
  test("空字符串返回 null", () => {
    expect(parseQuickEditDraft("", "currency")).toBeNull();
    expect(parseQuickEditDraft("   ", "currency")).toBeNull();
  });

  test("非法数字返回 null", () => {
    expect(parseQuickEditDraft("abc", "currency")).toBeNull();
    expect(parseQuickEditDraft("1.2.3", "currency")).toBeNull();
  });

  test("currency 接受小数", () => {
    expect(parseQuickEditDraft("12.5", "currency")).toBe(12.5);
    expect(parseQuickEditDraft("0", "currency")).toBe(0);
  });

  test("integer 拒绝小数", () => {
    expect(parseQuickEditDraft("12.5", "integer")).toBeNull();
    expect(parseQuickEditDraft("12", "integer")).toBe(12);
  });
});

describe("computeQuickEditLimit - set 模式", () => {
  test("空输入 + allowClear=true → null（清除限额）", () => {
    expect(computeQuickEditLimit("set", "", 100, "currency", true)).toBeNull();
  });

  test("输入 0 + allowClear=true → null", () => {
    expect(computeQuickEditLimit("set", "0", 100, "currency", true)).toBeNull();
  });

  test("输入 0 + allowClear=false → 0（保留）", () => {
    expect(computeQuickEditLimit("set", "0", 100, "integer", false)).toBe(0);
  });

  test("输入有效金额 → 该金额", () => {
    expect(computeQuickEditLimit("set", "200", 100, "currency", true)).toBe(200);
    expect(computeQuickEditLimit("set", "200", null, "currency", true)).toBe(200);
  });

  test("非法输入 → null", () => {
    expect(computeQuickEditLimit("set", "abc", 100, "currency", true)).toBeNull();
  });
});

describe("computeQuickEditLimit - add 模式", () => {
  test("currentLimit=100 + 增加 50 = 150", () => {
    expect(computeQuickEditLimit("add", "50", 100, "currency", true)).toBe(150);
  });

  test("currentLimit=null（无限额）+ 增加 50 = 50（视作从 0 起算）", () => {
    expect(computeQuickEditLimit("add", "50", null, "currency", true)).toBe(50);
  });

  test("空输入 → null", () => {
    expect(computeQuickEditLimit("add", "", 100, "currency", true)).toBeNull();
  });

  test("integer 模式拒绝小数增量", () => {
    expect(computeQuickEditLimit("add", "1.5", 10, "integer", false)).toBeNull();
    expect(computeQuickEditLimit("add", "5", 10, "integer", false)).toBe(15);
  });

  test("浮点累加（避免不必要四舍五入）", () => {
    expect(computeQuickEditLimit("add", "0.1", 0.2, "currency", true)).toBeCloseTo(0.3, 10);
  });
});
