/**
 * /api/v1/model-prices 路由模块
 *
 * 注册端点（OpenAPI 元数据使用人类可读路径，运行时使用 Hono 兼容的正则约束）：
 *   GET    /model-prices?page&limit&q                                  (admin)
 *   GET    /model-prices/exists                                         (admin)
 *   GET    /model-prices/catalog?scope=chat|all                         (read)
 *   POST   /model-prices:upload                                         (admin + CSRF)
 *   POST   /model-prices:syncLitellmCheck                               (admin + CSRF)
 *   POST   /model-prices:syncLitellm                                    (admin + CSRF)
 *   GET    /model-prices/{modelName}                                    (admin)
 *   PUT    /model-prices/{modelName}                                    (admin + CSRF)
 *   DELETE /model-prices/{modelName}                                    (admin + CSRF)
 *   POST   /model-prices/{modelName}/pricing/{providerType}:pinManual   (admin + CSRF)
 *
 * Hono 路由解析器不支持 `:foo:bar` 紧邻冒号字面量；动作动词路径采用与 webhook-targets/users
 * 相同的正则约束写法，handler 内自行剥离冒号后缀。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ModelNameParamSchema,
  ModelPriceCatalogResponseSchema,
  ModelPriceExistsResponseSchema,
  ModelPriceListResponseSchema,
  ModelPriceSchema,
  ModelPriceSyncSchema,
  ModelPriceUpdateResultSchema,
  ModelPriceUploadSchema,
  ModelPricingProviderParamSchema,
  SingleModelPriceUpsertSchema,
  SyncConflictCheckResponseSchema,
} from "@/lib/api/v1/schemas/model-prices";

import {
  deleteSingleModelPriceHandler,
  existsModelPrices,
  getCatalog,
  getSingleModelPrice,
  listModelPrices,
  pinModelPricingProvider,
  syncLitellm,
  syncLitellmCheck,
  uploadModelPrices,
  upsertSingleModelPriceHandler,
} from "./handlers";

const TAG = "Model Prices";

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

export function createModelPricesRouter(): OpenAPIHono {
  const router = new OpenAPIHono();

  // 默认 admin tier；catalog 单独豁免到 read tier。
  router.use("/model-prices", requireAuth({ tier: "admin" }));
  router.use("/model-prices/*", requireAuth({ tier: "admin" }));
  router.use("/model-prices", csrfForMutating());
  router.use("/model-prices/*", csrfForMutating());

  // ============== GET /model-prices ==============
  router.openapi(
    {
      method: "get",
      path: "/model-prices",
      tags: [TAG],
      summary: "列出模型价格（page-based 分页）",
      description:
        "需要管理员权限；支持 `page` / `limit` / `q`（搜索）查询参数。当 limit 缺省或为 0 时返回全部。",
      security: SECURITY,
      responses: {
        200: {
          description: "模型价格列表",
          content: { "application/json": { schema: ModelPriceListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listModelPrices as never
  );

  // ============== GET /model-prices/exists ==============
  router.openapi(
    {
      method: "get",
      path: "/model-prices/exists",
      tags: [TAG],
      summary: "检查价格表是否存在记录",
      description: "返回 { exists: boolean }。需要管理员权限。",
      security: SECURITY,
      responses: {
        200: {
          description: "是否存在",
          content: { "application/json": { schema: ModelPriceExistsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    existsModelPrices as never
  );

  // ============== GET /model-prices/catalog ==============
  // catalog 是 read tier；通过单独的 OpenAPIHono 子路由覆盖鉴权策略。
  const catalogSubrouter = new OpenAPIHono();
  catalogSubrouter.use("/model-prices/catalog", requireAuth({ tier: "read" }));
  catalogSubrouter.openapi(
    {
      method: "get",
      path: "/model-prices/catalog",
      tags: [TAG],
      summary: "列出可用模型目录",
      description: "返回本地价格表中的模型目录。`scope=chat`（默认）只返回 chat 模型。",
      security: SECURITY,
      responses: {
        200: {
          description: "模型目录",
          content: { "application/json": { schema: ModelPriceCatalogResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getCatalog as never
  );
  router.route("/", catalogSubrouter);

  // ============== POST /model-prices:upload ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/model-prices:upload",
    tags: [TAG],
    summary: "上传价格表",
    description:
      "从 JSON / TOML 内容批量更新价格表。需要管理员权限；Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      body: { required: true, content: { "application/json": { schema: ModelPriceUploadSchema } } },
    },
    responses: {
      200: {
        description: "上传结果",
        content: { "application/json": { schema: ModelPriceUpdateResultSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/model-prices:upload", uploadModelPrices);

  // ============== POST /model-prices:syncLitellmCheck ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/model-prices:syncLitellmCheck",
    tags: [TAG],
    summary: "检查 LiteLLM 同步冲突",
    description: "拉取云端价格表与本地 manual 模型对比，返回冲突列表。",
    security: SECURITY,
    responses: {
      200: {
        description: "冲突检查结果",
        content: { "application/json": { schema: SyncConflictCheckResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/model-prices:syncLitellmCheck", syncLitellmCheck);

  // ============== POST /model-prices:syncLitellm ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/model-prices:syncLitellm",
    tags: [TAG],
    summary: "从 LiteLLM 同步价格表",
    description: "拉取云端 TOML 并批量更新本地价格表。需要管理员权限；可选传入 overwriteManual。",
    security: SECURITY,
    request: {
      body: { required: false, content: { "application/json": { schema: ModelPriceSyncSchema } } },
    },
    responses: {
      200: {
        description: "同步结果",
        content: { "application/json": { schema: ModelPriceUpdateResultSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/model-prices:syncLitellm", syncLitellm);

  // ============== GET /model-prices/{modelName} ==============
  router.openAPIRegistry.registerPath({
    method: "get",
    path: "/model-prices/{modelName}",
    tags: [TAG],
    summary: "查询单个模型价格",
    description: "通过 modelName 查询单条最新价格记录（包含 priceData JSON）。",
    security: SECURITY,
    request: { params: ModelNameParamSchema },
    responses: {
      200: {
        description: "模型价格",
        content: { "application/json": { schema: ModelPriceSchema } },
      },
      ...errorResponses,
    },
  });
  // {modelName} 不加正则约束；具体路径（exists/catalog）已经在前面字面量注册，
  // Hono SmartRouter 会优先匹配字面量路径，参数路由作为兜底。
  router.get("/model-prices/:modelName", getSingleModelPrice);

  // ============== PUT /model-prices/{modelName} ==============
  router.openAPIRegistry.registerPath({
    method: "put",
    path: "/model-prices/{modelName}",
    tags: [TAG],
    summary: "创建或更新单个模型价格",
    description: "手动维护单条模型价格。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: {
      params: ModelNameParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: SingleModelPriceUpsertSchema } },
      },
    },
    responses: {
      200: {
        description: "更新后的模型价格",
        content: { "application/json": { schema: ModelPriceSchema } },
      },
      ...errorResponses,
    },
  });
  router.put("/model-prices/:modelName", upsertSingleModelPriceHandler);

  // ============== DELETE /model-prices/{modelName} ==============
  router.openAPIRegistry.registerPath({
    method: "delete",
    path: "/model-prices/{modelName}",
    tags: [TAG],
    summary: "删除单个模型价格",
    description: "删除指定模型的最新价格记录。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: { params: ModelNameParamSchema },
    responses: {
      204: { description: "删除成功（无响应体）" },
      ...errorResponses,
    },
  });
  router.delete("/model-prices/:modelName", deleteSingleModelPriceHandler);

  // ============== POST /model-prices/{modelName}/pricing/{providerType}:pinManual ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/model-prices/{modelName}/pricing/{providerType}:pinManual",
    tags: [TAG],
    summary: "把多供应商价格固化为 manual",
    description:
      "从 priceData.pricing[providerType] 读取价格节点，固化为 manual 价格记录。Cookie 鉴权时必须携带 X-CCH-CSRF。",
    security: SECURITY,
    request: { params: ModelPricingProviderParamSchema },
    responses: {
      200: {
        description: "固化后的模型价格",
        content: { "application/json": { schema: ModelPriceSchema } },
      },
      ...errorResponses,
    },
  });
  // 嵌套冒号：在最末段用 `:providerTypePin{[A-Za-z0-9_.-]+:pinManual}` 把 ":pinManual"
  // 后缀塞进同一个参数；handler 内剥离冒号。modelName 段保持普通 :param。
  router.post(
    "/model-prices/:modelName/pricing/:providerTypePin{[A-Za-z0-9_.-]+:pinManual}",
    pinModelPricingProvider
  );

  return router;
}

export const modelPricesRouter = createModelPricesRouter();
