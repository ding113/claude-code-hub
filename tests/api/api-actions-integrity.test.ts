/**
 * Server Actions 完整性测试
 *
 * 目的:
 * - 验证所有 Server Actions 是否都被正确注册到 OpenAPI
 * - 通过 OpenAPI 文档验证端点完整性（避免直接导入 Server Actions）
 * - 确保没有遗漏的接口
 *
 * 用法:
 *   bun run test:api
 */

import { beforeAll, describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

type OpenAPIDocument = {
  paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
};

describe("OpenAPI 端点完整性检查", () => {
  let openApiDoc: OpenAPIDocument;

  beforeAll(async () => {
    const { response, json } = await callActionsRoute({
      method: "GET",
      pathname: "/api/actions/openapi.json",
    });
    expect(response.ok).toBe(true);
    openApiDoc = json as OpenAPIDocument;
  });

  test("用户管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/users/getUsers",
      "/api/actions/users/addUser",
      "/api/actions/users/editUser",
      "/api/actions/users/removeUser",
      "/api/actions/users/getUserLimitUsage",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("密钥管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/keys/getKeys",
      "/api/actions/keys/addKey",
      "/api/actions/keys/editKey",
      "/api/actions/keys/removeKey",
      "/api/actions/keys/getKeyLimitUsage",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("供应商管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/providers/getProviders",
      "/api/actions/providers/addProvider",
      "/api/actions/providers/editProvider",
      "/api/actions/providers/removeProvider",
      "/api/actions/providers/getProvidersHealthStatus",
      "/api/actions/providers/resetProviderCircuit",
      "/api/actions/providers/getProviderLimitUsage",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("模型价格模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/model-prices/getModelPrices",
      "/api/actions/model-prices/uploadPriceTable",
      "/api/actions/model-prices/syncLiteLLMPrices",
      "/api/actions/model-prices/getAvailableModelsByProviderType",
      "/api/actions/model-prices/hasPriceTable",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("统计分析模块的所有端点应该被注册", () => {
    const expectedPaths = ["/api/actions/statistics/getUserStatistics"];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("使用日志模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/usage-logs/getUsageLogs",
      "/api/actions/usage-logs/getModelList",
      "/api/actions/usage-logs/getStatusCodeList",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("我的用量模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/my-usage/getMyUsageMetadata",
      "/api/actions/my-usage/getMyQuota",
      "/api/actions/my-usage/getMyTodayStats",
      "/api/actions/my-usage/getMyUsageLogs",
      "/api/actions/my-usage/getMyAvailableModels",
      "/api/actions/my-usage/getMyAvailableEndpoints",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("概览模块的所有端点应该被注册", () => {
    const expectedPaths = ["/api/actions/overview/getOverviewData"];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("敏感词管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/sensitive-words/listSensitiveWords",
      "/api/actions/sensitive-words/createSensitiveWordAction",
      "/api/actions/sensitive-words/updateSensitiveWordAction",
      "/api/actions/sensitive-words/deleteSensitiveWordAction",
      "/api/actions/sensitive-words/refreshCacheAction",
      "/api/actions/sensitive-words/getCacheStats",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("Session 管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/active-sessions/getActiveSessions",
      "/api/actions/active-sessions/getSessionDetails",
      "/api/actions/active-sessions/getSessionMessages",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("通知管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/notifications/getNotificationSettingsAction",
      "/api/actions/notifications/updateNotificationSettingsAction",
      "/api/actions/notifications/testWebhookAction",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("Webhook 目标管理模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/webhook-targets/getWebhookTargetsAction",
      "/api/actions/webhook-targets/createWebhookTargetAction",
      "/api/actions/webhook-targets/updateWebhookTargetAction",
      "/api/actions/webhook-targets/deleteWebhookTargetAction",
      "/api/actions/webhook-targets/testWebhookTargetAction",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("通知绑定模块的所有端点应该被注册", () => {
    const expectedPaths = [
      "/api/actions/notification-bindings/getBindingsForTypeAction",
      "/api/actions/notification-bindings/updateBindingsAction",
    ];

    for (const path of expectedPaths) {
      expect(openApiDoc.paths[path]).toBeDefined();
      expect(openApiDoc.paths[path].post).toBeDefined();
    }
  });

  test("所有端点的 summary 应该非空", () => {
    const pathsWithoutSummary: string[] = [];

    for (const [path, methods] of Object.entries(openApiDoc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation.summary || operation.summary.trim() === "") {
          pathsWithoutSummary.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(pathsWithoutSummary).toEqual([]);
  });

  test("所有端点应该分配到正确的标签", () => {
    const pathsWithWrongTags: string[] = [];

    const moduleTagMapping: Record<string, string> = {
      "/api/actions/users/": "用户管理",
      "/api/actions/keys/": "密钥管理",
      "/api/actions/providers/": "供应商管理",
      "/api/actions/model-prices/": "模型价格",
      "/api/actions/statistics/": "统计分析",
      "/api/actions/usage-logs/": "使用日志",
      "/api/actions/overview/": "概览",
      "/api/actions/sensitive-words/": "敏感词管理",
      "/api/actions/active-sessions/": "Session 管理",
      "/api/actions/notifications/": "通知管理",
      "/api/actions/webhook-targets/": "通知管理",
      "/api/actions/notification-bindings/": "通知管理",
    };

    for (const [path, methods] of Object.entries(openApiDoc.paths)) {
      const postOperation = methods.post;
      if (!postOperation || !postOperation.tags) continue;

      // 查找对应的标签
      const expectedTag = Object.entries(moduleTagMapping).find(([prefix]) =>
        path.startsWith(prefix)
      )?.[1];

      if (expectedTag && !postOperation.tags.includes(expectedTag)) {
        pathsWithWrongTags.push(
          `${path} (期望: ${expectedTag}, 实际: ${postOperation.tags.join(", ")})`
        );
      }
    }

    expect(pathsWithWrongTags).toEqual([]);
  });
});
