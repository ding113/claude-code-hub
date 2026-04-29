/**
 * /api/v1/providers 路由模块
 *
 * 端点（按 plan 第 8 节，省略 dev tooling test:* 端点）：
 *
 *   GET    /providers?include=statistics
 *   POST   /providers
 *   GET    /providers/health
 *   GET    /providers/groups?include=count
 *   POST   /providers/circuits:batchReset
 *   POST   /providers:autoSortPriority
 *   POST   /providers:batchUpdate
 *   GET    /providers/{id}
 *   PATCH  /providers/{id}
 *   DELETE /providers/{id}
 *   POST   /providers/{id}/circuit:reset
 *   POST   /providers/{id}/usage:reset
 *   GET    /providers/{id}/key:reveal      <-- issue #1123 核心
 *
 * Hono 路由解析器不允许 `:id:action` 这种紧邻冒号；写法见 webhook-targets / users。
 *
 * TODO（dev tooling，未迁移；它们仅服务于 settings 页面的测试 UI，不属于公共 API）：
 * - test:proxy (testProviderProxy)
 * - test:unified (testProviderUnified)
 * - test:anthropic-messages (testProviderAnthropicMessages)
 * - test:openai-chat-completions (testProviderOpenAIChatCompletions)
 * - test:openai-responses (testProviderOpenAIResponses)
 * - test:gemini (testProviderGemini)
 * - test:presets (getProviderTestPresets)
 * - upstream-models (fetchUpstreamModels)
 * - model-suggestions (getModelSuggestionsByProviderGroup)
 * - vendor-recluster (reclusterProviderVendors)
 * - batch-patch preview/apply/undo (previewProviderBatchPatch / applyProviderBatchPatch / undoProviderPatch)
 * - batch-delete (batchDeleteProviders / undoProviderDelete)
 * - limit-usage (getProviderLimitUsage)
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderAutoSortPrioritySchema,
  ProviderBatchResetCircuitsSchema,
  ProviderBatchUpdateSchema,
  ProviderCreateSchema,
  ProviderGroupsListSchema,
  ProviderHealthStatusResponseSchema,
  ProviderKeyRevealResponseSchema,
  ProviderListResponseSchema,
  ProviderModelSuggestionsResponseSchema,
  ProviderOkResponseSchema,
  ProviderResponseSchema,
  ProviderUpdateSchema,
} from "@/lib/api/v1/schemas/providers";

import {
  autoSortPriorityHandler,
  batchResetCircuitsHandler,
  batchUpdateProvidersHandler,
  createProviderHandler,
  deleteProviderHandler,
  getHealthStatus,
  getModelSuggestionsHandler,
  getProvider,
  listProviderGroupsForProviders,
  listProviders,
  patchProvider,
  resetProviderCircuitHandler,
  resetProviderUsageHandler,
  revealProviderKeyHandler,
} from "./handlers";

const TAG = "Providers";

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
  { cookieAuth: [] },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfForMutating(): MiddlewareHandler {
  const inner = requireCsrf();
  return async (c: Context, next: Next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
      return next();
    }
    return inner(c, next);
  };
}

const errorResponses = {
  400: {
    description: "请求参数无效",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "未认证",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "无权限或 CSRF 校验失败",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "资源不存在",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  500: {
    description: "服务器内部错误",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

export function createProvidersRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    // 把 OpenAPIHono 内置的 zod 校验失败统一转成 problem+json，避免出现
    // 默认 application/json + 非标准错误体；handler 内部仍会用 parseJsonBody 二次校验。
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  // /providers/* 全部 admin tier；写方法附 CSRF。Action verb 路径同样落在 /providers 前缀下。
  router.use("/providers", requireAuth({ tier: "admin" }));
  router.use("/providers/*", requireAuth({ tier: "admin" }));
  router.use("/providers", csrfForMutating());
  router.use("/providers/*", csrfForMutating());

  // ============== GET /providers ==============
  router.openapi(
    {
      method: "get",
      path: "/providers",
      tags: [TAG],
      summary: "列出 providers",
      description:
        "列出所有 providers（v1 公开枚举之外的 provider 类型已被过滤）。可附 `?include=statistics` 同时返回每个 provider 的今日统计映射。",
      security: SECURITY,
      responses: {
        200: {
          description: "Provider 列表",
          content: { "application/json": { schema: ProviderListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listProviders as never
  );

  // ============== POST /providers ==============
  router.openapi(
    {
      method: "post",
      path: "/providers",
      tags: [TAG],
      summary: "创建 provider",
      description:
        "创建新的 provider。providerType 限定为 v1 公共枚举（claude / codex / gemini / openai-compatible）。Cookie 鉴权时必须携带 X-CCH-CSRF。",
      security: SECURITY,
      request: {
        body: { required: true, content: { "application/json": { schema: ProviderCreateSchema } } },
      },
      responses: {
        201: {
          description: "创建成功；Location 头指向新资源",
          headers: {
            Location: { description: "新 provider 的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: ProviderResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createProviderHandler as never
  );

  // ============== GET /providers/health ==============
  router.openapi(
    {
      method: "get",
      path: "/providers/health",
      tags: [TAG],
      summary: "查询所有 providers 的熔断器健康状态",
      description: "返回 { providerId: { circuitState, failureCount, ... } } 的映射。",
      security: SECURITY,
      responses: {
        200: {
          description: "熔断器健康状态映射",
          content: { "application/json": { schema: ProviderHealthStatusResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getHealthStatus as never
  );

  // ============== GET /providers/groups ==============
  router.openapi(
    {
      method: "get",
      path: "/providers/groups",
      tags: [TAG],
      summary: "列出 provider 分组",
      description: "默认返回字符串数组；附 `?include=count` 时返回 group + providerCount。",
      security: SECURITY,
      responses: {
        200: {
          description:
            "分组列表（默认为字符串数组；附 ?include=count 时为 group + providerCount 数组）",
          content: {
            "application/json": { schema: ProviderGroupsListSchema },
          },
        },
        ...errorResponses,
      },
    },
    listProviderGroupsForProviders as never
  );

  // ============== GET /providers/model-suggestions ==============
  router.openapi(
    {
      method: "get",
      path: "/providers/model-suggestions",
      tags: [TAG],
      summary: "按 providerGroup 过滤后的模型建议列表",
      description:
        "返回匹配指定分组的所有启用 provider 的 allowedModels 中的精确模式，去重后排序。当 providerGroup 缺省时使用 'default'。",
      security: SECURITY,
      responses: {
        200: {
          description: "模型建议列表",
          content: { "application/json": { schema: ProviderModelSuggestionsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getModelSuggestionsHandler as never
  );

  // ============== GET /providers/{id} ==============
  router.openapi(
    {
      method: "get",
      path: "/providers/{id}",
      tags: [TAG],
      summary: "查询单个 provider",
      description: "通过数字 id 获取 provider；隐藏类型返回 404。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "Provider 详情（key 已脱敏）",
          content: { "application/json": { schema: ProviderResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getProvider as never
  );

  // ============== PATCH /providers/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/providers/{id}",
      tags: [TAG],
      summary: "更新 provider",
      description: "局部更新 provider；providerType 隐藏值会被 zod 拒绝。",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: { required: true, content: { "application/json": { schema: ProviderUpdateSchema } } },
      },
      responses: {
        200: {
          description: "更新后的 provider",
          content: { "application/json": { schema: ProviderResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchProvider as never
  );

  // ============== DELETE /providers/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/providers/{id}",
      tags: [TAG],
      summary: "删除 provider",
      description: "软删 provider；幂等。",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteProviderHandler
  );

  // ============== POST /providers/{id}/circuit:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/providers/{id}/circuit:reset",
    tags: [TAG],
    summary: "重置单个 provider 的熔断器",
    description: "强制把熔断器置为 closed 状态。",
    security: SECURITY,
    request: { params: ResourceIdParamSchema },
    responses: {
      200: {
        description: "重置成功",
        content: { "application/json": { schema: ProviderOkResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/providers/:idCircuitReset{[0-9]+}/circuit:reset", resetProviderCircuitHandler);

  // ============== POST /providers/{id}/usage:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/providers/{id}/usage:reset",
    tags: [TAG],
    summary: "重置 provider 总用量",
    description: "更新 totalCostResetAt = NOW()，让聚合从此时刻起重新计算；不会删除日志。",
    security: SECURITY,
    request: { params: ResourceIdParamSchema },
    responses: {
      200: {
        description: "重置成功",
        content: { "application/json": { schema: ProviderOkResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/providers/:idUsageReset{[0-9]+}/usage:reset", resetProviderUsageHandler);

  // ============== POST /providers/circuits:batchReset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/providers/circuits:batchReset",
    tags: [TAG],
    summary: "批量重置 provider 熔断器",
    description: "对多个 provider 批量重置熔断器；上限 500。",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderBatchResetCircuitsSchema } },
      },
    },
    responses: {
      200: {
        description: "批量重置完成",
        content: {
          "application/json": {
            schema: { type: "object", properties: { resetCount: { type: "integer" } } },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/providers/circuits:batchReset", batchResetCircuitsHandler);

  // ============== POST /providers:autoSortPriority ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/providers:autoSortPriority",
    tags: [TAG],
    summary: "按 costMultiplier 自动排序 provider 优先级",
    description:
      "根据 costMultiplier 把 provider 分组并按升序分配 priority；confirm=false 时仅返回预览。",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderAutoSortPrioritySchema } },
      },
    },
    responses: {
      200: {
        description: "排序完成",
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: true },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/providers:autoSortPriority", autoSortPriorityHandler);

  // ============== POST /providers:batchUpdate ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/providers:batchUpdate",
    tags: [TAG],
    summary: "批量更新多个 providers",
    description: "对多个 provider 批量更新（同一组 updates）；上限 500。",
    security: SECURITY,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderBatchUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "批量更新完成",
        content: {
          "application/json": {
            schema: { type: "object", properties: { updatedCount: { type: "integer" } } },
          },
        },
      },
      ...errorResponses,
    },
  });
  router.post("/providers:batchUpdate", batchUpdateProvidersHandler);

  // ============== GET /providers/{id}/key:reveal ==============
  // **Issue #1123 的核心**：明文暴露 provider key。
  router.openAPIRegistry.registerPath({
    method: "get",
    path: "/providers/{id}/key:reveal",
    tags: [TAG],
    summary: "（issue #1123）暴露 provider 的完整原始 key",
    description:
      "仅 admin 可调用；响应固定带 Cache-Control: no-store；legacy action 已记录审计日志（不含 key 内容）。返回体 { id, key }，key 是完整原始字符串，调用方应立即让用户复制并丢弃缓存。",
    security: SECURITY,
    request: { params: ResourceIdParamSchema },
    responses: {
      200: {
        description: "完整 provider key",
        headers: {
          "Cache-Control": {
            description: "no-store, no-cache, must-revalidate",
            schema: { type: "string" },
          },
        },
        content: { "application/json": { schema: ProviderKeyRevealResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.get("/providers/:idKeyReveal{[0-9]+}/key:reveal", revealProviderKeyHandler);

  return router;
}

export const providersRouter = createProvidersRouter();
