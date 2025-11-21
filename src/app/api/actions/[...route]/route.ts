/**
 * Actions API 路由 - OpenAPI 自动文档生成
 *
 * 统一的 REST API 层,将所有 Server Actions 暴露为 HTTP 端点
 * 并自动生成 OpenAPI 文档 (Swagger/Scalar)
 *
 * 端点格式: POST /api/actions/{module}/{actionName}
 * 文档访问:
 *   - Swagger UI: GET /api/actions/docs
 *   - Scalar UI: GET /api/actions/scalar
 *   - OpenAPI JSON: GET /api/actions/openapi.json
 */

import "@/lib/polyfills/file";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { apiReference } from "@scalar/hono-api-reference";
import { handle } from "hono/vercel";
import { createActionRoute } from "@/lib/api/action-adapter-openapi";

// 导入 actions
import * as userActions from "@/actions/users";
import * as keyActions from "@/actions/keys";
import * as providerActions from "@/actions/providers";
import * as modelPriceActions from "@/actions/model-prices";
import * as statisticsActions from "@/actions/statistics";
import * as usageLogActions from "@/actions/usage-logs";
import * as overviewActions from "@/actions/overview";
import * as sensitiveWordActions from "@/actions/sensitive-words";
import * as activeSessionActions from "@/actions/active-sessions";
import * as notificationActions from "@/actions/notifications";

// 导入 validation schemas
import {
  CreateUserSchema,
  UpdateUserSchema,
  CreateProviderSchema,
  UpdateProviderSchema,
} from "@/lib/validation/schemas";
import { z } from "zod";

// 需要 Node.js runtime (数据库连接)
export const runtime = "nodejs";

// 创建 OpenAPIHono 实例
const app = new OpenAPIHono().basePath("/api/actions");

// ==================== 用户管理 ====================

const { route: getUsersRoute, handler: getUsersHandler } = createActionRoute(
  "users",
  "getUsers",
  userActions.getUsers,
  {
    description: "获取所有用户列表 (管理员)",
    tags: ["用户管理"],
    requiredRole: "admin",
  }
);
app.openapi(getUsersRoute, getUsersHandler);

const { route: addUserRoute, handler: addUserHandler } = createActionRoute(
  "users",
  "addUser",
  userActions.addUser,
  {
    requestSchema: CreateUserSchema,
    description: "创建新用户 (管理员)",
    summary: "创建新用户并返回用户信息",
    tags: ["用户管理"],
    requiredRole: "admin",
  }
);
app.openapi(addUserRoute, addUserHandler);

const { route: editUserRoute, handler: editUserHandler } = createActionRoute(
  "users",
  "editUser",
  userActions.editUser,
  {
    requestSchema: z.object({
      userId: z.number().int().positive(),
      ...UpdateUserSchema.shape,
    }),
    description: "编辑用户信息 (管理员)",
    tags: ["用户管理"],
    requiredRole: "admin",
  }
);
app.openapi(editUserRoute, editUserHandler);

const { route: removeUserRoute, handler: removeUserHandler } = createActionRoute(
  "users",
  "removeUser",
  userActions.removeUser,
  {
    requestSchema: z.object({
      userId: z.number().int().positive(),
    }),
    description: "删除用户 (管理员)",
    tags: ["用户管理"],
    requiredRole: "admin",
  }
);
app.openapi(removeUserRoute, removeUserHandler);

const { route: getUserLimitUsageRoute, handler: getUserLimitUsageHandler } = createActionRoute(
  "users",
  "getUserLimitUsage",
  userActions.getUserLimitUsage,
  {
    requestSchema: z.object({
      userId: z.number().int().positive(),
    }),
    description: "获取用户限额使用情况",
    tags: ["用户管理"],
  }
);
app.openapi(getUserLimitUsageRoute, getUserLimitUsageHandler);

// ==================== 密钥管理 ====================

const { route: getKeysRoute, handler: getKeysHandler } = createActionRoute(
  "keys",
  "getKeys",
  keyActions.getKeys,
  {
    requestSchema: z.object({
      userId: z.number().int().positive(),
    }),
    description: "获取用户的密钥列表",
    tags: ["密钥管理"],
  }
);
app.openapi(getKeysRoute, getKeysHandler);

const { route: addKeyRoute, handler: addKeyHandler } = createActionRoute(
  "keys",
  "addKey",
  keyActions.addKey,
  {
    requestSchema: z.object({
      userId: z.number().int().positive(),
      name: z.string(),
      expiresAt: z.string().optional(),
      canLoginWebUi: z.boolean().optional(),
      limit5hUsd: z.number().nullable().optional(),
      limitWeeklyUsd: z.number().nullable().optional(),
      limitMonthlyUsd: z.number().nullable().optional(),
      limitConcurrentSessions: z.number().optional(),
    }),
    responseSchema: z.object({
      generatedKey: z.string(),
      name: z.string(),
    }),
    description: "创建新密钥",
    summary: "创建新密钥并返回生成的密钥字符串",
    tags: ["密钥管理"],
  }
);
app.openapi(addKeyRoute, addKeyHandler);

const { route: editKeyRoute, handler: editKeyHandler } = createActionRoute(
  "keys",
  "editKey",
  keyActions.editKey,
  {
    requestSchema: z.object({
      keyId: z.number().int().positive(),
      name: z.string(),
      expiresAt: z.string().optional(),
      canLoginWebUi: z.boolean().optional(),
      limit5hUsd: z.number().nullable().optional(),
      limitWeeklyUsd: z.number().nullable().optional(),
      limitMonthlyUsd: z.number().nullable().optional(),
      limitConcurrentSessions: z.number().optional(),
    }),
    description: "编辑密钥信息",
    tags: ["密钥管理"],
  }
);
app.openapi(editKeyRoute, editKeyHandler);

const { route: removeKeyRoute, handler: removeKeyHandler } = createActionRoute(
  "keys",
  "removeKey",
  keyActions.removeKey,
  {
    requestSchema: z.object({
      keyId: z.number().int().positive(),
    }),
    description: "删除密钥",
    tags: ["密钥管理"],
  }
);
app.openapi(removeKeyRoute, removeKeyHandler);

const { route: getKeyLimitUsageRoute, handler: getKeyLimitUsageHandler } = createActionRoute(
  "keys",
  "getKeyLimitUsage",
  keyActions.getKeyLimitUsage,
  {
    requestSchema: z.object({
      keyId: z.number().int().positive(),
    }),
    description: "获取密钥限额使用情况",
    tags: ["密钥管理"],
  }
);
app.openapi(getKeyLimitUsageRoute, getKeyLimitUsageHandler);

// ==================== 供应商管理 ====================

const { route: getProvidersRoute, handler: getProvidersHandler } = createActionRoute(
  "providers",
  "getProviders",
  providerActions.getProviders,
  {
    description: "获取所有供应商列表 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  }
);
app.openapi(getProvidersRoute, getProvidersHandler);

const { route: addProviderRoute, handler: addProviderHandler } = createActionRoute(
  "providers",
  "addProvider",
  providerActions.addProvider,
  {
    requestSchema: CreateProviderSchema,
    description: "创建新供应商 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  }
);
app.openapi(addProviderRoute, addProviderHandler);

const { route: editProviderRoute, handler: editProviderHandler } = createActionRoute(
  "providers",
  "editProvider",
  providerActions.editProvider,
  {
    requestSchema: z.object({
      providerId: z.number().int().positive(),
      ...UpdateProviderSchema.shape,
    }),
    description: "编辑供应商信息 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  }
);
app.openapi(editProviderRoute, editProviderHandler);

const { route: removeProviderRoute, handler: removeProviderHandler } = createActionRoute(
  "providers",
  "removeProvider",
  providerActions.removeProvider,
  {
    requestSchema: z.object({
      providerId: z.number().int().positive(),
    }),
    description: "删除供应商 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  }
);
app.openapi(removeProviderRoute, removeProviderHandler);

const { route: getProvidersHealthStatusRoute, handler: getProvidersHealthStatusHandler } =
  createActionRoute(
    "providers",
    "getProvidersHealthStatus",
    providerActions.getProvidersHealthStatus,
    {
      description: "获取所有供应商的熔断器健康状态 (管理员)",
      tags: ["供应商管理"],
      requiredRole: "admin",
    }
  );
app.openapi(getProvidersHealthStatusRoute, getProvidersHealthStatusHandler);

const { route: resetProviderCircuitRoute, handler: resetProviderCircuitHandler } =
  createActionRoute("providers", "resetProviderCircuit", providerActions.resetProviderCircuit, {
    requestSchema: z.object({
      providerId: z.number().int().positive(),
    }),
    description: "重置供应商的熔断器状态 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  });
app.openapi(resetProviderCircuitRoute, resetProviderCircuitHandler);

const { route: getProviderLimitUsageRoute, handler: getProviderLimitUsageHandler } =
  createActionRoute("providers", "getProviderLimitUsage", providerActions.getProviderLimitUsage, {
    requestSchema: z.object({
      providerId: z.number().int().positive(),
    }),
    description: "获取供应商限额使用情况 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  });
app.openapi(getProviderLimitUsageRoute, getProviderLimitUsageHandler);

// ==================== 模型价格管理 ====================

const { route: getModelPricesRoute, handler: getModelPricesHandler } = createActionRoute(
  "model-prices",
  "getModelPrices",
  modelPriceActions.getModelPrices,
  {
    description: "获取所有模型价格 (管理员)",
    tags: ["模型价格"],
    requiredRole: "admin",
  }
);
app.openapi(getModelPricesRoute, getModelPricesHandler);

const { route: uploadPriceTableRoute, handler: uploadPriceTableHandler } = createActionRoute(
  "model-prices",
  "uploadPriceTable",
  modelPriceActions.uploadPriceTable,
  {
    requestSchema: z.object({
      jsonContent: z.string().describe("价格表 JSON 字符串"),
    }),
    description: "上传价格表 (管理员)",
    tags: ["模型价格"],
    requiredRole: "admin",
  }
);
app.openapi(uploadPriceTableRoute, uploadPriceTableHandler);

const { route: syncLiteLLMPricesRoute, handler: syncLiteLLMPricesHandler } = createActionRoute(
  "model-prices",
  "syncLiteLLMPrices",
  modelPriceActions.syncLiteLLMPrices,
  {
    description: "同步 LiteLLM 价格表 (管理员)",
    summary: "从 GitHub 拉取最新的 LiteLLM 价格表并导入",
    tags: ["模型价格"],
    requiredRole: "admin",
  }
);
app.openapi(syncLiteLLMPricesRoute, syncLiteLLMPricesHandler);

const {
  route: getAvailableModelsByProviderTypeRoute,
  handler: getAvailableModelsByProviderTypeHandler,
} = createActionRoute(
  "model-prices",
  "getAvailableModelsByProviderType",
  modelPriceActions.getAvailableModelsByProviderType,
  {
    description: "获取可用模型列表 (按供应商类型分组)",
    tags: ["模型价格"],
  }
);
app.openapi(getAvailableModelsByProviderTypeRoute, getAvailableModelsByProviderTypeHandler);

const { route: hasPriceTableRoute, handler: hasPriceTableHandler } = createActionRoute(
  "model-prices",
  "hasPriceTable",
  modelPriceActions.hasPriceTable,
  {
    responseSchema: z.boolean(),
    description: "检查是否有价格表",
    tags: ["模型价格"],
  }
);
app.openapi(hasPriceTableRoute, hasPriceTableHandler);

// ==================== 统计数据 ====================

const { route: getUserStatisticsRoute, handler: getUserStatisticsHandler } = createActionRoute(
  "statistics",
  "getUserStatistics",
  statisticsActions.getUserStatistics,
  {
    requestSchema: z.object({
      timeRange: z.enum(["hour", "day", "week", "month"]),
      userId: z.number().int().positive().optional(),
    }),
    description: "获取用户统计数据",
    summary: "根据时间范围获取使用统计 (管理员看所有,用户看自己)",
    tags: ["统计分析"],
  }
);
app.openapi(getUserStatisticsRoute, getUserStatisticsHandler);

// ==================== 使用日志 ====================

const { route: getUsageLogsRoute, handler: getUsageLogsHandler } = createActionRoute(
  "usage-logs",
  "getUsageLogs",
  usageLogActions.getUsageLogs,
  {
    requestSchema: z.object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      model: z.string().optional(),
      statusCode: z.number().optional(),
      pageSize: z.number().int().positive().max(100).default(50).optional(),
      page: z.number().int().positive().default(1).optional(),
    }),
    description: "获取使用日志",
    summary: "查询使用日志,支持多种过滤条件",
    tags: ["使用日志"],
  }
);
app.openapi(getUsageLogsRoute, getUsageLogsHandler);

const { route: getModelListRoute, handler: getModelListHandler } = createActionRoute(
  "usage-logs",
  "getModelList",
  usageLogActions.getModelList,
  {
    responseSchema: z.array(z.string()),
    description: "获取日志中的模型列表",
    tags: ["使用日志"],
  }
);
app.openapi(getModelListRoute, getModelListHandler);

const { route: getStatusCodeListRoute, handler: getStatusCodeListHandler } = createActionRoute(
  "usage-logs",
  "getStatusCodeList",
  usageLogActions.getStatusCodeList,
  {
    responseSchema: z.array(z.number()),
    description: "获取日志中的状态码列表",
    tags: ["使用日志"],
  }
);
app.openapi(getStatusCodeListRoute, getStatusCodeListHandler);

// ==================== 概览数据 ====================

const { route: getOverviewDataRoute, handler: getOverviewDataHandler } = createActionRoute(
  "overview",
  "getOverviewData",
  overviewActions.getOverviewData,
  {
    description: "获取首页概览数据",
    summary: "包含并发数、今日统计、活跃用户等",
    tags: ["概览"],
  }
);
app.openapi(getOverviewDataRoute, getOverviewDataHandler);

// ==================== 敏感词管理 ====================

const { route: listSensitiveWordsRoute, handler: listSensitiveWordsHandler } = createActionRoute(
  "sensitive-words",
  "listSensitiveWords",
  sensitiveWordActions.listSensitiveWords,
  {
    description: "获取敏感词列表 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(listSensitiveWordsRoute, listSensitiveWordsHandler);

const { route: createSensitiveWordRoute, handler: createSensitiveWordHandler } = createActionRoute(
  "sensitive-words",
  "createSensitiveWordAction",
  sensitiveWordActions.createSensitiveWordAction,
  {
    requestSchema: z.object({
      word: z.string(),
      matchType: z.enum(["contains", "exact", "regex"]),
      description: z.string().optional(),
    }),
    description: "创建敏感词 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(createSensitiveWordRoute, createSensitiveWordHandler);

const { route: updateSensitiveWordRoute, handler: updateSensitiveWordHandler } = createActionRoute(
  "sensitive-words",
  "updateSensitiveWordAction",
  sensitiveWordActions.updateSensitiveWordAction,
  {
    requestSchema: z.object({
      id: z.number().int().positive(),
      word: z.string().optional(),
      matchType: z.enum(["contains", "exact", "regex"]).optional(),
      isEnabled: z.boolean().optional(),
      description: z.string().optional(),
    }),
    description: "更新敏感词 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(updateSensitiveWordRoute, updateSensitiveWordHandler);

const { route: deleteSensitiveWordRoute, handler: deleteSensitiveWordHandler } = createActionRoute(
  "sensitive-words",
  "deleteSensitiveWordAction",
  sensitiveWordActions.deleteSensitiveWordAction,
  {
    requestSchema: z.object({
      id: z.number().int().positive(),
    }),
    description: "删除敏感词 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(deleteSensitiveWordRoute, deleteSensitiveWordHandler);

const { route: refreshCacheRoute, handler: refreshCacheHandler } = createActionRoute(
  "sensitive-words",
  "refreshCacheAction",
  sensitiveWordActions.refreshCacheAction,
  {
    description: "手动刷新敏感词缓存 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(refreshCacheRoute, refreshCacheHandler);

const { route: getCacheStatsRoute, handler: getCacheStatsHandler } = createActionRoute(
  "sensitive-words",
  "getCacheStats",
  sensitiveWordActions.getCacheStats,
  {
    description: "获取敏感词缓存统计信息 (管理员)",
    tags: ["敏感词管理"],
    requiredRole: "admin",
  }
);
app.openapi(getCacheStatsRoute, getCacheStatsHandler);

// ==================== 活跃 Session ====================

const { route: getActiveSessionsRoute, handler: getActiveSessionsHandler } = createActionRoute(
  "active-sessions",
  "getActiveSessions",
  activeSessionActions.getActiveSessions,
  {
    description: "获取活跃 Session 列表",
    tags: ["Session 管理"],
  }
);
app.openapi(getActiveSessionsRoute, getActiveSessionsHandler);

const { route: getSessionDetailsRoute, handler: getSessionDetailsHandler } = createActionRoute(
  "active-sessions",
  "getSessionDetails",
  activeSessionActions.getSessionDetails,
  {
    requestSchema: z.object({
      sessionId: z.string(),
    }),
    description: "获取 Session 详情",
    tags: ["Session 管理"],
  }
);
app.openapi(getSessionDetailsRoute, getSessionDetailsHandler);

const { route: getSessionMessagesRoute, handler: getSessionMessagesHandler } = createActionRoute(
  "active-sessions",
  "getSessionMessages",
  activeSessionActions.getSessionMessages,
  {
    requestSchema: z.object({
      sessionId: z.string(),
    }),
    description: "获取 Session 的 messages 内容",
    tags: ["Session 管理"],
  }
);
app.openapi(getSessionMessagesRoute, getSessionMessagesHandler);

// ==================== 通知管理 ====================

const { route: getNotificationSettingsRoute, handler: getNotificationSettingsHandler } =
  createActionRoute(
    "notifications",
    "getNotificationSettingsAction",
    notificationActions.getNotificationSettingsAction,
    {
      description: "获取通知设置",
      tags: ["通知管理"],
      requiredRole: "admin",
    }
  );
app.openapi(getNotificationSettingsRoute, getNotificationSettingsHandler);

const { route: updateNotificationSettingsRoute, handler: updateNotificationSettingsHandler } =
  createActionRoute(
    "notifications",
    "updateNotificationSettingsAction",
    notificationActions.updateNotificationSettingsAction,
    {
      requestSchema: z.object({
        webhookUrl: z.string().url().optional(),
        enabledEvents: z.array(z.string()).optional(),
      }),
      description: "更新通知设置",
      tags: ["通知管理"],
      requiredRole: "admin",
    }
  );
app.openapi(updateNotificationSettingsRoute, updateNotificationSettingsHandler);

const { route: testWebhookRoute, handler: testWebhookHandler } = createActionRoute(
  "notifications",
  "testWebhookAction",
  notificationActions.testWebhookAction,
  {
    requestSchema: z.object({
      webhookUrl: z.string().url(),
    }),
    description: "测试 Webhook 配置",
    tags: ["通知管理"],
    requiredRole: "admin",
  }
);
app.openapi(testWebhookRoute, testWebhookHandler);

// ==================== OpenAPI 文档 ====================

/**
 * 生成 OpenAPI servers 配置（动态检测）
 */
function getOpenAPIServers() {
  const servers: Array<{ url: string; description: string }> = [];

  // 优先使用环境变量配置的 APP_URL
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    servers.push({
      url: appUrl,
      description: "应用地址 (配置)",
    });
  }

  // 降级：添加常见的开发环境地址
  if (process.env.NODE_ENV !== "production") {
    servers.push({
      url: "http://localhost:13500",
      description: "本地开发环境",
    });
  }

  // 兜底：如果没有配置，提供占位符提示
  if (servers.length === 0) {
    servers.push({
      url: "https://your-domain.com",
      description: "生产环境 (请配置 APP_URL 环境变量)",
    });
  }

  return servers;
}

// 生成 OpenAPI 3.1.0 规范文档
app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Claude Code Hub API",
    version: "1.0.0",
    description: `
# Claude Code Hub 管理 API

Claude Code Hub 是一个 Claude API 代理中转服务平台,提供以下功能:

- 🔐 **用户和密钥管理** - 统一的用户体系和 API Key 管理
- 🌐 **供应商管理** - 多供应商支持,智能负载均衡和故障转移
- 💰 **模型价格管理** - 灵活的价格配置和成本控制
- 📊 **统计分析** - 详细的使用统计和实时监控
- 🔍 **使用日志** - 完整的请求日志和审计追踪
- 🛡️ **敏感词过滤** - 内容审核和风险控制
- ⚡ **Session 管理** - 并发控制和会话追踪

## 认证

所有 API 端点需要通过 Cookie 认证。请先通过 Web UI 登录获取 session。

## 权限

- 👤 **普通用户**: 可以查看自己的数据和使用统计
- 👑 **管理员**: 拥有完整的系统管理权限

## 错误处理

所有 API 响应遵循统一格式:

\`\`\`json
// 成功
{
  "ok": true,
  "data": { ... }
}

// 失败
{
  "ok": false,
  "error": "错误消息"
}
\`\`\`

HTTP 状态码:
- \`200\`: 操作成功
- \`400\`: 请求错误 (参数验证失败或业务逻辑错误)
- \`401\`: 未认证 (需要登录)
- \`403\`: 权限不足
- \`500\`: 服务器内部错误
    `,
  },
  servers: getOpenAPIServers(),
  tags: [
    { name: "用户管理", description: "用户的 CRUD 操作和限额管理" },
    { name: "密钥管理", description: "API 密钥的生成、编辑和限额配置" },
    { name: "供应商管理", description: "上游供应商配置、熔断器和健康检查" },
    { name: "模型价格", description: "模型价格配置和 LiteLLM 价格同步" },
    { name: "统计分析", description: "使用统计和数据分析" },
    { name: "使用日志", description: "请求日志查询和审计" },
    { name: "概览", description: "首页概览数据" },
    { name: "敏感词管理", description: "敏感词过滤配置" },
    { name: "Session 管理", description: "活跃 Session 和并发控制" },
    { name: "通知管理", description: "系统通知" },
  ],
});

// Swagger UI (传统风格)
app.get(
  "/docs",
  swaggerUI({
    url: "/api/actions/openapi.json",
  })
);

// Scalar UI (现代风格,推荐)
app.get(
  "/scalar",
  apiReference({
    theme: "purple",
    url: "/api/actions/openapi.json",
    layout: "modern",
  })
);

// 健康检查端点
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  })
);

// 导出处理器 (Vercel Edge Functions 格式)
export const GET = handle(app);
export const POST = handle(app);
