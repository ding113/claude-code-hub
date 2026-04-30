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
  SESSION_TOKEN_MODE: z.enum(["legacy", "dual", "opaque"]).default("opaque"),
  SESSION_TTL: z.coerce.number().default(300),
  // 会话消息存储控制
  // - false (默认)：存储请求/响应体但对 message 内容脱敏 [REDACTED]
  // - true：原样存储 message 内容（注意隐私和存储空间影响）
  STORE_SESSION_MESSAGES: z.string().default("false").transform(booleanTransform),
  // 会话响应体存储开关
  // - true (默认)：存储响应体（SSE/JSON），用于调试/回放/问题定位（Redis 临时缓存，默认 5 分钟）
  // - false：不存储响应体（注意：不影响本次请求处理；仅影响后续在 UI/诊断中查看 response body）
  //
  // 说明：
  // - 该开关只影响“写入 Redis 的响应体内容”，不影响内部统计逻辑读取响应体（例如 tokens/费用统计、SSE 结束后的假 200 检测）。
  // - message 内容是否脱敏仍由 STORE_SESSION_MESSAGES 控制。
  STORE_SESSION_RESPONSE_BODY: z.string().default("true").transform(booleanTransform),
  DEBUG_MODE: z.string().default("false").transform(booleanTransform),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TZ: z.string().default("Asia/Shanghai"),
  ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: z.string().default("false").transform(booleanTransform),
  // 端点级别熔断器开关
  // - false (默认)：禁用端点熔断器，所有端点均可使用
  // - true：启用端点熔断器，连续失败的端点会被临时屏蔽
  ENABLE_ENDPOINT_CIRCUIT_BREAKER: z.string().default("false").transform(booleanTransform),
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

  DASHBOARD_LOGS_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(5000),

  // Langfuse Observability (optional, auto-enabled when keys are set)
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().default("https://cloud.langfuse.com"),
  LANGFUSE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1.0),
  LANGFUSE_DEBUG: z.string().default("false").transform(booleanTransform),

  // IP 归属地查询服务
  // 默认使用官方托管服务；可通过 IP_GEO_API_URL 自托管
  IP_GEO_API_URL: z.string().default("https://ip-api.claude-code-hub.app"),
  IP_GEO_API_TOKEN: z.string().optional(),
  IP_GEO_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  IP_GEO_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(1500),

  // ==================== 管理 API 迁移（v1）开关 ====================
  // 是否启用旧版 /api/actions/* 管理接口
  // - true (默认)：旧接口仍可调用，但响应会附带 Deprecation/Sunset/Link/Warning 头
  // - false：旧接口的「执行端点」直接返回 410 Gone（problem+json），文档行为由 LEGACY_ACTIONS_DOCS_MODE 决定
  ENABLE_LEGACY_ACTIONS_API: z
    .string()
    .default("true")
    .transform(booleanTransform)
    .describe("是否启用旧版 /api/actions/* 管理接口（默认开启，迁移期保持向后兼容）"),
  // 旧版管理接口的文档展示模式
  // - deprecated (默认)：仍提供 /api/actions/openapi.json /docs /scalar，但响应附带 deprecation 头
  // - hidden：返回 404，引导调用方迁移到 /api/v1
  LEGACY_ACTIONS_DOCS_MODE: z
    .enum(["deprecated", "hidden"])
    .default("deprecated")
    .describe("旧版 /api/actions/* 文档路由展示模式（deprecated 仍可访问，hidden 返回 404）"),
  // 旧版管理接口的下线日期（YYYY-MM-DD），写入 Sunset 响应头
  LEGACY_ACTIONS_SUNSET_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "LEGACY_ACTIONS_SUNSET_DATE 必须为 YYYY-MM-DD 格式")
    // 仅校验「正则可通过」并不能拦下 2026-02-30 这种历法非法日期；这里再做一层
    // 真实日期校验，避免下游构造 `Sunset` 头时收到无意义的日期。
    .refine((value) => {
      const d = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
    }, "LEGACY_ACTIONS_SUNSET_DATE 必须是有效日历日期")
    .default("2026-12-31")
    .describe("旧版 /api/actions/* 计划下线日期（ISO 日期，写入 Sunset 响应头）"),
  // 是否允许使用 API Key（X-Api-Key 头）访问管理接口
  // - false (默认)：仅允许 Cookie/Bearer 认证（沿用现有行为）
  // - true：允许通过 X-Api-Key 头访问 /api/v1/* 管理接口（用于第三方系统集成）
  ENABLE_API_KEY_ADMIN_ACCESS: z
    .string()
    .default("false")
    .transform(booleanTransform)
    .describe("是否允许通过 API Key（X-Api-Key 头）访问管理接口（默认关闭）"),
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
 * 重置已缓存的环境变量配置（仅供测试使用）
 *
 * 配合 vi.stubEnv / vi.unstubAllEnvs 使用：
 * - 测试 setUp 中：调整 process.env 后调用以丢弃旧的解析结果
 * - 测试 tearDown 中：调用以避免泄漏到其他测试
 */
export function resetEnvConfigForTests(): void {
  _envConfig = null;
}

/**
 * 检查是否为开发环境
 */
export function isDevelopment(): boolean {
  return getEnvConfig().NODE_ENV === "development";
}

/**
 * 检查是否启用旧版 /api/actions/* 管理接口
 */
export function isLegacyActionsApiEnabled(): boolean {
  return getEnvConfig().ENABLE_LEGACY_ACTIONS_API;
}

/**
 * 检查是否允许通过 API Key 访问管理接口
 */
export function isApiKeyAdminAccessEnabled(): boolean {
  return getEnvConfig().ENABLE_API_KEY_ADMIN_ACCESS;
}

/**
 * 获取旧版 /api/actions/* 计划下线日期（YYYY-MM-DD）
 */
export function getLegacyActionsSunsetDate(): string {
  return getEnvConfig().LEGACY_ACTIONS_SUNSET_DATE;
}

/**
 * 获取旧版 /api/actions/* 文档展示模式
 */
export function getLegacyActionsDocsMode(): "deprecated" | "hidden" {
  return getEnvConfig().LEGACY_ACTIONS_DOCS_MODE;
}
