/**
 * /api/v1 管理 API：文档路由与 OpenAPI 规范单元测试
 *
 * 验证：
 * - GET /api/v1/scalar 返回 Scalar HTML；
 * - GET /api/v1/docs 返回 Swagger UI HTML；
 * - OpenAPI 文档不包含遗留 /api/actions/* 路径；
 * - components.securitySchemes 至少包含 bearerAuth / apiKeyAuth / cookieAuth；
 * - 整份文档不包含 "claude-auth" / "gemini-cli" 等已废弃的 provider 类型枚举值；
 * - 已声明的每个 operation 都必须配置 security 字段（当前为 0 个，断言空集合）。
 */

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/[...route]/route";

async function getRoute(pathname: string): Promise<Response> {
  const url = new URL(pathname, "http://localhost");
  const request = new Request(url, { method: "GET" });
  return GET(request);
}

async function getJson<T = unknown>(pathname: string): Promise<{ response: Response; body: T }> {
  const response = await getRoute(pathname);
  const body = (await response.json()) as T;
  return { response, body };
}

async function getText(pathname: string): Promise<{ response: Response; body: string }> {
  const response = await getRoute(pathname);
  const body = await response.text();
  return { response, body };
}

type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string };
  servers?: Array<{ url: string }>;
  paths?: Record<string, Record<string, { security?: Array<Record<string, unknown>> }>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
};

const OPENAPI_VERBS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

describe("/api/v1 docs routes & OpenAPI spec", () => {
  it("GET /api/v1/scalar returns Scalar HTML", async () => {
    const { response, body } = await getText("/api/v1/scalar");
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
    expect(body.toLowerCase()).toContain("scalar");
  });

  it("GET /api/v1/docs returns Swagger UI HTML", async () => {
    const { response, body } = await getText("/api/v1/docs");
    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
    const lower = body.toLowerCase();
    expect(lower.includes("swagger") || lower.includes("swaggeruibundle")).toBe(true);
  });

  it("OpenAPI document does not declare any legacy /api/actions/* paths", async () => {
    const { body } = await getJson<OpenApiDocument>("/api/v1/openapi.json");
    const paths = body.paths ?? {};
    const legacyKeys = Object.keys(paths).filter((p) => p.startsWith("/api/actions/"));
    expect(legacyKeys).toEqual([]);
    // 显式断言一个具体的旧路径不存在
    expect(paths["/api/actions/users/getUsers"]).toBeUndefined();
  });

  it("components.securitySchemes contains bearerAuth, apiKeyAuth, and cookieAuth", async () => {
    const { body } = await getJson<OpenApiDocument>("/api/v1/openapi.json");
    const schemes = body.components?.securitySchemes ?? {};
    expect(Object.keys(schemes)).toEqual(
      expect.arrayContaining(["bearerAuth", "apiKeyAuth", "cookieAuth"])
    );
  });

  it("OpenAPI document never references deprecated provider enum values", async () => {
    const { body } = await getJson<OpenApiDocument>("/api/v1/openapi.json");
    const slice = {
      paths: body.paths ?? {},
      schemas: body.components?.schemas ?? {},
    };
    const serialized = JSON.stringify(slice);
    expect(serialized.includes("claude-auth")).toBe(false);
    expect(serialized.includes("gemini-cli")).toBe(false);
  });

  it("every defined operation declares a security requirement (or explicit public)", async () => {
    // OpenAPI 3.x: an operation must declare `security`. An array with at
    // least one requirement object means "auth required", and an explicit
    // empty array `security: []` means "no auth required" (public override).
    // Both are acceptable; only operations that omit `security` entirely
    // (defaulting to the document-level requirement, which we do not set)
    // are flagged.
    const { body } = await getJson<OpenApiDocument>("/api/v1/openapi.json");
    const paths = body.paths ?? {};

    const offenders: string[] = [];
    for (const [pathKey, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const [verb, operation] of Object.entries(pathItem)) {
        if (!OPENAPI_VERBS.has(verb.toLowerCase())) continue;
        const op = operation as { security?: Array<Record<string, unknown>> } | undefined;
        if (!op || !Array.isArray(op.security)) {
          offenders.push(`${verb.toUpperCase()} ${pathKey}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
