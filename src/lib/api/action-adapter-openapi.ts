/**
 * OpenAPI Action Adapter
 * 将 Server Actions 转换为带文档的 OpenAPI 端点
 *
 * 核心功能:
 * - 自动从 Zod schemas 生成 OpenAPI 文档
 * - 统一的错误处理和日志记录
 * - 参数验证和类型安全
 */

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ActionResult } from "@/actions/types";
import { CSRF_HEADER } from "@/lib/api/v1/_shared/constants";
import { isMutationMethod, verifyCsrfToken } from "@/lib/api/v1/_shared/csrf";
import { redactHeaderRecord, redactUrlCredentials } from "@/lib/api/v1/_shared/redaction";
import { runWithRequestContext } from "@/lib/audit/request-context";
import {
  AUTH_COOKIE_NAME,
  type AuthCredentialType,
  detectSessionTokenKind,
  runWithAuthSession,
  validateAuthToken,
} from "@/lib/auth";
import { config } from "@/lib/config/config";
import { isApiKeyAdminAccessEnabled } from "@/lib/config/env.schema";
import { getClientIp } from "@/lib/ip";
import { logger } from "@/lib/logger";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";

function getBearerTokenFromAuthHeader(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = match?.[1]?.trim();
  return token || undefined;
}

function getAuthCookieFromHeader(raw: string | null | undefined): string | undefined {
  const cookiePairs = raw?.split(";") ?? [];
  for (const pair of cookiePairs) {
    const [name, ...valueParts] = pair.trim().split("=");
    if (name !== AUTH_COOKIE_NAME) continue;
    const value = valueParts.join("=").trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function redactManagementBody(body: unknown): unknown {
  return redactManagementValue(body);
}

function redactIfPresent(value: unknown): unknown {
  return value ? "[REDACTED]" : value;
}

function redactManagementValue(value: unknown, keyName?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactManagementValue(item));
  }
  if (!value || typeof value !== "object") {
    return redactScalarValue(keyName, value);
  }

  if (isHeaderKey(keyName)) {
    return redactHeaderRecord(asHeaderRecord(value));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      redactManagementValue(child, key),
    ])
  );
}

function redactScalarValue(keyName: string | undefined, value: unknown): unknown {
  if (isSensitiveScalarKey(keyName)) return redactIfPresent(value);
  if (isUrlSecretKey(keyName) && typeof value === "string") {
    return keyName?.toLowerCase().includes("webhook") ? "[REDACTED]" : redactUrlCredentials(value);
  }
  return value;
}

function normalizeManagementKeyName(keyName: string | undefined): string | undefined {
  return keyName?.replace(/_/g, "").toLowerCase();
}

function isSensitiveScalarKey(keyName: string | undefined): boolean {
  const normalized = normalizeManagementKeyName(keyName);
  return (
    normalized === "apikey" ||
    normalized === "key" ||
    normalized === "telegrambottoken" ||
    normalized === "dingtalksecret"
  );
}

function isUrlSecretKey(keyName: string | undefined): boolean {
  const normalized = normalizeManagementKeyName(keyName);
  if (!normalized) return false;
  return (
    normalized.includes("webhook") ||
    ["url", "providerurl", "websiteurl", "proxyurl", "mcppassthroughurl"].includes(normalized)
  );
}

function isHeaderKey(keyName: string | undefined): boolean {
  return normalizeManagementKeyName(keyName) === "customheaders";
}

function asHeaderRecord(value: unknown): Record<string, string> | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, string>;
}

function isLegacyBearerUserApiKey(token: string, source: "bearer" | "cookie"): boolean {
  if (source !== "bearer") return false;
  if (config.auth.adminToken && constantTimeEqual(token, config.auth.adminToken)) return false;
  return detectSessionTokenKind(token) === "legacy";
}

async function classifyLegacyManagementCredential(
  token: string,
  source: "bearer" | "cookie"
): Promise<AuthCredentialType> {
  if (config.auth.adminToken && constantTimeEqual(token, config.auth.adminToken)) {
    return "admin-token";
  }

  if (detectSessionTokenKind(token) === "opaque") {
    return classifyOpaqueLegacyManagementCredential(token);
  }

  // 维持旧接口兼容：只把 bearer 形式的 legacy DB key 视为第三方 API key。
  // legacy cookie 仍按 Web UI 会话处理，直到切到 opaque cookie 后可精确按 provenance 拦截。
  return isLegacyBearerUserApiKey(token, source) ? "user-api-key" : "session";
}

async function classifyOpaqueLegacyManagementCredential(
  token: string
): Promise<AuthCredentialType> {
  try {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");
    const sessionData = await new RedisSessionStore().read(token);
    return sessionData?.credentialType ?? "user-api-key";
  } catch {
    return "session";
  }
}

// Server Action 函数签名 (支持两种格式)
type ServerAction =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ((...args: any[]) => Promise<ActionResult<any>>) // 标准格式
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | ((...args: any[]) => Promise<any>); // 直接返回数据的格式

/**
 * OpenAPI 路由选项
 */
export interface ActionRouteOptions {
  /**
   * 请求体 schema (使用项目中的 Zod schemas)
   */
  requestSchema?: z.ZodSchema;

  /**
   * 响应数据 schema
   */
  responseSchema?: z.ZodSchema;

  /**
   * 端点描述 (显示在文档中)
   */
  description?: string;

  /**
   * 详细说明 (支持 Markdown)
   */
  summary?: string;

  /**
   * 标签分组 (用于文档分类)
   */
  tags?: string[];

  /**
   * 是否需要认证
   * @default true
   */
  requiresAuth?: boolean;

  /**
   * 允许仅访问只读页面/接口（如 my-usage），跳过 canLoginWebUi 校验
   *
   * 注意：
   * - 这是一个“白名单开关”，仅应对“只读且强制绑定当前会话”的端点开启
   * - 绝不能用于允许传入 userId/keyId 等可导致越权的管理型接口
   *
   * @default false
   */
  allowReadOnlyAccess?: boolean;

  /**
   * 权限要求
   */
  requiredRole?: "admin" | "user";

  /**
   * 请求示例（显示在 API 文档中）
   */
  requestExamples?: Record<
    string,
    {
      summary?: string;
      description?: string;
      value: unknown;
    }
  >;

  /**
   * 参数映射函数（用于多参数 action）
   * 将请求体转换为 action 函数的参数数组
   *
   * @example
   * // 对于 editUser(userId: number, data: UpdateUserData)
   * argsMapper: (body) => [body.userId, body.data]
   */
  argsMapper?: (body: any) => unknown[];
}

/**
 * 统一的响应 schemas
 */
const createResponseSchemas = (dataSchema?: z.ZodSchema) => {
  // 错误响应的完整 schema（包含 errorCode 和 errorParams）
  const errorSchema = z.object({
    ok: z.literal(false),
    error: z.string().describe("错误消息（向后兼容）"),
    errorCode: z.string().optional().describe("错误码（推荐用于国际化）"),
    errorParams: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .describe("错误消息插值参数"),
  });

  return {
    200: {
      description: "操作成功",
      content: {
        "application/json": {
          schema: z.object({
            ok: z.literal(true),
            data: dataSchema || z.any().optional(),
          }),
        },
      },
    },
    400: {
      description: "请求错误 (参数验证失败或业务逻辑错误)",
      content: {
        "application/json": {
          schema: errorSchema,
          examples: {
            validation: {
              summary: "参数验证失败",
              value: {
                ok: false,
                error: "用户名不能为空",
                errorCode: "VALIDATION_ERROR",
                errorParams: { field: "name" },
              },
            },
            business: {
              summary: "业务逻辑错误",
              value: {
                ok: false,
                error: "用户名已存在",
                errorCode: "USER_ALREADY_EXISTS",
              },
            },
          },
        },
      },
    },
    401: {
      description: "未认证 (需要登录)",
      content: {
        "application/json": {
          schema: errorSchema,
          examples: {
            missing: {
              summary: "缺少认证信息",
              value: {
                ok: false,
                error: "未认证",
                errorCode: "AUTH_MISSING",
              },
            },
            invalid: {
              summary: "认证信息无效",
              value: {
                ok: false,
                error: "认证无效或已过期",
                errorCode: "AUTH_INVALID",
              },
            },
          },
        },
      },
    },
    403: {
      description: "权限不足",
      content: {
        "application/json": {
          schema: errorSchema,
          examples: {
            permission: {
              summary: "权限不足",
              value: {
                ok: false,
                error: "权限不足",
                errorCode: "PERMISSION_DENIED",
              },
            },
          },
        },
      },
    },
    500: {
      description: "服务器内部错误",
      content: {
        "application/json": {
          schema: errorSchema,
          examples: {
            internal: {
              summary: "服务器内部错误",
              value: {
                ok: false,
                error: "服务器内部错误",
                errorCode: "INTERNAL_ERROR",
              },
            },
          },
        },
      },
    },
  };
};

/**
 * 为 Server Action 创建 OpenAPI 路由定义
 *
 * @param module 模块名 (用于路由路径和日志)
 * @param actionName Action 名称
 * @param action Server Action 函数
 * @param options 路由选项
 * @returns OpenAPI 路由定义和处理器
 *
 * @example
 * ```typescript
 * const { route, handler } = createActionRoute(
 *   "users",
 *   "addUser",
 *   addUserAction,
 *   {
 *     requestSchema: CreateUserSchema,
 *     responseSchema: UserSchema,
 *     description: "创建新用户",
 *     tags: ["用户管理"],
 *   }
 * );
 *
 * app.openapi(route, handler);
 * ```
 */
export function createActionRoute(
  module: string,
  actionName: string,
  action: ServerAction,
  options: ActionRouteOptions = {}
) {
  const {
    requestSchema = z.object({}).passthrough(),
    responseSchema,
    description = `执行 ${actionName} 操作`,
    summary,
    tags = [module],
    requiresAuth = true,
    allowReadOnlyAccess = false,
    requiredRole,
    requestExamples,
    argsMapper, // 新增：参数映射函数
  } = options;

  // 创建 OpenAPI 路由定义
  const route = createRoute({
    method: "post",
    path: `/${module}/${actionName}`,
    description,
    summary,
    tags,
    request: {
      body: {
        content: {
          "application/json": {
            schema: requestSchema,
            ...(requestExamples && { examples: requestExamples }),
          },
        },
        description: "请求参数",
      },
    },
    responses: createResponseSchemas(responseSchema),
    // 安全定义 (可选,需要在 OpenAPI 文档中配置)
    ...(requiresAuth && {
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    }),
  });

  // 创建处理器函数
  const handler = async (c: Context) => {
    const startTime = Date.now();
    const fullPath = `${module}.${actionName}`;

    try {
      let authSession: Awaited<ReturnType<typeof validateAuthToken>> | null = null;

      // 0. 认证检查 (如果需要)
      if (requiresAuth) {
        const cookieToken =
          getCookie(c, AUTH_COOKIE_NAME) ||
          getAuthCookieFromHeader(
            c.req.header("cookie") ??
              c.req.header("Cookie") ??
              c.req.raw?.headers.get("cookie") ??
              c.req.raw?.headers.get("Cookie")
          );
        const bearerToken = getBearerTokenFromAuthHeader(c.req.header("authorization"));
        const authToken = bearerToken ?? cookieToken;
        const authTokenSource: "cookie" | "bearer" = bearerToken ? "bearer" : "cookie";
        if (!authToken) {
          logger.warn(`[ActionAPI] ${fullPath} 认证失败: 缺少 ${AUTH_COOKIE_NAME}`);
          return c.json({ ok: false, error: "未认证" }, 401);
        }

        const session = await validateAuthToken(authToken, { allowReadOnlyAccess });
        if (!session) {
          logger.warn(`[ActionAPI] ${fullPath} 认证失败: 无效的 ${AUTH_COOKIE_NAME}`);
          return c.json({ ok: false, error: "认证无效或已过期" }, 401);
        }
        authSession = session;

        // 检查角色权限
        if (requiredRole === "admin" && session.user.role !== "admin") {
          logger.warn(`[ActionAPI] ${fullPath} 权限不足: 需要 admin 角色`, {
            userId: session.user.id,
            userRole: session.user.role,
          });
          return c.json({ ok: false, error: "权限不足" }, 403);
        }

        const credentialType =
          requiredRole === "admin"
            ? await classifyLegacyManagementCredential(authToken, authTokenSource)
            : "session";
        if (
          requiredRole === "admin" &&
          credentialType === "user-api-key" &&
          !isApiKeyAdminAccessEnabled()
        ) {
          logger.warn(`[ActionAPI] ${fullPath} 拒绝用户 API Key 管理端访问`, {
            userId: session.user.id,
            userRole: session.user.role,
          });
          return c.json(
            {
              ok: false,
              error: "API Key 管理端访问已关闭",
              errorCode: "auth.api_key_admin_disabled",
            },
            403
          );
        }

        if (
          authTokenSource === "cookie" &&
          isMutationMethod(c.req.raw?.method ?? "POST") &&
          !verifyCsrfToken({
            token: c.req.header(CSRF_HEADER),
            authToken,
            userId: session.user.id,
          })
        ) {
          logger.warn(`[ActionAPI] ${fullPath} CSRF 校验失败`, {
            userId: session.user.id,
            userRole: session.user.role,
          });
          return c.json(
            {
              ok: false,
              error: "CSRF token is missing or invalid.",
              errorCode: "auth.csrf_invalid",
            },
            403
          );
        }
      }

      // 1. 解析并验证请求体 (Zod 自动验证)
      const body = await c.req.json().catch(() => ({}));

      // 2. 调用 Server Action
      // 如果提供了 argsMapper，使用它来映射参数
      // 否则使用默认的参数推断逻辑
      logger.debug(`[ActionAPI] Calling ${fullPath}`, { body: redactManagementBody(body) });

      let args: unknown[];

      if (argsMapper) {
        // 显式参数映射（推荐方式）
        args = argsMapper(body);
      } else if (requestSchema instanceof z.ZodObject) {
        // 默认推断逻辑（保持向后兼容）
        const schemaShape = requestSchema.shape;
        const keys = Object.keys(schemaShape);
        if (keys.length === 0) {
          // 没有参数
          args = [];
        } else if (keys.length === 1) {
          // 单个参数，直接传递值
          args = [body[keys[0] as keyof typeof body]];
        } else {
          // 多个参数场景 - 传递整个 body 对象
          // 注意：这可能与多参数函数签名不兼容，建议使用 argsMapper
          args = [body];
        }
      } else {
        // 非对象 schema，直接传递整个 body
        args = [body];
      }

      // Capture operator IP + UA once so audit hooks inside actions can read
      // them via getRequestContext() without re-parsing headers. Test mocks
      // may not provide a Hono Context with `header()` / raw — default to null.
      const rawHeaders = c.req.raw?.headers;
      const readHeader =
        typeof c.req.header === "function" ? (name: string) => c.req.header(name) : () => undefined;
      const requestCtx = {
        ip: rawHeaders ? getClientIp(rawHeaders) : null,
        userAgent: readHeader("user-agent") ?? null,
      };

      const rawResult =
        authSession != null
          ? await runWithAuthSession(
              authSession,
              () => runWithRequestContext(requestCtx, () => action(...args)),
              { allowReadOnlyAccess }
            )
          : await runWithRequestContext(requestCtx, () => action(...args));

      // 2.5. 包装非 ActionResult 格式的返回值
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: ActionResult<any> =
        rawResult && typeof rawResult === "object" && "ok" in rawResult
          ? rawResult // 已经是 ActionResult 格式
          : { ok: true, data: rawResult }; // 包装成 ActionResult

      // 3. 记录执行时间
      const duration = Date.now() - startTime;
      logger.debug(`[ActionAPI] ${fullPath} completed in ${duration}ms`, {
        ok: result.ok,
      });

      // 4. 返回结果
      if (result.ok) {
        return c.json({ ok: true, data: result.data }, 200);
      } else {
        logger.warn(`[ActionAPI] ${fullPath} failed:`, { error: result.error });
        // 透传完整的错误信息（包括 errorCode 和 errorParams）
        return c.json(
          {
            ok: false,
            error: result.error,
            ...(result.errorCode && { errorCode: result.errorCode }),
            ...(result.errorParams && { errorParams: result.errorParams }),
          },
          400
        );
      }
    } catch (error) {
      // 5. 错误处理
      const duration = Date.now() - startTime;
      logger.error(`[ActionAPI] ${fullPath} threw error after ${duration}ms:`, error);

      // 区分 Zod 验证错误和其他错误
      if (error instanceof Error) {
        return c.json(
          {
            ok: false,
            error: error.message || "服务器内部错误",
          },
          500
        );
      }

      return c.json(
        {
          ok: false,
          error: "服务器内部错误",
        },
        500
      );
    }
  };

  return { route, handler };
}

/**
 * 批量创建 action 路由的辅助函数
 *
 * @param module 模块名
 * @param actions Action 函数映射
 * @param optionsMap 每个 action 的选项 (可选)
 * @returns 路由定义数组
 *
 * @example
 * ```typescript
 * const userRoutes = createActionRoutes(
 *   "users",
 *   { addUser, editUser, removeUser },
 *   {
 *     addUser: {
 *       requestSchema: CreateUserSchema,
 *       description: "创建新用户",
 *     },
 *     editUser: {
 *       requestSchema: UpdateUserSchema,
 *       description: "编辑用户",
 *     },
 *   }
 * );
 *
 * userRoutes.forEach(({ route, handler }) => {
 *   app.openapi(route, handler);
 * });
 * ```
 */
export function createActionRoutes(
  module: string,
  actions: Record<string, ServerAction>,
  optionsMap: Record<string, ActionRouteOptions> = {}
) {
  return Object.entries(actions).map(([actionName, action]) => {
    const options = optionsMap[actionName] || {};
    return createActionRoute(module, actionName, action, options);
  });
}

/**
 * 为参数验证创建通用 schema
 * 用于没有 Zod schema 的简单 actions
 */
export const createParamSchema = <T extends Record<string, z.ZodTypeAny>>(params: T) =>
  z.object(params);

/**
 * 通用的 ID 参数 schema
 */
export const IdParamSchema = z.object({
  id: z.number().int().positive().describe("资源 ID"),
});

/**
 * 通用的分页参数 schema
 */
export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1).describe("页码"),
  pageSize: z.number().int().positive().max(100).default(20).describe("每页数量"),
});

/**
 * 通用的排序参数 schema
 */
export const SortSchema = z.object({
  sortBy: z.string().optional().describe("排序字段"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc").describe("排序方向"),
});
