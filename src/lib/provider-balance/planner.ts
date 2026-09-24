// 余额探测顺序规划
//
// 先按已知服务商域名选择官方钱包端点，再回落到中转网关的通用兼容端点。
// 官方 Anthropic / OpenAI / Google 端点不提供余额查询，直接判定为不支持。

import type { CurrencyCode } from "@/lib/utils/currency";
import { PROVIDER_BALANCE_SOURCES, type ProviderBalanceSource } from "@/types/provider-balance";

/** 通用兼容端点，按成功率排序：中转网关多为 New API 家族 */
const GATEWAY_FALLBACK_SOURCES: readonly ProviderBalanceSource[] = [
  PROVIDER_BALANCE_SOURCES.NewApiTokenUsage,
  PROVIDER_BALANCE_SOURCES.OpenAiBilling,
];

/** 官方直连端点，没有可用余额查询 */
const OFFICIAL_HOSTNAMES = new Set([
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "aiplatform.googleapis.com",
]);

const DEEPSEEK_HOSTNAME = "api.deepseek.com";

/** ChatGPT 账号的余额来自后端用量端点，与中转网关的兼容端点无关 */
const CHATGPT_HOSTNAME = "chatgpt.com";

/** Moonshot 各站点的结算币种 */
const MOONSHOT_CURRENCY_BY_HOSTNAME: Record<string, CurrencyCode> = {
  "api.moonshot.ai": "USD",
  "api.moonshot.cn": "CNY",
};

export interface ProviderBalancePlan {
  /** 按顺序尝试的来源；为空表示该供应商不支持余额查询 */
  sources: ProviderBalanceSource[];
  /** Kimi 钱包的结算币种，由域名决定 */
  kimiCurrency: CurrencyCode;
}

/** 去掉末尾斜杠，得到可直接拼接端点路径的基地址 */
export function normalizeBalanceBaseUrl(providerUrl: string): string {
  return providerUrl.trim().replace(/\/+$/, "");
}

/** 解析出主机名；URL 非法时返回 null */
export function readHostname(providerUrl: string): string | null {
  try {
    return new URL(providerUrl.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 判定密钥是否是 JSON 结构化凭证（Gemini CLI 的 service account 凭证）。
 * 这类凭证不能作为 Bearer token 使用，无法查询余额。
 */
export function isStructuredCredential(providerKey: string): boolean {
  return providerKey.trim().startsWith("{");
}

/**
 * 规划一个供应商的余额探测顺序。
 *
 * Gemini 官方协议使用 x-goog-api-key 认证且没有余额端点，
 * 但 gemini 类型也常指向中转网关，因此仍然尝试通用兼容端点。
 */
export function planProviderBalanceSources(input: {
  providerUrl: string;
  providerKey: string;
}): ProviderBalancePlan {
  const hostname = readHostname(input.providerUrl);
  const kimiCurrency: CurrencyCode = hostname
    ? (MOONSHOT_CURRENCY_BY_HOSTNAME[hostname] ?? "CNY")
    : "CNY";

  if (!hostname || !input.providerKey.trim() || isStructuredCredential(input.providerKey)) {
    return { sources: [], kimiCurrency };
  }

  if (OFFICIAL_HOSTNAMES.has(hostname)) {
    return { sources: [], kimiCurrency };
  }

  if (hostname === CHATGPT_HOSTNAME) {
    return { sources: [PROVIDER_BALANCE_SOURCES.ChatGptCredits], kimiCurrency };
  }

  if (hostname === DEEPSEEK_HOSTNAME) {
    return {
      sources: [PROVIDER_BALANCE_SOURCES.DeepSeekBalance, ...GATEWAY_FALLBACK_SOURCES],
      kimiCurrency,
    };
  }

  if (hostname in MOONSHOT_CURRENCY_BY_HOSTNAME) {
    return {
      sources: [PROVIDER_BALANCE_SOURCES.KimiBalance, ...GATEWAY_FALLBACK_SOURCES],
      kimiCurrency,
    };
  }

  return { sources: [...GATEWAY_FALLBACK_SOURCES], kimiCurrency };
}
