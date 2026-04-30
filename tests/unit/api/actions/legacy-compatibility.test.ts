/**
 * 旧版 /api/actions/* 兼容性测试
 *
 * 当 ENABLE_LEGACY_ACTIONS_API=true（默认）时：
 * - 业务执行端点的成功/错误响应体结构保持不变（{ ok: true, data: ... } / { ok: false, error: ... }）
 * - OpenAPI 文档（/api/actions/openapi.json）依旧符合既有规范（与 tests/api/api-openapi-spec.test.ts 对齐）
 *
 * 注意：
 * - 不依赖真实 DB；通过未携带 auth-token 的请求触发 ActionAdapter 的统一 401 错误体（保留旧版结构）
 * - 选取 tests/api/api-openapi-spec.test.ts 中两条已知形状断言进行 parity 校验
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvConfigForTests } from "@/lib/config/env.schema";
import { callActionsRoute } from "../../../test-utils";

type LegacyErrorBody = {
  ok: false;
  error: string;
  errorCode?: string;
};

type OpenAPIDocument = {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<
    string,
    Record<
      string,
      {
        summary?: string;
        description?: string;
        tags?: string[];
        deprecated?: boolean;
        responses?: Record<string, unknown>;
      }
    >
  >;
};

describe("/api/actions/* 兼容性（ENABLE_LEGACY_ACTIONS_API=true）", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
    vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
    vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2026-12-31");
    resetEnvConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigForTests();
  });

  describe("响应体形状", () => {
    it("未认证时仍使用旧版 ActionResult 错误信封（不切换为 problem+json）", async () => {
      const { response, json } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/users/getUsers",
        body: {},
      });

      // 401 + JSON 信封保持向后兼容
      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");

      const body = json as LegacyErrorBody;
      expect(body.ok).toBe(false);
      expect(typeof body.error).toBe("string");
      expect(body.error.length).toBeGreaterThan(0);

      // 同时携带 deprecation 头（不影响业务体）
      expect(response.headers.get("Deprecation")).toBe("true");
    });

    it("非 problem+json：错误响应 Content-Type 仍为 application/json", async () => {
      const { response } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/keys/getKeys",
        body: {},
      });

      const contentType = response.headers.get("content-type") ?? "";
      expect(contentType).toContain("application/json");
      // 不应回退到 problem+json（仅 ENABLE_LEGACY_ACTIONS_API=false 才切换）
      expect(contentType).not.toContain("problem");
    });
  });

  describe("OpenAPI 规范 parity（与 tests/api/api-openapi-spec.test.ts 对齐）", () => {
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

    it("符合 OpenAPI 3.1.0 规范（parity: api-openapi-spec.test.ts#应该符合 OpenAPI 3.1.0 规范）", () => {
      expect(openApiDoc.openapi).toBe("3.1.0");
      expect(openApiDoc.info).toBeDefined();
      expect(openApiDoc.info.title).toBe("Claude Code Hub API");
      expect(openApiDoc.info.version).toBeDefined();
    });

    it("/api/actions/users/getUsers 端点存在并定义 200/400/401/500 响应（parity: 应该包含标准错误响应定义）", () => {
      const operation = openApiDoc.paths["/api/actions/users/getUsers"]?.post;
      expect(operation).toBeDefined();
      expect(operation?.responses).toBeDefined();
      expect(operation?.responses?.["200"]).toBeDefined();
      expect(operation?.responses?.["400"]).toBeDefined();
      expect(operation?.responses?.["401"]).toBeDefined();
      expect(operation?.responses?.["500"]).toBeDefined();
    });

    it("旧版执行端点的 OpenAPI 路由应被标记为 deprecated", () => {
      const operation = openApiDoc.paths["/api/actions/users/getUsers"]?.post;
      expect(operation?.deprecated).toBe(true);
    });

    it("旧版接口的 deprecated 标记覆盖多个模块（抽样：keys/providers/model-prices）", () => {
      const sampledPaths = [
        "/api/actions/keys/getKeys",
        "/api/actions/providers/getProviders",
        "/api/actions/model-prices/getModelPrices",
      ];
      for (const path of sampledPaths) {
        const operation = openApiDoc.paths[path]?.post;
        expect(operation, `expected ${path} to be defined`).toBeDefined();
        expect(operation?.deprecated, `expected ${path} to be deprecated`).toBe(true);
      }
    });
  });
});
