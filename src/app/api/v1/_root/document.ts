/**
 * /api/v1 管理 API 的 OpenAPI 文档配置
 *
 * 仅声明顶层元数据（info、servers、tags），不直接生成 OpenAPI 文档：
 * - paths 由 OpenAPIHono 在请求 /openapi.json 时根据已注册路由自动收集；
 * - components.securitySchemes 在 app.ts 中通过 openAPIRegistry 注册。
 */

import type { OpenAPIObjectConfig } from "@/app/api/v1/_root/types";

/**
 * 管理 API 顶层元数据
 *
 * 说明：
 * - 该对象不包含 paths/components 字段，由 OpenAPIHono 自动合并。
 * - 描述使用中文，遵循项目既有约定（参考 `/api/actions` 文档）。
 */
export const managementApiDocumentConfig: OpenAPIObjectConfig = {
  openapi: "3.1.0",
  info: {
    title: "Claude Code Hub Management API",
    version: "1.0.0",
    description:
      "Claude Code Hub 管理 API，提供用户、密钥、供应商、统计等管理资源的 REST 接口。仅供已认证的管理员或受限用户调用。",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Management API",
    },
  ],
  tags: [],
};
