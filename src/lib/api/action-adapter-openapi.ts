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
import { logger } from "@/lib/logger";
import { validateKey } from "@/lib/auth";

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
   * 权限要求
   */
  requiredRole?: "admin" | "user";
}

/**
 * 统一的响应 schemas
 */
const createResponseSchemas = (dataSchema?: z.ZodSchema) => ({
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
        schema: z.object({
          ok: z.literal(false),
          error: z.string().describe("错误消息"),
        }),
      },
    },
  },
  401: {
    description: "未认证 (需要登录)",
    content: {
      "application/json": {
        schema: z.object({
          ok: z.literal(false),
          error: z.string().describe("错误消息"),
        }),
      },
    },
  },
  403: {
    description: "权限不足",
    content: {
      "application/json": {
        schema: z.object({
          ok: z.literal(false),
          error: z.string().describe("错误消息"),
        }),
      },
    },
  },
  500: {
    description: "服务器内部错误",
    content: {
      "application/json": {
        schema: z.object({
          ok: z.literal(false),
          error: z.string().describe("错误消息"),
        }),
      },
    },
  },
});

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
    requiredRole,
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
          },
        },
        description: "请求参数",
      },
    },
    responses: createResponseSchemas(responseSchema),
    // 安全定义 (可选,需要在 OpenAPI 文档中配置)
    ...(requiresAuth && {
      security: [{ cookieAuth: [] }],
    }),
  });

  // 创建处理器函数
  const handler = async (c: Context) => {
    const startTime = Date.now();
    const fullPath = `${module}.${actionName}`;

    try {
      // 0. 认证检查 (如果需要)
      if (requiresAuth) {
        const authToken = getCookie(c, "auth-token");
        if (!authToken) {
          logger.warn(`[ActionAPI] ${fullPath} 认证失败: 缺少 auth-token`);
          return c.json({ ok: false, error: "未认证" }, 401);
        }

        const session = await validateKey(authToken);
        if (!session) {
          logger.warn(`[ActionAPI] ${fullPath} 认证失败: 无效的 auth-token`);
          return c.json({ ok: false, error: "认证无效或已过期" }, 401);
        }

        // 检查角色权限
        if (requiredRole === "admin" && session.user.role !== "admin") {
          logger.warn(`[ActionAPI] ${fullPath} 权限不足: 需要 admin 角色`, {
            userId: session.user.id,
            userRole: session.user.role,
          });
          return c.json({ ok: false, error: "权限不足" }, 403);
        }
      }

      // 1. 解析并验证请求体 (Zod 自动验证)
      const body = await c.req.json().catch(() => ({}));

      // 2. 调用 Server Action
      logger.debug(`[ActionAPI] Calling ${fullPath}`, { body });
      const rawResult = await action(body);

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
        return c.json({ ok: false, error: result.error }, 400);
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
