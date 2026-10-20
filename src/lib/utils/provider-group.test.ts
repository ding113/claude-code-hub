import { describe, expect, test } from "vitest";
import {
  normalizeProviderGroup,
  normalizeProviderGroupTag,
  parseProviderGroups,
  resolveBillingProviderGroups,
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

  test("计费分组应取用户分组与已选供应商标签的交集", () => {
    expect(
      resolveBillingProviderGroups("cus_gpt,gpt_test", "cus_claude_pro,cus_grok,gpt_test,mimo")
    ).toEqual(["gpt_test"]);
  });

  test("计费分组应保留用户分组声明顺序", () => {
    expect(resolveBillingProviderGroups("group-b,group-a", "group-a,group-b")).toEqual([
      "group-a",
      "group-b",
    ]);
  });

  test("通配分组应按供应商标签解析倍率", () => {
    expect(resolveBillingProviderGroups("group-b,group-a", "*")).toEqual(["group-b", "group-a"]);
  });

  test("显式匹配分组应优先于通配分组", () => {
    expect(resolveBillingProviderGroups("group-b,group-a", "*,group-a")).toEqual(["group-a"]);
  });

  test("未分组供应商在通配访问下应使用 default 计费分组", () => {
    expect(resolveBillingProviderGroups(null, "*")).toEqual(["default"]);
  });

  test("无交集且无通配权限时不应选择无关分组倍率", () => {
    expect(resolveBillingProviderGroups("group-b", "group-a")).toEqual([]);
  });
});
