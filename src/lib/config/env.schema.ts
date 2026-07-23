// Ensure File polyfill is loaded before Zod (Zod 4.x checks for File API on initialization)
import "@/lib/polyfills/file";
import { z } from "zod";

/**
 * 布尔值转换函数
 * - 将字符串 "false" 和 "0" 转换为 false
 * - 其他所有值转换为 true
 */
const booleanTransform = (s: string) => s !== "false" && s !== "0";

const optionalPreprocessed = <T extends z.ZodType>(
  preprocess: (value: unknown) => unknown,
  schema: T
) => z.preprocess(preprocess, z.union([schema, z.undefined()])).optional();

/**
 * 可选数值解析（支持字符串）
 * - undefined/null/空字符串 -> undefined
 * - 其他 -> 交给 z.coerce.number 处理
 */
const optionalNumber = (schema: z.ZodNumber) =>
  optionalPreprocessed((val) => {
    if (val === undefined || val === null || val === "") return undefined;
    if (typeof val === "string") return Number(val);
    return val;
  }, schema);

/**
 * 环境变量验证schema
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DSN: optionalPreprocessed((val) => {
    // 构建时如果 DSN 为空或是占位符,转为 undefined
    if (!val || typeof val !== "string") return undefined;
    if (val.includes("user:password@host:port")) return undefined; // 占位符模板
    return val;
  }, z.string().url("数据库URL格式无效")),
  // PostgreSQL 连接池配置（postgres.js）
  // - 多副本部署（k8s）需要结合数据库 max_connections 分摊配置
  // - DB_POOL_MAX 是每个应用进程内 data/control/writer 三类 pool 的连接总预算
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
  // 活动语句超时（毫秒），必须早于流式结算的 120 秒应用层 deadline
  DB_STATEMENT_TIMEOUT_MS: optionalNumber(
    z
      .number()
      .int()
      .min(1000, "DB_STATEMENT_TIMEOUT_MS 不能小于 1000")
      .max(119000, "DB_STATEMENT_TIMEOUT_MS 不能大于 119000")
  ).default(90_000),
  // 等待数据库锁的最长时间（毫秒）
  DB_LOCK_TIMEOUT_MS: optionalNumber(
    z
      .number()
      .int()
      .min(100, "DB_LOCK_TIMEOUT_MS 不能小于 100")
      .max(60000, "DB_LOCK_TIMEOUT_MS 不能大于 60000")
  ).default(5_000),
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
  ADMIN_TOKEN: optionalPreprocessed(
    (val) => {
      // 空字符串或 "change-me" 占位符转为 undefined
      if (!val || typeof val !== "string") return undefined;
      if (val === "change-me") return undefined;
      return val;
    },
    z.string().min(1, "管理员令牌不能为空")
  ),
  CSRF_SECRET: optionalPreprocessed(
    (val) => {
      // 独立于 ADMIN_TOKEN 的管理 API CSRF 签名密钥，空值与占位符视为未配置
      if (!val || typeof val !== "string") return undefined;
      if (val === "change-me") return undefined;
      return val;
    },
    z.string().min(16, "CSRF_SECRET 至少需要 16 个字符")
  ),
  // ⚠️ 注意: 不要使用 z.coerce.boolean(),它会把字符串 "false" 转换为 true!
  // 原因: Boolean("false") === true (任何非空字符串都是 truthy)
  // 正确做法: 使用 transform 显式处理 "false" 和 "0" 字符串
  AUTO_MIGRATE: z.string().default("true").transform(booleanTransform),
  PORT: z.coerce.number().default(23000),
  REDIS_URL: z.string().optional(),
  REDIS_TLS_REJECT_UNAUTHORIZED: z.string().default("true").transform(booleanTransform),
  REDIS_COMMAND_TIMEOUT_MS: optionalNumber(
    z
      .number()
      .int()
      .min(100, "REDIS_COMMAND_TIMEOUT_MS 不能小于 100")
      .max(120000, "REDIS_COMMAND_TIMEOUT_MS 不能大于 120000")
  ).default(10_000),
  ENABLE_RATE_LIMIT: z.string().default("true").transform(booleanTransform),
  ENABLE_SECURE_COOKIES: z.string().default("true").transform(booleanTransform),
  ENABLE_LEGACY_ACTIONS_API: z.string().default("true").transform(booleanTransform),
  LEGACY_ACTIONS_DOCS_MODE: z.enum(["deprecated", "hidden"]).default("deprecated"),
  LEGACY_ACTIONS_SUNSET_DATE: z.string().default("2026-12-31"),
  ENABLE_API_KEY_ADMIN_ACCESS: z.string().default("false").transform(booleanTransform),
  SESSION_TOKEN_MODE: z.enum(["legacy", "dual", "opaque"]).default("opaque"),
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60, "AUTH_SESSION_TTL_SECONDS 不能小于 60")
    .max(31_536_000, "AUTH_SESSION_TTL_SECONDS 不能大于 31536000")
    .default(604_800),
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

  // 竞速输家计费：后台 drain 竞速输家响应体以拿回 token 用量时的最大等待时长（毫秒）。
  // 超时后主动断开该输家连接，仅用已收到的内容尝试计费（通常计不出 -> 跳过）。
  HEDGE_LOSER_DRAIN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),

  // ===== CCHP 网关移植功能开关 =====
  // 流式内容门控：off=关闭；shadow=旁路分类只记录分歧；enforce=首个有效内容帧前缓冲+failover
  STREAM_GATE_MODE: z.enum(["off", "shadow", "enforce"]).default("off"),
  // 门控 precommit 缓冲上限：超限即视为该供应商流异常，failover 释放内存
  // （字节计数排除请求回显帧，见 stream-gate/frame-classifier.ts isRequestEchoFrame）
  STREAM_GATE_PREBUFFER_EVENT_CAP: z.coerce.number().int().min(1).max(4096).default(64),
  STREAM_GATE_PREBUFFER_BYTE_CAP: z.coerce
    .number()
    .int()
    .min(1024)
    .max(64 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  // 请求分离 + Replay：客户端断开后上游继续引流缓存，相同请求体重发续传
  ENABLE_REQUEST_REPLAY: z.string().default("false").transform(booleanTransform),
  // owner 客户端仍在线时的并发相同请求去重（attached-live）；关闭后仅 detached/completed 可命中
  REPLAY_LIVE_DEDUP_ENABLED: z.string().default("true").transform(booleanTransform),
  // 客户端断开后上游继续引流的最长时长（毫秒；替代默认 60s drain 上限）
  REPLAY_MAX_DETACHED_MS: z.coerce.number().int().min(10_000).max(1_800_000).default(300_000),
  // 单节点并发 spool 上限（超出的请求不做 replay，回退现状）
  REPLAY_MAX_CONCURRENT_SPOOLS: z.coerce.number().int().min(1).max(1024).default(64),
  // Redis 热层 TTL（活跃/刚完成的响应块与元数据）
  REPLAY_TTL_SECONDS: z.coerce.number().int().min(60).max(7200).default(600),
  // PG 完成持久层 TTL（跨小时级重放窗口）
  REPLAY_COMPLETED_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  // 单响应缓存上限（超限即放弃 spool，fail-open 回现状）
  REPLAY_MAX_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(64 * 1024 * 1024)
    .default(8 * 1024 * 1024),
  // 最长前缀亲和路由：链式指纹匹配的供应商粘性（软提名，仍走全套硬校验）
  ENABLE_PREFIX_AFFINITY: z.string().default("false").transform(booleanTransform),
  // 亲和绑定滑动 TTL（秒）：读即续期，目标是把供应商粘性拉长到接近 prompt cache 保留期
  PREFIX_AFFINITY_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  // 指纹链回看窗口（尾部边界数）：覆盖编辑回退场景的拐点，超过 8 收益递减
  PREFIX_AFFINITY_WINDOW: z.coerce.number().int().min(1).max(64).default(8),
  // 缓存效果计费模拟：理论 vs 实际缓存命中率聚合指标（仅展示，不影响路由，默认开启）
  ENABLE_CACHE_EFFECTIVENESS: z.string().default("true").transform(booleanTransform),

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

export function isLegacyActionsApiEnabled(): boolean {
  return getEnvConfig().ENABLE_LEGACY_ACTIONS_API;
}

export function isApiKeyAdminAccessEnabled(): boolean {
  return getEnvConfig().ENABLE_API_KEY_ADMIN_ACCESS;
}
