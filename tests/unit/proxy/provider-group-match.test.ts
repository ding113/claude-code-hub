import { describe, expect, test } from "vitest";
import { checkProviderGroupMatch } from "@/app/v1/_lib/proxy/provider-selector";

describe("checkProviderGroupMatch - 供应商分组匹配逻辑", () => {
  describe("当用户拥有全局访问权限时", () => {
    test("用户分组包含 * 时，应匹配任意供应商分组", () => {
      expect(checkProviderGroupMatch("premium", "*")).toBe(true);
      expect(checkProviderGroupMatch("cli,chat", "*")).toBe(true);
    });

    test("用户分组包含 * 和其他分组时，应匹配任意供应商分组", () => {
      expect(checkProviderGroupMatch("premium", "default,*")).toBe(true);
    });

    test("用户分组仅包含 * 时，应匹配 null 供应商分组", () => {
      expect(checkProviderGroupMatch(null, "*")).toBe(true);
    });
  });

  describe("当供应商未配置分组标签时", () => {
    test("供应商分组为 null，用户分组包含 default，应匹配", () => {
      expect(checkProviderGroupMatch(null, "default")).toBe(true);
      expect(checkProviderGroupMatch(null, "cli,default")).toBe(true);
    });

    test("供应商分组为 null，用户分组不包含 default，应不匹配", () => {
      expect(checkProviderGroupMatch(null, "premium")).toBe(false);
      expect(checkProviderGroupMatch(null, "cli,chat")).toBe(false);
    });
  });

  describe("当供应商和用户分组有交集时", () => {
    test("单个分组完全匹配，应返回 true", () => {
      expect(checkProviderGroupMatch("cli", "cli")).toBe(true);
    });

    test("多个分组中有一个匹配，应返回 true", () => {
      expect(checkProviderGroupMatch("cli", "cli,premium")).toBe(true);
      expect(checkProviderGroupMatch("premium", "cli,premium")).toBe(true);
    });

    test("供应商多标签匹配用户单标签", () => {
      expect(checkProviderGroupMatch("cli,chat", "cli")).toBe(true);
      expect(checkProviderGroupMatch("cli,chat", "chat")).toBe(true);
    });

    test("用户多分组匹配供应商单标签", () => {
      expect(checkProviderGroupMatch("premium", "cli,premium")).toBe(true);
    });
  });

  describe("当供应商和用户分组无交集时", () => {
    test("完全不同的分组，应返回 false", () => {
      expect(checkProviderGroupMatch("premium", "cli")).toBe(false);
      expect(checkProviderGroupMatch("cli,chat", "premium,vip")).toBe(false);
    });

    test("供应商分组为 beta，用户分组为 default，应不匹配", () => {
      expect(checkProviderGroupMatch("beta", "default")).toBe(false);
    });
  });

  describe("边界情况处理", () => {
    test("用户分组含有多余空格时，应正确解析", () => {
      expect(checkProviderGroupMatch("cli", " cli , premium ")).toBe(true);
    });

    test("供应商分组含有多余空格时，应正确解析", () => {
      expect(checkProviderGroupMatch(" cli , chat ", "cli")).toBe(true);
    });

    test("空字符串分组项应被过滤", () => {
      expect(checkProviderGroupMatch("cli", "cli,,")).toBe(true);
      expect(checkProviderGroupMatch("cli", ",,,cli")).toBe(true);
    });
  });
});
