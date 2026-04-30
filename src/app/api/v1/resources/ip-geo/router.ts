/**
 * /api/v1/ip-geo 路由模块（read tier；底层 action 自身限制为 admin）
 */

import { OpenAPIHono } from "@hono/zod-openapi";

import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import { IpGeoIpParamSchema, IpGeoResponseSchema } from "@/lib/api/v1/schemas/ip-geo";

import { getIpGeo } from "./handlers";

const TAG = "IP Geo";

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { apiKeyAuth: [] },
  { cookieAuth: [] },
];

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
    description: "无权限",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "IP 查询未启用",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  500: {
    description: "服务器内部错误",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

export function createIpGeoRouter(): OpenAPIHono {
  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return fromZodError(c, result.error);
      }
    },
  });

  router.use("/ip-geo/*", requireAuth({ tier: "read" }));

  router.openapi(
    {
      method: "get",
      path: "/ip-geo/{ip}",
      tags: [TAG],
      summary: "查询 IP 地理信息（admin）",
      security: SECURITY,
      request: { params: IpGeoIpParamSchema },
      responses: {
        200: {
          description: "IP 地理信息",
          content: { "application/json": { schema: IpGeoResponseSchema } },
        },
        ...errorResponses,
      },
    },
    getIpGeo as never
  );

  return router;
}

export const ipGeoRouter = createIpGeoRouter();
