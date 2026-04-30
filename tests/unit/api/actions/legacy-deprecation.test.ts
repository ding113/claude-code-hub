/**
 * 旧版 /api/actions/* 废弃头与禁用/隐藏行为
 *
 * 覆盖：
 * 1. 默认情况下，每个 /api/actions/* 响应携带 Deprecation/Sunset/Link/Warning 头
 * 2. ENABLE_LEGACY_ACTIONS_API=false 时，执行端点（{module}/{action}）返回 410 Gone (problem+json)
 * 3. LEGACY_ACTIONS_DOCS_MODE=hidden 时，文档 URL（openapi.json/docs/scalar）返回 404 (problem+json)
 *
 * 注意：
 * - 不依赖真实数据库；使用未携带 auth token 的请求即可触发已挂载的中间件路径
 * - 中间件位于路由匹配之前，因此即使下游 handler 返回 401/200，头部仍会被附加
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvConfigForTests } from "@/lib/config/env.schema";
import { callActionsRoute } from "../../../test-utils";

const SUCCESSOR_LINK = '</api/v1/openapi.json>; rel="successor-version"';
const DEPRECATION_WARNING = '299 - "The /api/actions API is deprecated; use /api/v1"';

describe("/api/actions/* 废弃头与开关行为", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvConfigForTests();
  });

  describe("默认行为：附加 deprecation 头", () => {
    it("POST /api/actions/users/getUsers 携带四个废弃头", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2026-12-31");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/users/getUsers",
        body: {},
      });

      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Sunset")).toBe("2026-12-31");
      expect(response.headers.get("Link")).toBe(SUCCESSOR_LINK);
      expect(response.headers.get("Warning")).toBe(DEPRECATION_WARNING);
    });

    it("GET /api/actions/openapi.json 在 deprecated 模式下携带废弃头", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2026-12-31");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/openapi.json",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Sunset")).toBe("2026-12-31");
      expect(response.headers.get("Link")).toBe(SUCCESSOR_LINK);
      expect(response.headers.get("Warning")).toBe(DEPRECATION_WARNING);
    });

    it("Sunset 头跟随 LEGACY_ACTIONS_SUNSET_DATE 变化", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2027-06-30");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/users/getUsers",
        body: {},
      });

      expect(response.headers.get("Sunset")).toBe("2027-06-30");
    });
  });

  describe("ENABLE_LEGACY_ACTIONS_API=false 短路返回 410", () => {
    it("/api/actions/users/getUsers 返回 410 problem+json", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      vi.stubEnv("LEGACY_ACTIONS_SUNSET_DATE", "2026-12-31");
      resetEnvConfigForTests();

      const { response, text } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/users/getUsers",
        body: {},
      });

      expect(response.status).toBe(410);
      expect(response.headers.get("Content-Type")).toContain("application/problem+json");

      // 410 响应仍应携带废弃头
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Sunset")).toBe("2026-12-31");
      expect(response.headers.get("Link")).toBe(SUCCESSOR_LINK);
      expect(response.headers.get("Warning")).toBe(DEPRECATION_WARNING);

      const body = JSON.parse(text ?? "{}") as Record<string, unknown>;
      expect(body.title).toBe("Gone");
      expect(body.status).toBe(410);
      expect(body.detail).toBe("/api/actions/* has been disabled");
      expect(body.errorCode).toBe("API_GONE");
      expect(body.link).toBe("/api/v1/openapi.json");
      expect(body.instance).toBe("/api/actions/users/getUsers");
    });

    it("/api/actions/keys/getKeys 也返回 410", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
      resetEnvConfigForTests();

      const { response, text } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/keys/getKeys",
        body: {},
      });

      expect(response.status).toBe(410);
      const body = JSON.parse(text ?? "{}") as Record<string, unknown>;
      expect(body.errorCode).toBe("API_GONE");
    });

    it("ENABLE_LEGACY_ACTIONS_API=false 时文档路由不会被 410 影响", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "false");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "deprecated");
      resetEnvConfigForTests();

      // openapi.json 是文档路径，不应被 410 短路
      const { response } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/openapi.json",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
    });
  });

  describe("LEGACY_ACTIONS_DOCS_MODE=hidden 文档返回 404", () => {
    it("/api/actions/openapi.json 返回 404 problem+json", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
      resetEnvConfigForTests();

      const { response, text } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/openapi.json",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toContain("application/problem+json");

      const body = JSON.parse(text ?? "{}") as Record<string, unknown>;
      expect(body.title).toBe("Not Found");
      expect(body.status).toBe(404);
      expect(body.errorCode).toBe("NOT_FOUND");
      expect(body.link).toBe("/api/v1/openapi.json");
    });

    it("/api/actions/docs 返回 404 problem+json", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/docs",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    });

    it("/api/actions/scalar 返回 404 problem+json", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "GET",
        pathname: "/api/actions/scalar",
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    });

    it("hidden 模式不会阻止执行端点（继续走原有 401/业务逻辑）", async () => {
      vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
      vi.stubEnv("LEGACY_ACTIONS_DOCS_MODE", "hidden");
      resetEnvConfigForTests();

      const { response } = await callActionsRoute({
        method: "POST",
        pathname: "/api/actions/users/getUsers",
        body: {},
      });

      // 没有 token 会得到 401，但中间件不会强制返回 404
      expect(response.status).not.toBe(404);
      expect(response.headers.get("Deprecation")).toBe("true");
    });
  });
});
