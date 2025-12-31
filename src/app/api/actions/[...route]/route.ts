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
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { handle } from "hono/vercel";
import { z } from "zod";
import * as activeSessionActions from "@/actions/active-sessions";
import * as keyActions from "@/actions/keys";
import * as modelPriceActions from "@/actions/model-prices";
import * as notificationActions from "@/actions/notifications";
import * as overviewActions from "@/actions/overview";
import * as providerActions from "@/actions/providers";
import * as sensitiveWordActions from "@/actions/sensitive-words";
import * as statisticsActions from "@/actions/statistics";
import * as usageLogActions from "@/actions/usage-logs";
// 导入 actions
import * as userActions from "@/actions/users";
import { createActionRoute } from "@/lib/api/action-adapter-openapi";
import { NOTIFICATION_JOB_TYPES } from "@/lib/constants/notification.constants";
// 导入 validation schemas
import {
  CreateProviderSchema,
  CreateUserSchema,
  UpdateProviderSchema,
  UpdateUserSchema,
} from "@/lib/validation/schemas";

// 需要 Node.js runtime (数据库连接)
export const runtime = "nodejs";

// 创建 OpenAPIHono 实例
const app = new OpenAPIHono().basePath("/api/actions");

// 注册安全方案
app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
  type: "apiKey",
  in: "cookie",
  name: "auth-token",
  description:
    "HTTP Cookie 认证。请先通过 Web UI 登录获取 auth-token Cookie，或从浏览器开发者工具中复制 Cookie 值用于 API 调用。详见上方「认证方式」章节。",
});

// ==================== 用户管理 ====================

const { route: getUsersRoute, handler: getUsersHandler } = createActionRoute(
  "users",
  "getUsers",
  userActions.getUsers,
  {
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.array(
      z.object({
        id: z.number().describe("用户 ID"),
        name: z.string().describe("用户名"),
        note: z.string().nullable().describe("备注"),
        role: z.enum(["admin", "user"]).describe("用户角色"),
        isEnabled: z.boolean().describe("是否启用"),
        expiresAt: z.string().nullable().describe("过期时间"),
        rpm: z.number().describe("每分钟请求数限制"),
        dailyQuota: z.number().describe("每日消费额度（美元）"),
        providerGroup: z.string().nullable().describe("供应商分组"),
        tags: z.array(z.string()).describe("用户标签"),
        limit5hUsd: z.number().nullable().describe("5小时消费上限"),
        limitWeeklyUsd: z.number().nullable().describe("周消费上限"),
        limitMonthlyUsd: z.number().nullable().describe("月消费上限"),
        limitTotalUsd: z.number().nullable().describe("总消费上限"),
        limitConcurrentSessions: z.number().nullable().describe("并发Session上限"),
        createdAt: z.string().describe("创建时间"),
      })
    ),
    description: "获取用户列表 (管理员获取所有用户，普通用户仅获取自己)",
    summary: "获取用户列表",
    tags: ["用户管理"],
  }
);
app.openapi(getUsersRoute, getUsersHandler);

const { route: addUserRoute, handler: addUserHandler } = createActionRoute(
  "users",
  "addUser",
  userActions.addUser,
  {
    requestSchema: CreateUserSchema,
    responseSchema: z.object({
      user: z.object({
        id: z.number().describe("用户ID"),
        name: z.string().describe("用户名"),
        note: z.string().optional().describe("备注"),
        role: z.enum(["admin", "user"]).describe("用户角色"),
        isEnabled: z.boolean().describe("是否启用"),
        expiresAt: z.date().nullable().describe("过期时间"),
        rpm: z.number().describe("每分钟请求数限制"),
        dailyQuota: z.number().describe("每日消费额度（美元）"),
        providerGroup: z.string().optional().describe("供应商分组"),
        tags: z.array(z.string()).describe("用户标签"),
        limit5hUsd: z.number().nullable().describe("5小时消费上限"),
        limitWeeklyUsd: z.number().nullable().describe("周消费上限"),
        limitMonthlyUsd: z.number().nullable().describe("月消费上限"),
        limitTotalUsd: z.number().nullable().describe("总消费上限"),
        limitConcurrentSessions: z.number().nullable().describe("并发Session上限"),
      }),
      defaultKey: z.object({
        id: z.number().describe("密钥ID"),
        name: z.string().describe("密钥名称"),
        key: z.string().describe("API密钥（完整密钥，仅在创建时返回一次）"),
      }),
    }),
    description: "创建新用户 (管理员)",
    summary: "创建新用户并返回用户信息及默认密钥",
    tags: ["用户管理"],
    requiredRole: "admin",
    requestExamples: {
      basic: {
        summary: "基础用户",
        description: "创建一个具有默认配置的普通用户",
        value: {
          name: "测试用户",
          note: "这是一个测试账号",
          rpm: 100,
          dailyQuota: 100,
          isEnabled: true,
        },
      },
      withExpiry: {
        summary: "带过期时间的用户",
        description: "创建一个指定过期时间的用户（ISO 8601 格式）",
        value: {
          name: "临时用户",
          note: "30天试用账号",
          rpm: 60,
          dailyQuota: 50,
          isEnabled: true,
          expiresAt: "2026-01-01T23:59:59.999Z",
        },
      },
      withLimits: {
        summary: "完整限额配置",
        description: "创建一个具有完整金额限制和并发控制的用户",
        value: {
          name: "企业用户",
          note: "企业级账号",
          providerGroup: "premium,backup",
          tags: ["vip", "enterprise"],
          rpm: 200,
          dailyQuota: 500,
          limit5hUsd: 100,
          limitWeeklyUsd: 500,
          limitMonthlyUsd: 2000,
          limitTotalUsd: 10000,
          limitConcurrentSessions: 10,
          isEnabled: true,
          expiresAt: "2026-12-31T23:59:59.999Z",
        },
      },
    },
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
    summary: "编辑用户信息",
    tags: ["用户管理"],
    requiredRole: "admin",
    // 修复：显式指定参数映射
    argsMapper: (body) => {
      const { userId, ...data } = body;
      return [userId, data];
    },
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
    summary: "删除用户",
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
    summary: "获取用户限额使用情况",
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
    summary: "获取用户的密钥列表",
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
      limitDailyUsd: z.number().nullable().optional(),
      limitWeeklyUsd: z.number().nullable().optional(),
      limitMonthlyUsd: z.number().nullable().optional(),
      limitTotalUsd: z.number().nullable().optional(),
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
      limitDailyUsd: z.number().nullable().optional(),
      limitWeeklyUsd: z.number().nullable().optional(),
      limitMonthlyUsd: z.number().nullable().optional(),
      limitTotalUsd: z.number().nullable().optional(),
      limitConcurrentSessions: z.number().optional(),
    }),
    description: "编辑密钥信息",
    summary: "编辑密钥信息",
    tags: ["密钥管理"],
    // 修复：显式指定参数映射
    argsMapper: (body) => {
      const { keyId, ...data } = body;
      return [keyId, data];
    },
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
    summary: "删除密钥",
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
    summary: "获取密钥限额使用情况",
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
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.array(
      z.object({
        id: z.number().describe("供应商 ID"),
        name: z.string().describe("供应商名称"),
        providerType: z.string().describe("供应商类型"),
        url: z.string().describe("API 地址"),
        apiKey: z.string().describe("API 密钥（脱敏）"),
        isEnabled: z.boolean().describe("是否启用"),
        weight: z.number().describe("权重"),
        priority: z.number().describe("优先级"),
        costMultiplier: z.number().describe("成本系数"),
        modelRedirects: z.record(z.string(), z.string()).nullable().describe("模型重定向映射"),
        proxyUrl: z.string().nullable().describe("代理地址"),
        maxConcurrency: z.number().nullable().describe("最大并发数"),
        rpmLimit: z.number().nullable().describe("RPM 限制"),
        dailyCostLimit: z.number().nullable().describe("每日成本限制"),
        groups: z.array(z.string()).describe("分组"),
        createdAt: z.string().describe("创建时间"),
      })
    ),
    description: "获取所有供应商列表 (管理员)",
    summary: "获取供应商列表",
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
    summary: "创建新供应商",
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
    summary: "编辑供应商信息",
    tags: ["供应商管理"],
    requiredRole: "admin",
    // 修复：显式指定参数映射
    argsMapper: (body) => {
      const { providerId, ...data } = body;
      return [providerId, data];
    },
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
    summary: "删除供应商",
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
      requestSchema: z.object({}).describe("无需请求参数"),
      description: "获取所有供应商的熔断器健康状态 (管理员)",
      summary: "获取供应商健康状态",
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
    summary: "重置供应商熔断器",
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
    summary: "获取供应商限额使用情况",
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "获取所有模型价格 (管理员)",
    summary: "获取模型价格列表",
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
    summary: "上传模型价格表",
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
    requestSchema: z.object({}).describe("无需请求参数"),
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "获取可用模型列表 (按供应商类型分组)",
    summary: "获取可用模型列表",
    tags: ["模型价格"],
  }
);
app.openapi(getAvailableModelsByProviderTypeRoute, getAvailableModelsByProviderTypeHandler);

const { route: hasPriceTableRoute, handler: hasPriceTableHandler } = createActionRoute(
  "model-prices",
  "hasPriceTable",
  modelPriceActions.hasPriceTable,
  {
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.boolean(),
    description: "检查是否有价格表",
    summary: "检查价格表状态",
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
      timeRange: z.enum(["today", "7days", "30days", "thisMonth"]),
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
      userId: z.number().int().positive().optional(),
      keyId: z.number().int().positive().optional(),
      providerId: z.number().int().positive().optional(),
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime().optional(),
      startDateLocal: z.string().optional(),
      endDateLocal: z.string().optional(),
      model: z.string().optional(),
      endpoint: z.string().optional(),
      statusCode: z.number().optional(),
      excludeStatusCode200: z.boolean().optional(),
      minRetryCount: z.number().int().nonnegative().optional(),
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
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.array(z.string()),
    description: "获取日志中的模型列表",
    summary: "获取日志中的模型列表",
    tags: ["使用日志"],
  }
);
app.openapi(getModelListRoute, getModelListHandler);

const { route: getStatusCodeListRoute, handler: getStatusCodeListHandler } = createActionRoute(
  "usage-logs",
  "getStatusCodeList",
  usageLogActions.getStatusCodeList,
  {
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.array(z.number()),
    description: "获取日志中的状态码列表",
    summary: "获取日志中的状态码列表",
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
    requestSchema: z.object({}).describe("无需请求参数"),
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "获取敏感词列表 (管理员)",
    summary: "获取敏感词列表",
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
    summary: "创建敏感词",
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
    summary: "更新敏感词",
    tags: ["敏感词管理"],
    requiredRole: "admin",
    // 修复：显式指定参数映射
    argsMapper: (body) => {
      const { id, ...updates } = body;
      return [id, updates];
    },
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
    summary: "删除敏感词",
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "手动刷新敏感词缓存 (管理员)",
    summary: "刷新敏感词缓存",
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "获取敏感词缓存统计信息 (管理员)",
    summary: "获取缓存统计信息",
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
    requestSchema: z.object({}).describe("无需请求参数"),
    description: "获取活跃 Session 列表",
    summary: "获取活跃 Session 列表",
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
    summary: "获取 Session 详情",
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
    summary: "获取 Session 消息内容",
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
      requestSchema: z.object({}).describe("无需请求参数"),
      description: "获取通知设置",
      summary: "获取通知设置",
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
      summary: "更新通知设置",
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
      type: z.enum(NOTIFICATION_JOB_TYPES),
    }),
    description: "测试 Webhook 配置",
    summary: "测试 Webhook 配置",
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
      description: "生产环境 - 已通过 APP_URL 环境变量配置的应用地址",
    });
  }

  // 降级：添加常见的开发环境地址
  if (process.env.NODE_ENV !== "production") {
    servers.push({
      url: "http://localhost:13500",
      description: "本地开发环境 - 默认端口 13500",
    });
  }

  // 兜底：如果没有配置，提供占位符提示
  if (servers.length === 0) {
    servers.push({
      url: "https://your-domain.com",
      description: "请配置 APP_URL 环境变量指定生产环境地址",
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

## 认证方式

所有 API 端点通过 **HTTP Cookie** 进行认证，Cookie 名称为 \`auth-token\`。

### 如何获取认证 Token

#### 方法 1：通过 Web UI 登录（推荐）

1. 访问 Claude Code Hub 登录页面
2. 使用您的 API Key 或管理员令牌（ADMIN_TOKEN）登录
3. 登录成功后，浏览器会自动设置 \`auth-token\` Cookie
4. 在同一浏览器中访问 API 文档页面即可直接测试（Cookie 自动携带）

#### 方法 2：手动获取 Cookie（用于脚本或编程调用）

登录成功后，可以从浏览器开发者工具中获取 Cookie 值：

1. 打开浏览器开发者工具（F12）
2. 切换到 "Application" 或 "Storage" 标签
3. 在 Cookies 中找到 \`auth-token\` 的值
4. 复制该值用于 API 调用

### 使用示例

#### curl 示例

\`\`\`bash
# 使用 Cookie 认证调用 API
curl -X POST 'http://localhost:23000/api/actions/users/getUsers' \\
  -H 'Content-Type: application/json' \\
  -H 'Cookie: auth-token=your-token-here' \\
  -d '{}'
\`\`\`

#### JavaScript (fetch) 示例

\`\`\`javascript
// 浏览器环境（Cookie 自动携带）
fetch('/api/actions/users/getUsers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include', // 重要：携带 Cookie
  body: JSON.stringify({}),
})
  .then(res => res.json())
  .then(data => console.log(data));

// Node.js 环境（需要手动设置 Cookie）
const fetch = require('node-fetch');

fetch('http://localhost:23000/api/actions/users/getUsers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'auth-token=your-token-here',
  },
  body: JSON.stringify({}),
})
  .then(res => res.json())
  .then(data => console.log(data));
\`\`\`

#### Python 示例

\`\`\`python
import requests

# 使用 Session 保持 Cookie
session = requests.Session()

# 方式 1：手动设置 Cookie
session.cookies.set('auth-token', 'your-token-here')

# 方式 2：或者在请求头中设置
headers = {
    'Content-Type': 'application/json',
    'Cookie': 'auth-token=your-token-here'
}

response = session.post(
    'http://localhost:23000/api/actions/users/getUsers',
    json={},
    headers=headers
)

print(response.json())
\`\`\`

## 权限

- 👤 **普通用户**: 可以查看自己的数据和使用统计
- 👑 **管理员**: 拥有完整的系统管理权限

标记为 \`[管理员]\` 的端点需要管理员权限。

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
  "error": "错误消息",
  "errorCode": "ERROR_CODE",  // 可选：错误码（用于国际化）
  "errorParams": { ... }       // 可选：错误参数
}
\`\`\`

HTTP 状态码:
- \`200\`: 操作成功
- \`400\`: 请求错误 (参数验证失败或业务逻辑错误)
- \`401\`: 未认证 (需要登录或 Cookie 无效)
- \`403\`: 权限不足
- \`500\`: 服务器内部错误

### 常见认证错误

| HTTP 状态码 | 错误消息 | 原因 | 解决方法 |
|-----------|---------|-----|---------|
| 401 | "未认证" | 缺少 \`auth-token\` Cookie | 先通过 Web UI 登录 |
| 401 | "认证无效或已过期" | Cookie 无效或已过期 | 重新登录获取新 Cookie |
| 403 | "权限不足" | 普通用户访问管理员端点 | 使用管理员账号登录 |
    `,
    contact: {
      name: "项目维护团队",
      url: "https://github.com/ding113/claude-code-hub/issues",
    },
    license: {
      name: "MIT License",
      url: "https://github.com/ding113/claude-code-hub/blob/main/LICENSE",
    },
  },
  servers: getOpenAPIServers(),
  tags: [
    {
      name: "用户管理",
      description: "用户账号的创建、编辑、删除和限额配置,支持 RPM、金额限制和并发会话控制",
    },
    {
      name: "密钥管理",
      description: "为用户生成 API 密钥,支持独立的金额限制、过期时间和 Web UI 登录权限配置",
    },
    {
      name: "供应商管理",
      description: "配置上游 API 供应商,包括权重调度、熔断保护、代理设置和健康状态监控",
    },
    {
      name: "模型价格",
      description: "管理模型价格表,支持手动上传 JSON 或从 LiteLLM 官方仓库同步最新价格",
    },
    {
      name: "统计分析",
      description: "查看用户消费统计、请求量趋势和成本分析,支持多种时间维度的数据汇总",
    },
    {
      name: "使用日志",
      description: "查询 API 请求日志,支持按用户、模型、时间范围、状态码等多条件过滤",
    },
    {
      name: "概览",
      description: "展示系统运行状态概览,包括并发数、今日统计、活跃用户和时间分布图表",
    },
    {
      name: "敏感词管理",
      description: "配置内容审核规则,支持正则表达式匹配和缓存刷新,用于风险控制",
    },
    {
      name: "Session 管理",
      description: "查看活跃会话列表、会话详情和消息内容,用于并发控制和请求追踪",
    },
    {
      name: "通知管理",
      description: "配置 Webhook 通知,接收系统事件推送(如限额预警、熔断触发等)",
    },
  ],
  externalDocs: {
    description: "GitHub 仓库 - 查看完整文档、功能介绍和部署指南",
    url: "https://github.com/ding113/claude-code-hub",
  },
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
