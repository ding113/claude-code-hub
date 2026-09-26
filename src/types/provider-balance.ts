// 供应商余额查询类型定义
//
// 余额来自上游服务商的只读端点，默认使用供应商自身配置的密钥查询；
// 配置了 New API 系统访问令牌的供应商改用该令牌查询账户余额。
// 每个来源对应一种上游协议，详见 src/lib/provider-balance/endpoints.ts。

import type { CurrencyCode } from "@/lib/utils/currency";

/** 余额查询来源，对应一种上游只读协议 */
export const PROVIDER_BALANCE_SOURCES = {
  NewApiTokenUsage: "new-api-token-usage",
  NewApiAccount: "new-api-account",
  Sub2ApiUsage: "sub2api-usage",
  OpenAiBilling: "openai-billing",
  DeepSeekBalance: "deepseek-balance",
  KimiBalance: "kimi-balance",
  ChatGptCredits: "chatgpt-credits",
} as const;

export type ProviderBalanceSource =
  (typeof PROVIDER_BALANCE_SOURCES)[keyof typeof PROVIDER_BALANCE_SOURCES];

/** 余额查询结果状态 */
export const PROVIDER_BALANCE_STATUSES = {
  /** 查询成功且拿到了可展示的数值 */
  Ok: "ok",
  /** 上游没有提供任何可用的余额端点 */
  Unsupported: "unsupported",
  /** 查询失败，errorCode 说明原因 */
  Error: "error",
} as const;

export type ProviderBalanceStatus =
  (typeof PROVIDER_BALANCE_STATUSES)[keyof typeof PROVIDER_BALANCE_STATUSES];

/** 余额查询失败原因，客户端据此翻译展示文案 */
export const PROVIDER_BALANCE_ERROR_CODES = {
  Unauthorized: "unauthorized",
  /** New API 拒绝了系统访问令牌或用户 ID */
  AccessTokenRejected: "access_token_rejected",
  Forbidden: "forbidden",
  RateLimited: "rate_limited",
  UpstreamError: "upstream_error",
  InvalidResponse: "invalid_response",
  Timeout: "timeout",
  Network: "network",
  InvalidUrl: "invalid_url",
} as const;

export type ProviderBalanceErrorCode =
  (typeof PROVIDER_BALANCE_ERROR_CODES)[keyof typeof PROVIDER_BALANCE_ERROR_CODES];

/**
 * 一个供应商的余额快照。
 *
 * balance 使用上游原生币种（currency 标明），不做汇率换算：
 * 换算需要实时汇率，任何内置汇率都会让展示值和上游账单对不上。
 */
export interface ProviderBalanceSnapshot {
  providerId: number;
  status: ProviderBalanceStatus;
  source: ProviderBalanceSource | null;
  /** 剩余可用额度；unlimited 为 true 或查询失败时为 null */
  balance: number | null;
  currency: CurrencyCode;
  /** 累计授予额度 */
  totalGranted: number | null;
  /** 累计已使用额度 */
  totalUsed: number | null;
  /** 上游声明额度不限量 */
  unlimited: boolean;
  /** 密钥过期时间（ISO 字符串） */
  expiresAt: string | null;
  /** 本次查询完成时间（ISO 字符串） */
  checkedAt: string;
  errorCode: ProviderBalanceErrorCode | null;
}

/** 供应商 ID 到余额快照的映射 */
export type ProviderBalanceMap = Record<number, ProviderBalanceSnapshot>;

/** 单次批量查询可携带的供应商数量上限 */
export const PROVIDER_BALANCE_BATCH_LIMIT = 50;

/** 探测适配器输出的中间结果，归一化后写入快照 */
export interface ProviderBalancePatch {
  balance?: number;
  currency?: CurrencyCode;
  totalGranted?: number;
  totalUsed?: number;
  unlimited?: boolean;
  /** 毫秒时间戳 */
  expiresAt?: number;
}
