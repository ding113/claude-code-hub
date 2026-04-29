/**
 * /api/v1/provider-vendors + /api/v1/provider-endpoints 路由模块
 *
 * 端点：
 *   GET    /provider-vendors?dashboard=bool
 *   GET    /provider-vendors/{id}
 *   PATCH  /provider-vendors/{id}
 *   DELETE /provider-vendors/{id}
 *   GET    /provider-vendors/{vendorId}/endpoints?providerType=&include=stats
 *   POST   /provider-vendors/{vendorId}/endpoints
 *
 *   PATCH  /provider-endpoints/{id}
 *   DELETE /provider-endpoints/{id}
 *   POST   /provider-endpoints/{id}:probe
 *   GET    /provider-endpoints/{id}/probe-logs
 *   GET    /provider-endpoints/{id}/circuit
 *   POST   /provider-endpoints/{id}/circuit:reset
 */

import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler, Next } from "hono";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { requireCsrf } from "@/lib/api/v1/_shared/csrf";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema, ResourceIdParamSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderEndpointCircuitInfoSchema,
  ProviderEndpointCreateSchema,
  ProviderEndpointListResponseSchema,
  ProviderEndpointOkResponseSchema,
  ProviderEndpointProbeLogsResponseSchema,
  ProviderEndpointProbeResultSchema,
  ProviderEndpointProbeSchema,
  ProviderEndpointResponseSchema,
  ProviderEndpointUpdateSchema,
  ProviderVendorListResponseSchema,
  ProviderVendorResponseSchema,
  ProviderVendorUpdateSchema,
} from "@/lib/api/v1/schemas/provider-endpoints";

import {
  createEndpointForVendor,
  deleteEndpoint,
  deleteProviderVendor,
  getEndpointCircuit,
  getEndpointProbeLogs,
  getProviderVendor,
  listEndpointsForVendor,
  listProviderVendors,
  patchEndpoint,
  patchProviderVendor,
  probeEndpointHandler,
  resetEndpointCircuit,
} from "./handlers";

const TAG_VENDORS = "Provider Vendors";
const TAG_ENDPOINTS = "Provider Endpoints";

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

const VendorIdParamSchema = z
  .object({
    vendorId: z.coerce.number().int().positive().describe("Vendor 数字 id"),
  })
  .describe("Path 参数：vendor id")
  .openapi({ example: { vendorId: 1 } });

export function createProviderEndpointsRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  // /provider-vendors/* 与 /provider-endpoints/* 都是 admin tier；写方法附 CSRF。
  router.use("/provider-vendors", requireAuth({ tier: "admin" }));
  router.use("/provider-vendors/*", requireAuth({ tier: "admin" }));
  router.use("/provider-endpoints", requireAuth({ tier: "admin" }));
  router.use("/provider-endpoints/*", requireAuth({ tier: "admin" }));
  router.use("/provider-vendors", csrfForMutating());
  router.use("/provider-vendors/*", csrfForMutating());
  router.use("/provider-endpoints", csrfForMutating());
  router.use("/provider-endpoints/*", csrfForMutating());

  // ============== GET /provider-vendors ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-vendors",
      tags: [TAG_VENDORS],
      summary: "列出 provider vendors",
      description:
        "默认返回全部 vendor；附 `?dashboard=true` 时仅返回 dashboard 用的 vendor 列表。",
      security: SECURITY,
      responses: {
        200: {
          description: "Vendor 列表",
          content: { "application/json": { schema: ProviderVendorListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listProviderVendors as never
  );

  // ============== GET /provider-vendors/{id} ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-vendors/{id}",
      tags: [TAG_VENDORS],
      summary: "查询单个 vendor",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "Vendor 详情",
          content: { "application/json": { schema: ProviderVendorResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getProviderVendor as never
  );

  // ============== PATCH /provider-vendors/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/provider-vendors/{id}",
      tags: [TAG_VENDORS],
      summary: "更新 vendor",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: ProviderVendorUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的 vendor",
          content: { "application/json": { schema: ProviderVendorResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchProviderVendor as never
  );

  // ============== DELETE /provider-vendors/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/provider-vendors/{id}",
      tags: [TAG_VENDORS],
      summary: "删除 vendor",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteProviderVendor
  );

  // ============== GET /provider-vendors/{vendorId}/endpoints ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-vendors/{vendorId}/endpoints",
      tags: [TAG_VENDORS],
      summary: "列出 vendor 下的 endpoints",
      description: "可选 `?providerType=` 过滤；隐藏类型 endpoint 不会在响应中出现。",
      security: SECURITY,
      request: { params: VendorIdParamSchema },
      responses: {
        200: {
          description: "Endpoint 列表",
          content: { "application/json": { schema: ProviderEndpointListResponseSchema } },
        },
        ...errorResponses,
      },
    },
    listEndpointsForVendor as never
  );

  // ============== POST /provider-vendors/{vendorId}/endpoints ==============
  router.openapi(
    {
      method: "post",
      path: "/provider-vendors/{vendorId}/endpoints",
      tags: [TAG_VENDORS],
      summary: "为 vendor 创建一个 endpoint",
      security: SECURITY,
      request: {
        params: VendorIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: ProviderEndpointCreateSchema } },
        },
      },
      responses: {
        201: {
          description: "创建成功",
          headers: {
            Location: { description: "新 endpoint 的相对 URL", schema: { type: "string" } },
          },
          content: { "application/json": { schema: ProviderEndpointResponseSchema } },
        },
        ...errorResponses,
      },
    },
    createEndpointForVendor as never
  );

  // ============== PATCH /provider-endpoints/{id} ==============
  router.openapi(
    {
      method: "patch",
      path: "/provider-endpoints/{id}",
      tags: [TAG_ENDPOINTS],
      summary: "更新 endpoint",
      security: SECURITY,
      request: {
        params: ResourceIdParamSchema,
        body: {
          required: true,
          content: { "application/json": { schema: ProviderEndpointUpdateSchema } },
        },
      },
      responses: {
        200: {
          description: "更新后的 endpoint",
          content: { "application/json": { schema: ProviderEndpointResponseSchema } },
        },
        ...errorResponses,
      },
    },
    patchEndpoint as never
  );

  // ============== DELETE /provider-endpoints/{id} ==============
  router.openapi(
    {
      method: "delete",
      path: "/provider-endpoints/{id}",
      tags: [TAG_ENDPOINTS],
      summary: "删除 endpoint",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        204: { description: "删除成功（无响应体）" },
        ...errorResponses,
      },
    },
    deleteEndpoint
  );

  // ============== POST /provider-endpoints/{id}:probe ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/provider-endpoints/{id}:probe",
    tags: [TAG_ENDPOINTS],
    summary: "触发 endpoint 探测（手动）",
    description: "执行一次手动探测；timeoutMs 可选 (1000-120000)。",
    security: SECURITY,
    request: {
      params: ResourceIdParamSchema,
      body: {
        required: false,
        content: { "application/json": { schema: ProviderEndpointProbeSchema } },
      },
    },
    responses: {
      200: {
        description: "探测结果",
        content: { "application/json": { schema: ProviderEndpointProbeResultSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/provider-endpoints/:idProbe{[0-9]+:probe}", probeEndpointHandler);

  // ============== GET /provider-endpoints/{id}/probe-logs ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-endpoints/{id}/probe-logs",
      tags: [TAG_ENDPOINTS],
      summary: "查询 endpoint 探测历史",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "探测日志列表",
          content: { "application/json": { schema: ProviderEndpointProbeLogsResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getEndpointProbeLogs as never
  );

  // ============== GET /provider-endpoints/{id}/circuit ==============
  router.openapi(
    {
      method: "get",
      path: "/provider-endpoints/{id}/circuit",
      tags: [TAG_ENDPOINTS],
      summary: "查询 endpoint 熔断器状态",
      security: SECURITY,
      request: { params: ResourceIdParamSchema },
      responses: {
        200: {
          description: "熔断器信息",
          content: { "application/json": { schema: ProviderEndpointCircuitInfoSchema } },
        },
        ...errorResponses,
      },
    },
    getEndpointCircuit as never
  );

  // ============== POST /provider-endpoints/{id}/circuit:reset ==============
  router.openAPIRegistry.registerPath({
    method: "post",
    path: "/provider-endpoints/{id}/circuit:reset",
    tags: [TAG_ENDPOINTS],
    summary: "重置 endpoint 熔断器",
    security: SECURITY,
    request: { params: ResourceIdParamSchema },
    responses: {
      200: {
        description: "重置成功",
        content: { "application/json": { schema: ProviderEndpointOkResponseSchema } },
      },
      ...errorResponses,
    },
  });
  router.post("/provider-endpoints/:idCircuitReset{[0-9]+}/circuit:reset", resetEndpointCircuit);

  return router;
}

export const providerEndpointsRouter = createProviderEndpointsRouter();
