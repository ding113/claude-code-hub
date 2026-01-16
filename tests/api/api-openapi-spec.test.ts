/**
 * OpenAPI 规范验证测试
 *
 * 目的:
 * - 验证生成的 OpenAPI 文档符合 3.1.0 规范
 * - 确保所有端点都有必要的文档字段（summary, description, tags）
 * - 验证 schema 定义完整性
 *
 * 用法:
 *   bun run test:api
 */

import { beforeAll, describe, expect, test } from "vitest";
import { callActionsRoute } from "../test-utils";

// 类型定义（避免引入 OpenAPI 类型包）
type OpenAPIDocument = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: { name: string; url: string };
    license?: { name: string; url: string };
  };
  servers: Array<{ url: string; description: string }>;
  paths: Record<
    string,
    Record<
      string,
      {
        summary?: string;
        description?: string;
        tags?: string[];
        parameters?: unknown[];
        requestBody?: unknown;
        responses?: Record<string, unknown>;
        security?: unknown[];
      }
    >
  >;
  tags?: Array<{ name: string; description?: string }>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
};

describe("OpenAPI 规范验证", () => {
  let openApiDoc: OpenAPIDocument;

  beforeAll(async () => {
    const { response, json } = await callActionsRoute({
      method: "GET",
      pathname: "/api/actions/openapi.json",
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("application/json");

    openApiDoc = json as OpenAPIDocument;
    expect(openApiDoc).toBeDefined();
  });

  test("应该符合 OpenAPI 3.1.0 规范", () => {
    expect(openApiDoc.openapi).toBe("3.1.0");
    expect(openApiDoc.info).toBeDefined();
    expect(openApiDoc.info.title).toBe("Claude Code Hub API");
    expect(openApiDoc.info.version).toBeDefined();
  });

  test("应该包含项目元信息", () => {
    expect(openApiDoc.info.contact).toBeDefined();
    expect(openApiDoc.info.contact?.name).toBe("项目维护团队");
    expect(openApiDoc.info.contact?.url).toContain("github.com");

    expect(openApiDoc.info.license).toBeDefined();
    expect(openApiDoc.info.license?.name).toBe("MIT License");
  });

  test("应该定义 servers 配置", () => {
    expect(openApiDoc.servers).toBeDefined();
    expect(openApiDoc.servers.length).toBeGreaterThan(0);

    for (const server of openApiDoc.servers) {
      expect(server.url).toBeDefined();
      expect(server.description).toBeDefined();
    }
  });

  test("应该定义所有标签分组", () => {
    const expectedTags = [
      "用户管理",
      "密钥管理",
      "供应商管理",
      "模型价格",
      "统计分析",
      "使用日志",
      "概览",
      "敏感词管理",
      "Session 管理",
      "通知管理",
    ];

    expect(openApiDoc.tags).toBeDefined();
    expect(openApiDoc.tags!.length).toBe(expectedTags.length);

    for (const tagName of expectedTags) {
      const tag = openApiDoc.tags!.find((t) => t.name === tagName);
      expect(tag).toBeDefined();
      expect(tag!.description).toBeDefined();
      expect(tag!.description!.length).toBeGreaterThan(10); // 确保描述足够详细
    }
  });

  test("应该定义 Cookie 认证方案", () => {
    expect(openApiDoc.components?.securitySchemes).toBeDefined();
    expect(openApiDoc.components!.securitySchemes!.cookieAuth).toBeDefined();
  });

  test("所有端点都应该有 summary 字段", () => {
    const paths = openApiDoc.paths;
    const pathsWithoutSummary: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation.summary) {
          pathsWithoutSummary.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(pathsWithoutSummary).toEqual([]);
  });

  test("所有端点都应该有 description 字段", () => {
    const paths = openApiDoc.paths;
    const pathsWithoutDescription: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation.description) {
          pathsWithoutDescription.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(pathsWithoutDescription).toEqual([]);
  });

  test("所有端点都应该有 tags 分组", () => {
    const paths = openApiDoc.paths;
    const pathsWithoutTags: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!operation.tags || operation.tags.length === 0) {
          pathsWithoutTags.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(pathsWithoutTags).toEqual([]);
  });

  test("所有 POST 端点都应该定义响应 schema", () => {
    const paths = openApiDoc.paths;
    const pathsWithoutResponses: string[] = [];

    for (const [path, methods] of Object.entries(paths)) {
      const postOperation = methods.post;
      if (postOperation && !postOperation.responses) {
        pathsWithoutResponses.push(`POST ${path}`);
      }
    }

    expect(pathsWithoutResponses).toEqual([]);
  });

  test("应该包含标准错误响应定义", () => {
    const paths = openApiDoc.paths;
    const firstPath = Object.values(paths)[0];
    const firstOperation = Object.values(firstPath)[0];

    expect(firstOperation.responses).toBeDefined();
    expect(firstOperation.responses!["200"]).toBeDefined();
    expect(firstOperation.responses!["400"]).toBeDefined();
    expect(firstOperation.responses!["401"]).toBeDefined();
    expect(firstOperation.responses!["500"]).toBeDefined();
  });

  test("端点数量应该符合预期", () => {
    const totalPaths = Object.keys(openApiDoc.paths).length;

    // 端点数量会随着功能模块增长而变化：这里只做“合理范围”约束
    expect(totalPaths).toBeGreaterThanOrEqual(40);
    expect(totalPaths).toBeLessThanOrEqual(80);
  });

  test("summary 和 description 应该不同", () => {
    const paths = openApiDoc.paths;
    const violations: string[] = [];
    const totalPaths = Object.keys(paths).length;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (operation.summary && operation.description) {
          // summary 应该是简短版本，description 可以包含更多信息
          // 如果完全相同，可能需要优化
          if (operation.summary === operation.description) {
            violations.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
    }

    // 允许部分端点 summary 和 description 相同（简单操作）
    // 但不应该太多（允许 35% 以内）
    expect(violations.length).toBeLessThan(totalPaths * 0.35);
  });
});
