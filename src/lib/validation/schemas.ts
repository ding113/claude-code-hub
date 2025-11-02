import { z } from "zod";
import { PROVIDER_LIMITS, PROVIDER_DEFAULTS } from "@/lib/constants/provider.constants";
import { USER_LIMITS, USER_DEFAULTS } from "@/lib/constants/user.constants";
import { CURRENCY_CONFIG } from "@/lib/utils/currency";

/**
 * 用户创建数据验证schema
 */
export const CreateUserSchema = z.object({
  name: z.string().min(1, "用户名不能为空").max(64, "用户名不能超过64个字符"),
  note: z.string().max(200, "备注不能超过200个字符").optional().default(""),
  providerGroup: z.string().max(50, "供应商分组不能超过50个字符").optional().default(""),
  rpm: z.coerce
    .number()
    .int("RPM必须是整数")
    .min(USER_LIMITS.RPM.MIN, `RPM不能低于${USER_LIMITS.RPM.MIN}`)
    .max(USER_LIMITS.RPM.MAX, `RPM不能超过${USER_LIMITS.RPM.MAX}`)
    .optional()
    .default(USER_DEFAULTS.RPM),
  dailyQuota: z.coerce
    .number()
    .min(USER_LIMITS.DAILY_QUOTA.MIN, `每日额度不能低于${USER_LIMITS.DAILY_QUOTA.MIN}美元`)
    .max(USER_LIMITS.DAILY_QUOTA.MAX, `每日额度不能超过${USER_LIMITS.DAILY_QUOTA.MAX}美元`)
    .optional()
    .default(USER_DEFAULTS.DAILY_QUOTA),
});

/**
 * 用户更新数据验证schema
 */
export const UpdateUserSchema = z.object({
  name: z.string().min(1, "用户名不能为空").max(64, "用户名不能超过64个字符").optional(),
  note: z.string().max(200, "备注不能超过200个字符").optional(),
  providerGroup: z.string().max(50, "供应商分组不能超过50个字符").nullable().optional(),
  rpm: z.coerce
    .number()
    .int("RPM必须是整数")
    .min(USER_LIMITS.RPM.MIN, `RPM不能低于${USER_LIMITS.RPM.MIN}`)
    .max(USER_LIMITS.RPM.MAX, `RPM不能超过${USER_LIMITS.RPM.MAX}`)
    .optional(),
  dailyQuota: z.coerce
    .number()
    .min(USER_LIMITS.DAILY_QUOTA.MIN, `每日额度不能低于${USER_LIMITS.DAILY_QUOTA.MIN}美元`)
    .max(USER_LIMITS.DAILY_QUOTA.MAX, `每日额度不能超过${USER_LIMITS.DAILY_QUOTA.MAX}美元`)
    .optional(),
});

/**
 * 密钥表单数据验证schema
 */
export const KeyFormSchema = z.object({
  name: z.string().min(1, "密钥名称不能为空").max(64, "密钥名称不能超过64个字符"),
  expiresAt: z
    .string()
    .optional()
    .default("")
    .transform((val) => (val === "" ? undefined : val)),
  // Web UI 登录权限控制
  canLoginWebUi: z.boolean().optional().default(true),
  // 金额限流配置
  limit5hUsd: z.coerce
    .number()
    .min(0, "5小时消费上限不能为负数")
    .max(10000, "5小时消费上限不能超过10000美元")
    .nullable()
    .optional(),
  limitWeeklyUsd: z.coerce
    .number()
    .min(0, "周消费上限不能为负数")
    .max(50000, "周消费上限不能超过50000美元")
    .nullable()
    .optional(),
  limitMonthlyUsd: z.coerce
    .number()
    .min(0, "月消费上限不能为负数")
    .max(200000, "月消费上限不能超过200000美元")
    .nullable()
    .optional(),
  limitConcurrentSessions: z.coerce
    .number()
    .int("并发Session上限必须是整数")
    .min(0, "并发Session上限不能为负数")
    .max(1000, "并发Session上限不能超过1000")
    .optional()
    .default(0),
});

/**
 * 服务商创建数据验证schema
 */
export const CreateProviderSchema = z.object({
  name: z.string().min(1, "服务商名称不能为空").max(64, "服务商名称不能超过64个字符"),
  url: z.string().url("请输入有效的URL地址").max(255, "URL长度不能超过255个字符"),
  official_site_url: z
    .string()
    .url("请输入有效的官网地址")
    .max(512, "官网地址长度不能超过512个字符")
    .nullable()
    .optional(),
  key: z.string().min(1, "API密钥不能为空").max(1024, "API密钥长度不能超过1024个字符"),
  // 数据库字段命名：下划线
  is_enabled: z.boolean().optional().default(PROVIDER_DEFAULTS.IS_ENABLED),
  weight: z
    .number()
    .int()
    .min(PROVIDER_LIMITS.WEIGHT.MIN)
    .max(PROVIDER_LIMITS.WEIGHT.MAX)
    .optional()
    .default(PROVIDER_DEFAULTS.WEIGHT),
  priority: z
    .number()
    .int("优先级必须是整数")
    .min(0, "优先级不能为负数")
    .max(2147483647, "优先级超出整数范围")
    .optional()
    .default(0),
  cost_multiplier: z.coerce.number().min(0, "成本倍率不能为负数").optional().default(1.0),
  group_tag: z.string().max(50, "分组标签不能超过50个字符").nullable().optional(),
  // Codex 支持:供应商类型和模型重定向
  provider_type: z
    .enum(["claude", "claude-auth", "codex", "gemini-cli", "openai-compatible"])
    .optional()
    .default("claude"),
  model_redirects: z.record(z.string(), z.string()).nullable().optional(),
  allowed_models: z.array(z.string()).nullable().optional(),
  join_claude_pool: z.boolean().optional().default(false),
  // 金额限流配置
  limit_5h_usd: z.coerce
    .number()
    .min(0, "5小时消费上限不能为负数")
    .max(10000, "5小时消费上限不能超过10000美元")
    .nullable()
    .optional(),
  limit_weekly_usd: z.coerce
    .number()
    .min(0, "周消费上限不能为负数")
    .max(50000, "周消费上限不能超过50000美元")
    .nullable()
    .optional(),
  limit_monthly_usd: z.coerce
    .number()
    .min(0, "月消费上限不能为负数")
    .max(200000, "月消费上限不能超过200000美元")
    .nullable()
    .optional(),
  limit_concurrent_sessions: z.coerce
    .number()
    .int("并发Session上限必须是整数")
    .min(0, "并发Session上限不能为负数")
    .max(1000, "并发Session上限不能超过1000")
    .optional()
    .default(0),
  // 熔断器配置
  circuit_breaker_failure_threshold: z.coerce
    .number()
    .int("失败阈值必须是整数")
    .min(1, "失败阈值不能少于1次")
    .max(100, "失败阈值不能超过100次")
    .optional(),
  circuit_breaker_open_duration: z.coerce
    .number()
    .int("熔断时长必须是整数")
    .min(1000, "熔断时长不能少于1秒")
    .max(86400000, "熔断时长不能超过24小时")
    .optional(),
  circuit_breaker_half_open_success_threshold: z.coerce
    .number()
    .int("恢复阈值必须是整数")
    .min(1, "恢复阈值不能少于1次")
    .max(10, "恢复阈值不能超过10次")
    .optional(),
  // 代理配置
  proxy_url: z.string().max(512, "代理地址长度不能超过512个字符").nullable().optional(),
  proxy_fallback_to_direct: z.boolean().optional().default(false),
  // 废弃字段（保留向后兼容，不再验证范围）
  tpm: z.number().int().nullable().optional(),
  rpm: z.number().int().nullable().optional(),
  rpd: z.number().int().nullable().optional(),
  cc: z.number().int().nullable().optional(),
});

/**
 * 服务商更新数据验证schema
 */
export const UpdateProviderSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    url: z.string().url().max(255).optional(),
    official_site_url: z
      .string()
      .url("请输入有效的官网地址")
      .max(512, "官网地址长度不能超过512个字符")
      .nullable()
      .optional(),
    key: z.string().min(1).max(1024).optional(),
    is_enabled: z.boolean().optional(),
    weight: z
      .number()
      .int()
      .min(PROVIDER_LIMITS.WEIGHT.MIN)
      .max(PROVIDER_LIMITS.WEIGHT.MAX)
      .optional(),
    priority: z
      .number()
      .int("优先级必须是整数")
      .min(0, "优先级不能为负数")
      .max(2147483647, "优先级超出整数范围")
      .optional(),
    cost_multiplier: z.coerce.number().min(0, "成本倍率不能为负数").optional(),
    group_tag: z.string().max(50, "分组标签不能超过50个字符").nullable().optional(),
    // Codex 支持:供应商类型和模型重定向
    provider_type: z
      .enum(["claude", "claude-auth", "codex", "gemini-cli", "openai-compatible"])
      .optional(),
    model_redirects: z.record(z.string(), z.string()).nullable().optional(),
    allowed_models: z.array(z.string()).nullable().optional(),
    join_claude_pool: z.boolean().optional(),
    // 金额限流配置
    limit_5h_usd: z.coerce
      .number()
      .min(0, "5小时消费上限不能为负数")
      .max(10000, "5小时消费上限不能超过10000美元")
      .nullable()
      .optional(),
    limit_weekly_usd: z.coerce
      .number()
      .min(0, "周消费上限不能为负数")
      .max(50000, "周消费上限不能超过50000美元")
      .nullable()
      .optional(),
    limit_monthly_usd: z.coerce
      .number()
      .min(0, "月消费上限不能为负数")
      .max(200000, "月消费上限不能超过200000美元")
      .nullable()
      .optional(),
    limit_concurrent_sessions: z.coerce
      .number()
      .int("并发Session上限必须是整数")
      .min(0, "并发Session上限不能为负数")
      .max(1000, "并发Session上限不能超过1000")
      .optional(),
    // 熔断器配置
    circuit_breaker_failure_threshold: z.coerce
      .number()
      .int("失败阈值必须是整数")
      .min(1, "失败阈值不能少于1次")
      .max(100, "失败阈值不能超过100次")
      .optional(),
    circuit_breaker_open_duration: z.coerce
      .number()
      .int("熔断时长必须是整数")
      .min(1000, "熔断时长不能少于1秒")
      .max(86400000, "熔断时长不能超过24小时")
      .optional(),
    circuit_breaker_half_open_success_threshold: z.coerce
      .number()
      .int("恢复阈值必须是整数")
      .min(1, "恢复阈值不能少于1次")
      .max(10, "恢复阈值不能超过10次")
      .optional(),
    // 代理配置
    proxy_url: z.string().max(512, "代理地址长度不能超过512个字符").nullable().optional(),
    proxy_fallback_to_direct: z.boolean().optional(),
    // 废弃字段（保留向后兼容，不再验证范围）
    tpm: z.number().int().nullable().optional(),
    rpm: z.number().int().nullable().optional(),
    rpd: z.number().int().nullable().optional(),
    cc: z.number().int().nullable().optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: "更新内容为空" });

/**
 * 系统设置更新数据验证schema
 */
export const UpdateSystemSettingsSchema = z.object({
  siteTitle: z.string().min(1, "站点标题不能为空").max(128, "站点标题不能超过128个字符"),
  allowGlobalUsageView: z.boolean(),
  currencyDisplay: z
    .enum(
      Object.keys(CURRENCY_CONFIG) as [
        keyof typeof CURRENCY_CONFIG,
        ...Array<keyof typeof CURRENCY_CONFIG>,
      ],
      { message: "不支持的货币类型" }
    )
    .optional(),
  // 日志清理配置（可选）
  enableAutoCleanup: z.boolean().optional(),
  cleanupRetentionDays: z.coerce
    .number()
    .int("保留天数必须是整数")
    .min(1, "保留天数不能少于1天")
    .max(365, "保留天数不能超过365天")
    .optional(),
  cleanupSchedule: z.string().min(1, "执行时间不能为空").optional(),
  cleanupBatchSize: z.coerce
    .number()
    .int("批量大小必须是整数")
    .min(1000, "批量大小不能少于1000")
    .max(100000, "批量大小不能超过100000")
    .optional(),
});

// 导出类型推断
