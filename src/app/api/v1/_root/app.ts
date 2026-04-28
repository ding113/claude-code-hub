/**
 * /api/v1 管理 API 根应用
 *
 * 这是 OpenAPI REST 迁移的入口骨架：
 * - 使用 @hono/zod-openapi v1 的 OpenAPIHono 实例；
 * - basePath 固定为 "/api/v1"，与代理（`/v1/*`）和遗留管理（`/api/actions/*`）严格隔离；
 * - 注册三种安全方案（bearerAuth / apiKeyAuth / cookieAuth）；
 * - 挂载文档相关路由（/openapi.json、/docs、/scalar）与 /health；
 * - 业务资源由后续任务通过 `app.openapi(...)` 或 `app.route(...)` 增量挂载，
 *   本文件不应直接导入任何业务模块。
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { createManagementDocsApp } from "@/app/api/v1/_root/docs";
import { managementApiDocumentConfig } from "@/app/api/v1/_root/document";

/** 管理 API 的对外路径前缀（同时也是 OpenAPI servers[0].url） */
const MANAGEMENT_API_BASE_PATH = "/api/v1";

/** 当前管理 API 版本号，写入响应头 X-API-Version */
const MANAGEMENT_API_VERSION = "1.0.0";

/** OpenAPI JSON 文档的对外路径（被 Swagger / Scalar 引用，必须包含 basePath） */
const OPENAPI_JSON_URL = `${MANAGEMENT_API_BASE_PATH}/openapi.json`;

const app = new OpenAPIHono().basePath(MANAGEMENT_API_BASE_PATH);

// ==================== 安全方案 ====================

// HTTP Bearer：脚本/CLI 调用，token 与 Cookie 中 auth-token 一致
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "API Key",
  description: "Authorization: Bearer <token> 方式认证（适合脚本/CLI 调用）。",
});

// API Key Header：X-Api-Key 头，便于第三方代理嵌入
app.openAPIRegistry.registerComponent("securitySchemes", "apiKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "X-Api-Key",
  description: "X-Api-Key 头部认证（用于第三方系统集成，token 与 auth-token 一致）。",
});

// Cookie：Web UI 登录后的默认认证方式
app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "auth-token",
  description: "HTTP Cookie 认证。请先通过 Web UI 登录获取 auth-token Cookie。",
});

// ==================== 全局中间件 ====================

// 在每个响应上附加 X-API-Version 头（包含错误响应 / 404）
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-API-Version", MANAGEMENT_API_VERSION);
});

// ==================== 文档与健康检查 ====================

// /openapi.json 由根 app 直接处理，确保它能访问 openAPIRegistry 中注册的安全方案
// 使用 OpenAPI 3.1 生成器，与 document.openapi === "3.1.0" 对齐
app.get("/openapi.json", (c) => {
  const document = app.getOpenAPI31Document(managementApiDocumentConfig);
  c.header("Content-Type", "application/json");
  return c.json(document);
});

// 文档 UI 与健康检查由子 app 提供
app.route("/", createManagementDocsApp(OPENAPI_JSON_URL));

// ==================== 404 处理（Problem Details） ====================

app.notFound((c) => {
  const body = {
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: `No management API resource matched ${c.req.method} ${c.req.path}.`,
    instance: c.req.path,
    errorCode: "NOT_FOUND",
  };
  // 直接构造 Response，避免 c.json() 强制覆盖为 application/json
  return new Response(JSON.stringify(body), {
    status: 404,
    headers: {
      "Content-Type": "application/problem+json",
    },
  });
});

export { app as managementApiApp };
export default app;
