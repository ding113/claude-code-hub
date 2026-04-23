import { describe, expect, test } from "vitest";
import {
  normalizeProviderGroup,
  normalizeProviderGroupTag,
  parseProviderGroups,
  resolveProviderGroupsWithDefault,
} from "./provider-group";

describe("provider-group utils", () => {
  test("parseProviderGroups 应支持中文逗号和换行作为分隔符", () => {
    expect(parseProviderGroups("研发，渠道\n直营")).toEqual(["研发", "渠道", "直营"]);
  });

  test("normalizeProviderGroup 应在支持中文标签的同时做去重和排序", () => {
    expect(normalizeProviderGroup("研发，渠道\n研发")).toBe("渠道,研发");
  });

  test("normalizeProviderGroupTag 应支持中文标签并保留原始顺序", () => {
    expect(normalizeProviderGroupTag("直营，华北\n直营")).toBe("直营,华北");
  });

  test("normalizeProviderGroupTag 在空输入时应返回 null", () => {
    expect(normalizeProviderGroupTag("  ， \n  ")).toBeNull();
  });

  test("returns default membership for null or blank group tags", () => {
    expect(resolveProviderGroupsWithDefault(null)).toEqual(["default"]);
    expect(resolveProviderGroupsWithDefault("   ")).toEqual(["default"]);
    expect(resolveProviderGroupsWithDefault("openai,default")).toEqual(["openai", "default"]);
  });

  test("keeps raw parse semantics unchanged for empty input", () => {
    expect(parseProviderGroups(null)).toEqual([]);
    expect(parseProviderGroups("   ")).toEqual([]);
  });
});
