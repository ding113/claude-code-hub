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

describe("planProviderBalanceSources", () => {
  it("未知中转网关按通用兼容端点顺序探测", () => {
    const plan = planProviderBalanceSources({
      providerUrl: "https://relay.example.com",
      providerKey: KEY,
    });

    expect(plan.sources).toEqual(["new-api-token-usage", "openai-billing"]);
  });

  it("官方直连端点没有余额查询", () => {
    for (const url of [
      "https://api.anthropic.com",
      "https://api.openai.com/v1",
      "https://generativelanguage.googleapis.com",
    ]) {
      expect(planProviderBalanceSources({ providerUrl: url, providerKey: KEY }).sources).toEqual(
        []
      );
    }
  });

  it("DeepSeek 先查官方钱包再回落兼容端点", () => {
    const plan = planProviderBalanceSources({
      providerUrl: "https://api.deepseek.com",
      providerKey: KEY,
    });

    expect(plan.sources).toEqual(["deepseek-balance", "new-api-token-usage", "openai-billing"]);
  });

  it("Moonshot 按域名决定结算币种", () => {
    const cn = planProviderBalanceSources({
      providerUrl: "https://api.moonshot.cn/v1",
      providerKey: KEY,
    });
    const global = planProviderBalanceSources({
      providerUrl: "https://api.moonshot.ai/v1",
      providerKey: KEY,
    });

    expect(cn.sources[0]).toBe("kimi-balance");
    expect(cn.kimiCurrency).toBe("CNY");
    expect(global.kimiCurrency).toBe("USD");
  });

  it("ChatGPT 账号只查后端用量端点", () => {
    const plan = planProviderBalanceSources({
      providerUrl: "https://chatgpt.com/backend-api/codex",
      providerKey: KEY,
    });

    expect(plan.sources).toEqual(["chatgpt-credits"]);
  });

  it("非法地址、空密钥与结构化凭证都不探测", () => {
    expect(planProviderBalanceSources({ providerUrl: "nope", providerKey: KEY }).sources).toEqual(
      []
    );
    expect(
      planProviderBalanceSources({ providerUrl: "https://relay.example.com", providerKey: "  " })
        .sources
    ).toEqual([]);
    expect(
      planProviderBalanceSources({
        providerUrl: "https://relay.example.com",
        providerKey: '{"client_email":"x"}',
      }).sources
    ).toEqual([]);
  });
});
