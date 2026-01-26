// Ensure File polyfill is loaded before Zod (Zod 4.x checks for File API on initialization)
import "@/lib/polyfills/file";
import { z } from "zod";

/**
 * 布尔值转换函数
 * - 将字符串 "false" 和 "0" 转换为 false
 * - 其他所有值转换为 true
 */
const booleanTransform = (s: string) => s !== "false" && s !== "0";

/**
 * 可选数值解析（支持字符串）
 * - undefined/null/空字符串 -> undefined
 * - 其他 -> 交给 z.coerce.number 处理
 */
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return undefined;
    if (typeof val === "string") return Number(val);
    return val;
  }, schema.optional());

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
  // PostgreSQL 连接池配置（postgres.js）
  // - 多副本部署（k8s）需要结合数据库 max_connections 分摊配置
  // - 这些值为“每个应用进程”的连接池上限
  DB_POOL_MAX: optionalNumber(
    z.number().int().min(1, "DB_POOL_MAX 不能小于 1").max(200, "DB_POOL_MAX 不能大于 200")
  ),
  // 空闲连接回收（秒）
  DB_POOL_IDLE_TIMEOUT: optionalNumber(
    z
      .number()
      .min(0, "DB_POOL_IDLE_TIMEOUT 不能小于 0")
      .max(3600, "DB_POOL_IDLE_TIMEOUT 不能大于 3600")
  ),
  // 建连超时（秒）
  DB_POOL_CONNECT_TIMEOUT: optionalNumber(
    z
      .number()
      .min(1, "DB_POOL_CONNECT_TIMEOUT 不能小于 1")
      .max(120, "DB_POOL_CONNECT_TIMEOUT 不能大于 120")
  ),
  // message_request 写入模式
  // - sync：同步写入（兼容旧行为，但高并发下会增加请求尾部阻塞）
  // - async：异步批量写入（默认，降低 DB 写放大与连接占用）
  MESSAGE_REQUEST_WRITE_MODE: z.enum(["sync", "async"]).default("async"),
  // 异步批量写入参数
  MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: optionalNumber(
    z
      .number()
      .int()
      .min(10, "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS 不能小于 10")
      .max(60000, "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS 不能大于 60000")
  ),
  MESSAGE_REQUEST_ASYNC_BATCH_SIZE: optionalNumber(
    z
      .number()
      .int()
      .min(1, "MESSAGE_REQUEST_ASYNC_BATCH_SIZE 不能小于 1")
      .max(2000, "MESSAGE_REQUEST_ASYNC_BATCH_SIZE 不能大于 2000")
  ),
  MESSAGE_REQUEST_ASYNC_MAX_PENDING: optionalNumber(
    z
      .number()
      .int()
      .min(100, "MESSAGE_REQUEST_ASYNC_MAX_PENDING 不能小于 100")
      .max(200000, "MESSAGE_REQUEST_ASYNC_MAX_PENDING 不能大于 200000")
  ),
  ADMIN_TOKEN: z.preprocess((val) => {
    // 空字符串或 "change-me" 占位符转为 undefined
    if (!val || typeof val !== "string") return undefined;
    if (val === "change-me") return undefined;
    return val;
  }, z.string().min(1, "管理员令牌不能为空").optional()),
  // ⚠️ 注意: 不要使用 z.coerce.boolean(),它会把字符串 "false" 转换为 true!
  // 原因: Boolean("false") === true (任何非空字符串都是 truthy)
  // 正确做法: 使用 transform 显式处理 "false" 和 "0" 字符串
  AUTO_MIGRATE: z.string().default("true").transform(booleanTransform),
  PORT: z.coerce.number().default(23000),
  REDIS_URL: z.string().optional(),
  REDIS_TLS_REJECT_UNAUTHORIZED: z.string().default("true").transform(booleanTransform),
  ENABLE_RATE_LIMIT: z.string().default("true").transform(booleanTransform),
  ENABLE_SECURE_COOKIES: z.string().default("true").transform(booleanTransform),
  SESSION_TTL: z.coerce.number().default(300),
  // 会话消息存储控制
  // - false (默认)：存储请求/响应体但对 message 内容脱敏 [REDACTED]
  // - true：原样存储 message 内容（注意隐私和存储空间影响）
  STORE_SESSION_MESSAGES: z.string().default("false").transform(booleanTransform),
  DEBUG_MODE: z.string().default("false").transform(booleanTransform),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TZ: z.string().default("Asia/Shanghai"),
  ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: z.string().default("false").transform(booleanTransform),
  // 供应商缓存开关
  // - true (默认)：启用进程级缓存，30s TTL，提升供应商查询性能
  // - false：禁用缓存，每次请求直接查询数据库
  ENABLE_PROVIDER_CACHE: z.string().default("true").transform(booleanTransform),
  MAX_RETRY_ATTEMPTS_DEFAULT: z.coerce
    .number()
    .min(1, "MAX_RETRY_ATTEMPTS_DEFAULT 不能小于 1")
    .max(10, "MAX_RETRY_ATTEMPTS_DEFAULT 不能大于 10")
    .default(2),
  // Fetch 超时配置（毫秒）
  FETCH_BODY_TIMEOUT: z.coerce.number().default(600_000), // 请求/响应体传输超时（默认 600 秒）
  FETCH_HEADERS_TIMEOUT: z.coerce.number().default(600_000), // 响应头接收超时（默认 600 秒）
  FETCH_CONNECT_TIMEOUT: z.coerce.number().default(30000), // TCP 连接建立超时（默认 30 秒）
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
