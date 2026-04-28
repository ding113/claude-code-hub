/**
 * /api/v1 管理 API 的文档与健康检查路由
 *
 * 暴露：
 *   - GET /api/v1/openapi.json -> OpenAPI 3.1 JSON 文档
 *   - GET /api/v1/docs         -> Swagger UI
 *   - GET /api/v1/scalar       -> Scalar UI（推荐）
 *   - GET /api/v1/health       -> 简易健康检查
 *
 * 注意：
 * - 这里的路由通过 `app.route("/", docsApp)` 挂载到根 OpenAPIHono 上，
 *   因此使用相对路径（`/openapi.json`），最终路径由根的 basePath 合成；
 * - /openapi.json 的实现由根 app 直接挂载（需要访问 openAPIRegistry），
 *   docs.ts 仅负责 UI 与 health。
 */

import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

/**
 * 创建文档与健康检查子应用
 *
 * @param openApiJsonUrl 用于 Swagger UI / Scalar UI 加载文档的 URL（已包含 basePath）
 */
export function createManagementDocsApp(openApiJsonUrl: string): OpenAPIHono {
  const docs = new OpenAPIHono();

  // Swagger UI（传统风格）
  docs.get(
    "/docs",
    swaggerUI({
      url: openApiJsonUrl,
    })
  );

  // Scalar UI（现代风格，推荐）
  docs.get(
    "/scalar",
    apiReference({
      theme: "purple",
      url: openApiJsonUrl,
      layout: "modern",
    })
  );

  // 健康检查端点（管理 API 自身的轻量探针）
  docs.get("/health", (c) => {
    return c.json(
      {
        ok: true,
        service: "management-api",
        version: "1.0.0",
      },
      200
    );
  });

  return docs;
}
