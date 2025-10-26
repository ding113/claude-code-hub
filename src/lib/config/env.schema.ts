import { z } from "zod";

/**
 * 环境变量验证schema
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DSN: z.preprocess((val) => {
    // 构建时如果 DSN 为空或是占位符,转为 undefined
    if (!val || typeof val !== "string") return undefined;
    if (val.includes("user:password@host:port")) return undefined; // 占位符模板
    return val;
  }, z.string().url("数据库URL格式无效").optional()),
  ADMIN_TOKEN: z.preprocess((val) => {
    // 空字符串或 "change-me" 占位符转为 undefined
    if (!val || typeof val !== "string") return undefined;
    if (val === "change-me") return undefined;
    return val;
  }, z.string().min(1, "管理员令牌不能为空").optional()),
  AUTO_MIGRATE: z.coerce.boolean().default(true),
  PORT: z.coerce.number().default(23000),
  REDIS_URL: z.string().optional(),
  ENABLE_RATE_LIMIT: z.coerce.boolean().default(true),
  ENABLE_SECURE_COOKIES: z.coerce.boolean().default(true),
  SESSION_TTL: z.coerce.number().default(300),
  DEBUG_MODE: z.coerce.boolean().default(false),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TZ: z.string().default("Asia/Shanghai"),
});

/**
 * 环境变量类型
 */
export type EnvConfig = z.infer<typeof EnvSchema>;

/**
 * 获取环境变量（带类型安全）
 */
let _envConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!_envConfig) {
    _envConfig = EnvSchema.parse(process.env);
  }
  return _envConfig;
}

/**
 * 检查是否为开发环境
 */
export function isDevelopment(): boolean {
  return getEnvConfig().NODE_ENV === "development";
}
