import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, test } from "vitest";
import { CSRF_HEADER } from "@/lib/api/v1/_shared/constants";
import { registerDocs } from "@/app/api/v1/_root/docs";
import { callV1Route } from "../../../api/v1/test-utils";

type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, unknown> };
};

const operationMethods = new Set(["get", "post", "put", "patch", "delete", "options"]);
const mutationMethods = new Set(["post", "put", "patch", "delete"]);

describe("v1 management docs routes", () => {
  test("adds management security headers to docs responses", async () => {
    const { response } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });

    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("content-security-policy-report-only")).toContain(
      "frame-ancestors 'none'"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("exposes a separate OpenAPI document", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;

    expect(response.status).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.title).toBe("Claude Code Hub Management API");
    expect(document.info.version).toBe("1.0.0");
    expect(document.servers?.[0]?.url).toBe("/");
    expect(document.components?.securitySchemes).toHaveProperty("bearerAuth");
    expect(document.components?.securitySchemes).toHaveProperty("apiKeyAuth");
    expect(document.components?.securitySchemes).toHaveProperty("cookieAuth");
  });

  test("keeps exactly one management API prefix in generated clients", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;
    const pathNames = Object.keys(document.paths);

    expect(document.servers?.[0]?.url).toBe("/");
    expect(pathNames).toContain("/api/v1/users");
    expect(pathNames).not.toContain("/api/v1/api/v1/users");
  });

  test("does not mix legacy action or proxy paths into the management spec", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;
    const paths = Object.keys(document.paths);

    expect(paths.some((path) => path.startsWith("/api/actions"))).toBe(false);
    expect(paths).not.toContain("/v1/messages");
    expect(paths).not.toContain("/api/v1/messages");
  });

  test("declares required access level on every operation", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;
    const missing: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operationMethods.has(method)) continue;
        const requiredAccess = (operation as { "x-required-access"?: unknown })[
          "x-required-access"
        ];
        if (!["public", "read", "admin"].includes(String(requiredAccess))) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("keeps operation metadata complete and excludes deprecated provider fields", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;
    const invalidOperations: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths)) {
      expect(path.startsWith("/api/v1/")).toBe(true);
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operationMethods.has(method)) continue;
        const op = operation as {
          summary?: unknown;
          description?: unknown;
          tags?: unknown;
          responses?: unknown;
          security?: unknown;
          "x-required-access"?: unknown;
        };
        if (
          typeof op.summary !== "string" ||
          typeof op.description !== "string" ||
          !Array.isArray(op.tags) ||
          typeof op.responses !== "object" ||
          (op["x-required-access"] !== "public" && !Array.isArray(op.security))
        ) {
          invalidOperations.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    const providerPaths = Object.fromEntries(
      Object.entries(document.paths).filter(([path]) => path.startsWith("/api/v1/providers"))
    );
    const serializedProviderPaths = JSON.stringify(providerPaths);
    expect(invalidOperations).toEqual([]);
    expect(serializedProviderPaths).not.toContain("claude-auth");
    expect(serializedProviderPaths).not.toContain("gemini-cli");
    expect(serializedProviderPaths).not.toContain('"tpm"');
    expect(serializedProviderPaths).not.toContain('"rpm"');
    expect(serializedProviderPaths).not.toContain('"rpd"');
    expect(serializedProviderPaths).not.toContain('"cc"');
  });

  test("documents problem details with stable URN examples", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const serialized = JSON.stringify(json);

    expect(serialized).toContain("urn:claude-code-hub:problem:request.validation_failed");
    expect(serialized).not.toContain("claude-code-hub.local");
  });

  test("declares the runtime CSRF header on every mutation operation", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDoc;
    const missing: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!mutationMethods.has(method)) continue;
        const parameters = (operation as { parameters?: Array<{ name?: string; in?: string }> })
          .parameters;
        const hasCsrfHeader = parameters?.some(
          (parameter) => parameter.name === CSRF_HEADER && parameter.in === "header"
        );
        if (!hasCsrfHeader) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("returns problem+json when OpenAPI generation fails", async () => {
    const app = new OpenAPIHono().basePath("/api/v1");
    registerDocs(app, () => {
      throw new Error("boom");
    });

    const response = await app.request("/api/v1/openapi.json");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(body).toMatchObject({
      status: 500,
      errorCode: "openapi.generation_failed",
      instance: "/api/v1/openapi.json",
    });
  });
});
