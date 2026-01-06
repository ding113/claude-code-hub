import { describe, expect, test } from "vitest";

import { validatePositiveDecimalField } from "./provider";

describe("validatePositiveDecimalField", () => {
  test("空值/空白：应返回 null", () => {
    expect(validatePositiveDecimalField("")).toBeNull();
    expect(validatePositiveDecimalField("   ")).toBeNull();
  });

  test("非法输入：应返回 null", () => {
    expect(validatePositiveDecimalField("abc")).toBeNull();
  });

  test("0 或负数：应返回 null（与 <=0 不限额语义对齐）", () => {
    expect(validatePositiveDecimalField("0")).toBeNull();
    expect(validatePositiveDecimalField("-1")).toBeNull();
    expect(validatePositiveDecimalField("-0.01")).toBeNull();
  });

  test("极小正数四舍五入后为 0：应返回 null", () => {
    expect(validatePositiveDecimalField("0.004")).toBeNull();
  });

  test("四舍五入到两位小数后仍为正数：应返回 rounded 值", () => {
    expect(validatePositiveDecimalField("0.005")).toBe(0.01);
    expect(validatePositiveDecimalField("1.234")).toBe(1.23);
    expect(validatePositiveDecimalField("1.235")).toBe(1.24);
  });
});
