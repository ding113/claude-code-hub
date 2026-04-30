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
import { adminUserInsightsRouter } from "@/app/api/v1/resources/admin-user-insights/router";
import { auditLogsRouter } from "@/app/api/v1/resources/audit-logs/router";
import { dashboardRouter } from "@/app/api/v1/resources/dashboard/router";
import { errorRulesRouter } from "@/app/api/v1/resources/error-rules/router";
import { ipGeoRouter } from "@/app/api/v1/resources/ip-geo/router";
import { keysRouter } from "@/app/api/v1/resources/keys/router";
import { meRouter } from "@/app/api/v1/resources/me/router";
import { modelPricesRouter } from "@/app/api/v1/resources/model-prices/router";
import { notificationBindingsRouter } from "@/app/api/v1/resources/notification-bindings/router";
import { notificationsRouter } from "@/app/api/v1/resources/notifications/router";
import { providerEndpointsRouter } from "@/app/api/v1/resources/provider-endpoints/router";
import { providerGroupsRouter } from "@/app/api/v1/resources/provider-groups/router";
import { providersRouter } from "@/app/api/v1/resources/providers/router";
import { publicStatusRouter } from "@/app/api/v1/resources/public-status/router";
import { requestFiltersRouter } from "@/app/api/v1/resources/request-filters/router";
import { sensitiveWordsRouter } from "@/app/api/v1/resources/sensitive-words/router";
import { sessionsRouter } from "@/app/api/v1/resources/sessions/router";
import { systemRouter } from "@/app/api/v1/resources/system/router";
import { usageLogsRouter } from "@/app/api/v1/resources/usage-logs/router";
import { usersRouter } from "@/app/api/v1/resources/users/router";
import { webhookTargetsRouter } from "@/app/api/v1/resources/webhook-targets/router";
import {
  AUTH_MODE_CONTEXT_KEY,
  attachRequestId,
  SESSION_CONTEXT_KEY,
} from "@/lib/api/v1/_shared/audit-context";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { setNoStore } from "@/lib/api/v1/_shared/cache-control";
import { generateCsrfToken } from "@/lib/api/v1/_shared/csrf";
import type { AuthSession } from "@/lib/auth";

/** 管理 API 的对外路径前缀（同时也是 OpenAPI servers[0].url） */
const MANAGEMENT_API_BASE_PATH = "/api/v1";

/** 当前管理 API 版本号，写入响应头 X-API-Version */
const MANAGEMENT_API_VERSION = "1.0.0";

/** OpenAPI JSON 文档的对外路径（被 Swagger / Scalar 引用，必须包含 basePath） */
const OPENAPI_JSON_URL = `${MANAGEMENT_API_BASE_PATH}/openapi.json`;

const app = new OpenAPIHono().basePath(MANAGEMENT_API_BASE_PATH);

// ==================== 全局前置中间件 ====================

// 必须最先执行：每个响应（含 404 / 错误）都需要 X-Request-Id
app.use("*", attachRequestId());

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

// ==================== CSRF 令牌端点 ====================

// GET /api/v1/auth/csrf
// - 任意 read 级身份均可访问；
// - cookie 会话返回 { csrfToken: string, mode: "cookie" }（前端必须随写请求带回 X-CCH-CSRF）；
// - api-key / admin-token 调用返回 { csrfToken: null, mode: "api-key" | "admin-token" }
//   （CSRF 仅保护 cookie 通道，API key 调用不需要 CSRF 校验）。
app.get("/auth/csrf", requireAuth({ tier: "read" }), (c) => {
  setNoStore(c);
  // OpenAPIHono 对 c.get(key) 的 key 走严格联合类型推断，未在 Bindings.Variables
  // 注册的 SESSION_CONTEXT_KEY / AUTH_MODE_CONTEXT_KEY 会被推断为 never。
  // 这里通过窄类型化的 ctx 视图复用现有 c.get 实现，避免在每个 handler 都
  // 重复写 `as unknown as`。返回值仍按业务类型断言。
  const ctx = c as unknown as { get(k: string): unknown };
  const session = ctx.get(SESSION_CONTEXT_KEY) as AuthSession | null;
  const mode = ctx.get(AUTH_MODE_CONTEXT_KEY) as
    | "session"
    | "api-key"
    | "admin-token"
    | null
    | undefined;

  if (mode !== "session" || !session) {
    return c.json(
      {
        csrfToken: null,
        mode: mode ?? "api-key",
        note: "CSRF protection is not required for non-cookie authentication.",
      },
      200
    );
  }

  const token = generateCsrfToken(session.key.key, session.user.id);
  return c.json({ csrfToken: token, mode: "cookie" }, 200);
});

// ==================== 业务资源路由 ====================

// /webhook-targets：admin tier；写方法强制 CSRF（路由模块自管理）
app.route("/", webhookTargetsRouter);

// /users：admin tier；包含 CRUD + 动作动词与 tags / key-groups。
app.route("/", usersRouter);

// /keys + /users/{userId}/keys：admin tier；GET /keys/{id}/limit-usage 是 read tier。
app.route("/", keysRouter);

// /admin/users/{id}/insights/*：admin tier；4 个洞察统计端点。
app.route("/", adminUserInsightsRouter);

// /providers/*：admin tier；包含 CRUD + 动作动词 + issue #1123 的 key:reveal。
app.route("/", providersRouter);

// /provider-vendors/* + /provider-endpoints/*：admin tier；vendor + endpoint 管理。
app.route("/", providerEndpointsRouter);

// /provider-groups/*：admin tier；分组 CRUD。
app.route("/", providerGroupsRouter);

// /model-prices/*：admin tier（catalog 单独 read tier）；CRUD + 同步 + manual pin。
app.route("/", modelPricesRouter);

// /system/settings + /system/timezone：admin / read tier。
app.route("/", systemRouter);

// /notifications/settings + /notifications/test-webhook：admin tier。
app.route("/", notificationsRouter);

// /notifications/types/{type}/bindings：admin tier。
app.route("/", notificationBindingsRouter);

// /usage-logs/*：read tier；action 自身按 admin / user 过滤。
app.route("/", usageLogsRouter);

// /audit-logs/*：admin tier。
app.route("/", auditLogsRouter);

// /sessions/*：read tier；action 自身按 admin / user 过滤。
app.route("/", sessionsRouter);

// /dashboard/*：read tier 默认；admin-only 端点由 action 自身限制。
app.route("/", dashboardRouter);

// /me/*：read tier，self-scoped；底层 action 走 allowReadOnlyAccess。
app.route("/", meRouter);

// /public/status：完全公开；/public/status/settings：admin + CSRF。
app.route("/", publicStatusRouter);

// /ip-geo/{ip}：read tier；底层 action 自身限制为 admin。
app.route("/", ipGeoRouter);

// /error-rules/*：admin tier；包含 CRUD + 缓存 / 测试动作。
app.route("/", errorRulesRouter);

// /request-filters/*：admin tier。
app.route("/", requestFiltersRouter);

// /sensitive-words/*：admin tier。
app.route("/", sensitiveWordsRouter);

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
