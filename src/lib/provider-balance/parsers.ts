// 上游余额响应解析器
//
// 所有函数都是纯函数：输入上游 JSON，输出归一化的 ProviderBalancePatch。
// 无法解析出任何字段时返回空对象，由调用方判定为「该来源不可用」。

import type { CurrencyCode } from "@/lib/utils/currency";
import type { ProviderBalancePatch } from "@/types/provider-balance";
import { NEW_API_QUOTA_PER_USD, OPENAI_BILLING_SENTINEL_LIMIT_USD } from "./endpoints";

/** 余额展示支持的上游币种 */
const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = [
  "USD",
  "CNY",
  "EUR",
  "JPY",
  "GBP",
  "HKD",
  "TWD",
  "KRW",
  "SGD",
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 剥掉上游常见的 { data: ... } 信封 */
export function unwrapEnvelope(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.data)) return value.data;
  return value;
}

/** 读取数值字段，兼容字符串形式的金额 */
export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** 把上游币种字符串归一化到本项目支持的币种 */
export function readCurrency(value: unknown, fallback: CurrencyCode): CurrencyCode {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.find((code) => code === normalized) ?? fallback;
}

/** 把秒或毫秒时间戳统一成毫秒 */
export function normalizeTimestamp(value: unknown): number | undefined {
  const parsed = readNumber(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return parsed < 1e12 ? parsed * 1000 : parsed;
}

/** New API 额度单位转换成 USD，负值按 0 处理 */
export function quotaToUsd(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, value) / NEW_API_QUOTA_PER_USD;
}

/**
 * 解析 New API / One API 家族的 /api/usage/token/ 响应。
 *
 * total_granted 为负数或 unlimited_quota 为 true 时表示令牌额度不限量。
 */
export function parseNewApiTokenUsage(json: unknown): ProviderBalancePatch {
  const data = unwrapEnvelope(json);
  const totalGranted = readNumber(data.total_granted);
  const totalUsed = readNumber(data.total_used);
  const totalAvailable = readNumber(data.total_available);

  if (totalGranted === undefined && totalUsed === undefined && totalAvailable === undefined) {
    return {};
  }

  const unlimited =
    data.unlimited_quota === true || (totalGranted !== undefined && totalGranted < 0);
  const expiresAt = normalizeTimestamp(data.expires_at);

  return {
    currency: "USD",
    ...(unlimited ? { unlimited: true } : {}),
    ...(unlimited || quotaToUsd(totalAvailable) === undefined
      ? {}
      : { balance: quotaToUsd(totalAvailable) }),
    ...(quotaToUsd(totalUsed) === undefined ? {} : { totalUsed: quotaToUsd(totalUsed) }),
    ...(unlimited || quotaToUsd(totalGranted) === undefined
      ? {}
      : { totalGranted: quotaToUsd(totalGranted) }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

/**
 * 解析 OpenAI 兼容计费端点。
 *
 * subscription 直接给出 balance 时优先使用；否则用 hard_limit_usd 减去
 * usage 端点报告的累计用量。usage 的 total_usage 单位是美分。
 */
export function parseOpenAiBilling(subscription: unknown, usage: unknown): ProviderBalancePatch {
  const subscriptionData = unwrapEnvelope(subscription);
  const usageData = unwrapEnvelope(usage);

  const directBalance = readNumber(subscriptionData.balance);
  if (directBalance !== undefined) {
    return { balance: directBalance, currency: "USD" };
  }

  const hardLimit = readNumber(subscriptionData.hard_limit_usd);
  const totalUsageCents = readNumber(usageData.total_usage);
  const usedUsd =
    totalUsageCents === undefined ? readNumber(usageData.used_usd) : totalUsageCents / 100;

  if (hardLimit !== undefined && hardLimit >= OPENAI_BILLING_SENTINEL_LIMIT_USD) {
    return usedUsd === undefined ? {} : { totalUsed: usedUsd, currency: "USD", unlimited: true };
  }

  if (hardLimit === undefined && usedUsd === undefined) {
    return {};
  }

  return {
    currency: "USD",
    ...(hardLimit !== undefined && usedUsd !== undefined
      ? { balance: Math.max(0, hardLimit - usedUsd) }
      : {}),
    ...(hardLimit === undefined ? {} : { totalGranted: hardLimit }),
    ...(usedUsd === undefined ? {} : { totalUsed: usedUsd }),
  };
}

/**
 * 解析 DeepSeek 开放平台 /user/balance 响应。
 *
 * balance_infos 按币种分条返回，取第一条余额非零的记录；全部为零时取第一条。
 */
export function parseDeepSeekBalance(json: unknown): ProviderBalancePatch {
  const record = unwrapEnvelope(json);
  if (!Array.isArray(record.balance_infos)) return {};

  const infos = record.balance_infos.filter(isRecord).flatMap((info) => {
    const amount = readNumber(info.total_balance);
    if (amount === undefined) return [];
    return [
      {
        balance: amount,
        currency: readCurrency(info.currency, "CNY"),
        totalGranted: readNumber(info.granted_balance),
      },
    ];
  });

  const chosen = infos.find((info) => info.balance !== 0) ?? infos[0];
  if (!chosen) return {};

  return {
    balance: chosen.balance,
    currency: chosen.currency,
    ...(chosen.totalGranted === undefined ? {} : { totalGranted: chosen.totalGranted }),
  };
}

/**
 * 解析 Moonshot / Kimi 开放平台 /v1/users/me/balance 响应。
 *
 * api.moonshot.ai 以美元结算，api.moonshot.cn 以人民币结算。
 */
export function parseKimiBalance(json: unknown, currency: CurrencyCode): ProviderBalancePatch {
  const envelope = isRecord(json) ? json : {};
  if (envelope.status !== true || (envelope.code !== 0 && envelope.code !== "0")) {
    return {};
  }

  const data = unwrapEnvelope(json);
  const available = readNumber(data.available_balance);
  if (available === undefined) return {};

  const voucher = readNumber(data.voucher_balance);

  return {
    balance: available,
    currency,
    ...(voucher === undefined ? {} : { totalGranted: voucher }),
  };
}

/**
 * 解析 ChatGPT 后端 /backend-api/wham/usage 响应。
 *
 * credits.balance 以字符串形式返回美元余额，unlimited 为 true 时表示额度不限量。
 */
export function parseChatGptWhamUsage(json: unknown): ProviderBalancePatch {
  const record = isRecord(json) ? json : {};
  const credits = isRecord(record.credits) ? record.credits : null;
  if (!credits) return {};

  if (credits.unlimited === true) {
    return { unlimited: true, currency: "USD" };
  }

  const balance = readNumber(credits.balance);
  if (balance === undefined) return {};

  return { balance, currency: "USD" };
}

/** 判定一次解析是否产出了可展示的数据 */
export function hasBalanceData(patch: ProviderBalancePatch): boolean {
  return (
    patch.balance !== undefined ||
    patch.totalGranted !== undefined ||
    patch.totalUsed !== undefined ||
    patch.unlimited === true
  );
}
