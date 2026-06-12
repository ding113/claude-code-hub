import { describe, expect, it } from "vitest";
import type { KeywordRoutingScanTexts } from "@/lib/message-extractor";
import { findMatchingKeywordRoutingRule, ruleMatchesText } from "@/lib/keyword-routing/matcher";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

let nextRuleId = 1;

/** 构建测试规则的工厂函数（id 自增，提供合理默认值） */
function makeRule(overrides: Partial<KeywordRoutingRule> = {}): KeywordRoutingRule {
  const now = new Date();
  return {
    id: nextRuleId++,
    keyword: "EXAMPLE DIALOGE",
    sourceModel: null,
    targetModel: "claude-haiku-4-5",
    caseSensitive: true,
    priority: 0,
    description: null,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** 构建扫描文本的便捷函数 */
function makeTexts(overrides: Partial<KeywordRoutingScanTexts> = {}): KeywordRoutingScanTexts {
  return {
    systemTexts: [],
    lastUserTexts: [],
    ...overrides,
  };
}

describe("ruleMatchesText", () => {
  it("大小写敏感（默认）：仅匹配完全一致的大小写", () => {
    const rule = { keyword: "EXAMPLE DIALOGE", caseSensitive: true };

    expect(ruleMatchesText(rule, "prefix EXAMPLE DIALOGE suffix")).toBe(true);
    expect(ruleMatchesText(rule, "prefix example dialoge suffix")).toBe(false);
  });

  it("大小写不敏感：匹配任意大小写组合", () => {
    const rule = { keyword: "EXAMPLE DIALOGE", caseSensitive: false };

    expect(ruleMatchesText(rule, "EXAMPLE DIALOGE")).toBe(true);
    expect(ruleMatchesText(rule, "example dialoge")).toBe(true);
    expect(ruleMatchesText(rule, "Example Dialoge")).toBe(true);
  });

  it("子串语义：关键词出现在较长句子中也算命中", () => {
    const rule = { keyword: "magic-token", caseSensitive: true };

    expect(ruleMatchesText(rule, "please include the magic-token in your reply")).toBe(true);
    expect(ruleMatchesText(rule, "no token here")).toBe(false);
  });
});

describe("findMatchingKeywordRoutingRule", () => {
  it("无规则时返回 null", () => {
    const result = findMatchingKeywordRoutingRule(
      [],
      makeTexts({ systemTexts: ["EXAMPLE DIALOGE"] }),
      "claude-opus-4-8"
    );

    expect(result).toBeNull();
  });

  it("文本为空时返回 null", () => {
    const result = findMatchingKeywordRoutingRule([makeRule()], makeTexts(), "claude-opus-4-8");

    expect(result).toBeNull();
  });

  it("无任何关键词命中时返回 null", () => {
    const result = findMatchingKeywordRoutingRule(
      [makeRule({ keyword: "not present" })],
      makeTexts({ systemTexts: ["some system"], lastUserTexts: ["some user"] }),
      "claude-opus-4-8"
    );

    expect(result).toBeNull();
  });

  describe("sourceModel 约束", () => {
    it("sourceModel 非空时要求与请求模型严格相等", () => {
      const rule = makeRule({ sourceModel: "claude-opus-4-8" });
      const texts = makeTexts({ lastUserTexts: ["EXAMPLE DIALOGE"] });

      expect(findMatchingKeywordRoutingRule([rule], texts, "claude-opus-4-8")?.rule).toBe(rule);
      expect(findMatchingKeywordRoutingRule([rule], texts, "claude-sonnet-4-5")).toBeNull();
      expect(findMatchingKeywordRoutingRule([rule], texts, "CLAUDE-OPUS-4-8")).toBeNull();
    });

    it("sourceModel 为 null 或空字符串时匹配任意请求模型", () => {
      const texts = makeTexts({ lastUserTexts: ["EXAMPLE DIALOGE"] });

      const nullRule = makeRule({ sourceModel: null });
      expect(findMatchingKeywordRoutingRule([nullRule], texts, "any-model")?.rule).toBe(nullRule);

      const emptyRule = makeRule({ sourceModel: "" });
      expect(findMatchingKeywordRoutingRule([emptyRule], texts, "any-model")?.rule).toBe(emptyRule);
    });

    it("请求模型为 null 且规则带 sourceModel 约束时跳过该规则", () => {
      const rule = makeRule({ sourceModel: "claude-opus-4-8" });
      const texts = makeTexts({ lastUserTexts: ["EXAMPLE DIALOGE"] });

      expect(findMatchingKeywordRoutingRule([rule], texts, null)).toBeNull();
    });
  });

  describe("评估顺序", () => {
    it("数组顺序中首个命中的规则胜出，即使后续规则也能命中", () => {
      const first = makeRule({ keyword: "shared", targetModel: "model-a" });
      const second = makeRule({ keyword: "shared", targetModel: "model-b" });
      const texts = makeTexts({ lastUserTexts: ["contains shared keyword"] });

      const result = findMatchingKeywordRoutingRule([first, second], texts, null);

      expect(result?.rule).toBe(first);
      expect(result?.rule.targetModel).toBe("model-a");
    });

    it("前序规则未命中时回退到后续规则", () => {
      const first = makeRule({ keyword: "absent" });
      const second = makeRule({ keyword: "shared" });
      const texts = makeTexts({ lastUserTexts: ["contains shared keyword"] });

      expect(findMatchingKeywordRoutingRule([first, second], texts, null)?.rule).toBe(second);
    });

    it("规则顺序优先于来源顺序：前序规则命中 user 时胜过后续规则命中 system", () => {
      const first = makeRule({ keyword: "user-only" });
      const second = makeRule({ keyword: "system-only" });
      const texts = makeTexts({
        systemTexts: ["contains system-only keyword"],
        lastUserTexts: ["contains user-only keyword"],
      });

      const result = findMatchingKeywordRoutingRule([first, second], texts, null);

      expect(result?.rule).toBe(first);
      expect(result?.matchedIn).toBe("user");
    });
  });

  describe("规则有效性防御", () => {
    it("跳过 isEnabled=false 的规则", () => {
      const disabled = makeRule({ keyword: "shared", isEnabled: false });
      const enabled = makeRule({ keyword: "shared" });
      const texts = makeTexts({ lastUserTexts: ["contains shared keyword"] });

      expect(findMatchingKeywordRoutingRule([disabled, enabled], texts, null)?.rule).toBe(enabled);
      expect(findMatchingKeywordRoutingRule([disabled], texts, null)).toBeNull();
    });

    it("跳过关键词为空或仅空白字符的规则", () => {
      const empty = makeRule({ keyword: "" });
      const whitespace = makeRule({ keyword: "   " });
      const texts = makeTexts({ systemTexts: ["anything"], lastUserTexts: ["anything"] });

      expect(findMatchingKeywordRoutingRule([empty, whitespace], texts, null)).toBeNull();
    });
  });

  it("中文关键词：大小写敏感与不敏感均能命中 CJK 文本", () => {
    const texts = makeTexts({ lastUserTexts: ["以下是一段示例对话，请参考其中的格式"] });

    const sensitiveRule = makeRule({ keyword: "示例对话", caseSensitive: true });
    const sensitiveResult = findMatchingKeywordRoutingRule([sensitiveRule], texts, null);
    expect(sensitiveResult?.rule).toBe(sensitiveRule);
    expect(sensitiveResult?.matchedIn).toBe("user");

    const insensitiveRule = makeRule({ keyword: "示例对话", caseSensitive: false });
    const insensitiveResult = findMatchingKeywordRoutingRule([insensitiveRule], texts, null);
    expect(insensitiveResult?.rule).toBe(insensitiveRule);
    expect(insensitiveResult?.matchedIn).toBe("user");
  });

  describe("matchedIn 来源标记", () => {
    it("仅 systemTexts 命中时 matchedIn 为 system", () => {
      const rule = makeRule({ keyword: "shared" });
      const texts = makeTexts({
        systemTexts: ["contains shared keyword"],
        lastUserTexts: ["nothing here"],
      });

      expect(findMatchingKeywordRoutingRule([rule], texts, null)?.matchedIn).toBe("system");
    });

    it("仅 lastUserTexts 命中时 matchedIn 为 user", () => {
      const rule = makeRule({ keyword: "shared" });
      const texts = makeTexts({
        systemTexts: ["nothing here"],
        lastUserTexts: ["contains shared keyword"],
      });

      expect(findMatchingKeywordRoutingRule([rule], texts, null)?.matchedIn).toBe("user");
    });

    it("两处同时命中时优先返回 system（system 先检查）", () => {
      const rule = makeRule({ keyword: "shared" });
      const texts = makeTexts({
        systemTexts: ["contains shared keyword"],
        lastUserTexts: ["also contains shared keyword"],
      });

      expect(findMatchingKeywordRoutingRule([rule], texts, null)?.matchedIn).toBe("system");
    });
  });
});
