/**
 * 供应商配置相关常量
 */
export const PROVIDER_LIMITS = {
  // 权重：用于加权轮询，1-100 覆盖绝大多数场景
  WEIGHT: { MIN: 1, MAX: 100 },
  // 单个供应商最大重试次数
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  // 5小时消费上限：保持 1000 USD 上限，步进 1 美元
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  // 周消费上限：降低到 5000 USD，步进 1 美元
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  // 月消费上限：降低到 30000 USD，步进 1 美元
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  // 并发 Session 上限：降低到 150（单供应商合理上限）
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;

export const PROVIDER_RULE_LIMITS = {
  // 模型白名单 / 重定向规则保存在 JSONB 中，这里统一放宽到支持大规模路由表
  MAX_ITEMS: 100_000,
  MAX_TEXT_LENGTH: 4_096,
} as const;

// 供应商 API 密钥最大长度（字符数），取宽松上限即可
export const PROVIDER_KEY_MAX_LENGTH = 1024 * 1024;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: true,
  WEIGHT: 1,
  // Single attempt only: fail → switch provider immediately (no same-provider retry).
  MAX_RETRY_ATTEMPTS: 1,
} as const;

export const CODEX_IMAGE_GENERATION_PREFERENCE_VALUES = ["inherit", "true", "false"] as const;

export const PROVIDER_GROUP = {
  /** 默认分组标识符 - 用于表示未设置分组的 key/供应商 */
  DEFAULT: "default",
  /** 全局访问标识符 - 可访问所有供应商（管理员专用） */
  ALL: "*",
} as const;
