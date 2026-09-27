import { describe, expect, it } from "vitest";
import {
  isStructuredCredential,
  normalizeBalanceBaseUrl,
  planProviderBalanceSources,
  readHostname,
} from "@/lib/provider-balance/planner";

const KEY = "sk-test";

describe("normalizeBalanceBaseUrl", () => {
  it("去掉末尾斜杠", () => {
    expect(normalizeBalanceBaseUrl("https://relay.example.com/")).toBe("https://relay.example.com");
    expect(normalizeBalanceBaseUrl("https://relay.example.com///")).toBe(
      "https://relay.example.com"
    );
    expect(normalizeBalanceBaseUrl("  https://relay.example.com/api/  ")).toBe(
      "https://relay.example.com/api"
    );
  });
});

describe("readHostname", () => {
  it("解析主机名并转小写", () => {
    expect(readHostname("https://Relay.Example.COM/v1")).toBe("relay.example.com");
  });

  it("非法 URL 返回 null", () => {
    expect(readHostname("not a url")).toBeNull();
    expect(readHostname("")).toBeNull();
  });
});

describe("isStructuredCredential", () => {
  it("识别 JSON 结构化凭证", () => {
    expect(isStructuredCredential('{"type":"service_account"}')).toBe(true);
    expect(isStructuredCredential("  { }")).toBe(true);
    expect(isStructuredCredential("sk-abc")).toBe(false);
  });
});

function plan(providerUrl: string, providerKey = KEY, newApiAccessToken: string | null = null) {
  return planProviderBalanceSources({ providerUrl, providerKey, newApiAccessToken });
}

describe("planProviderBalanceSources", () => {
  it("未知中转网关按通用兼容端点顺序探测，Sub2API 排在 New API 之后", () => {
    expect(plan("https://relay.example.com").sources).toEqual([
      "new-api-token-usage",
      "sub2api-usage",
      "openai-billing",
    ]);
  });

  it("官方直连端点没有余额查询", () => {
    for (const url of [
      "https://api.anthropic.com",
      "https://api.openai.com/v1",
      "https://generativelanguage.googleapis.com",
    ]) {
      expect(plan(url).sources).toEqual([]);
    }
  });

  it("DeepSeek 先查官方钱包再回落兼容端点", () => {
    expect(plan("https://api.deepseek.com").sources).toEqual([
      "deepseek-balance",
      "new-api-token-usage",
      "sub2api-usage",
      "openai-billing",
    ]);
  });

  it("Moonshot 按域名决定结算币种", () => {
    const cn = plan("https://api.moonshot.cn/v1");
    const global = plan("https://api.moonshot.ai/v1");

    expect(cn.sources[0]).toBe("kimi-balance");
    expect(cn.kimiCurrency).toBe("CNY");
    expect(global.kimiCurrency).toBe("USD");
  });

  it("ChatGPT 账号只查后端用量端点", () => {
    expect(plan("https://chatgpt.com/backend-api/codex").sources).toEqual(["chatgpt-credits"]);
  });

  it("非法地址、空密钥与结构化凭证都不探测", () => {
    expect(plan("nope").sources).toEqual([]);
    expect(plan("https://relay.example.com", "  ").sources).toEqual([]);
    expect(plan("https://relay.example.com", '{"client_email":"x"}').sources).toEqual([]);
  });

  it("配置了系统访问令牌时只查询 New API 账户余额", () => {
    expect(plan("https://relay.example.com/v1", KEY, "access-token").sources).toEqual([
      "new-api-account",
    ]);
  });

  it("配置了系统访问令牌时不再检查供应商密钥的形态", () => {
    expect(
      plan("https://relay.example.com", '{"client_email":"x"}', "access-token").sources
    ).toEqual(["new-api-account"]);
    expect(plan("https://relay.example.com", "", "access-token").sources).toEqual([
      "new-api-account",
    ]);
  });

  it("空白令牌等同于未配置", () => {
    expect(plan("https://relay.example.com", KEY, "   ").sources[0]).toBe("new-api-token-usage");
  });

  it("地址非法时即使配置了令牌也不探测", () => {
    expect(plan("nope", KEY, "access-token").sources).toEqual([]);
  });
});
