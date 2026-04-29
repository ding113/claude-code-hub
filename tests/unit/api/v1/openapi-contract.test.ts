import { describe, expect, test } from "vitest";
import { CSRF_HEADER } from "@/lib/api/v1/_shared/constants";
import { callV1Route } from "../../../api/v1/test-utils";

type OpenApiOperation = {
  summary?: unknown;
  description?: unknown;
  operationId?: unknown;
  tags?: unknown;
  responses?: unknown;
  security?: unknown;
  parameters?: Array<{ name?: string; in?: string }>;
  requestBody?: { content?: Record<string, OpenApiMedia> };
  "x-required-access"?: unknown;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OpenApiOperation>>;
};

type OpenApiMedia = {
  example?: unknown;
  examples?: unknown;
};

const operationMethods = new Set(["get", "post", "put", "patch", "delete", "options"]);
const mutationMethods = new Set(["post", "put", "patch", "delete"]);

describe("v1 OpenAPI contract", () => {
  test("documents every operation with metadata, auth tier, responses, and CSRF headers", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;
    const failures: string[] = [];

    for (const [path, pathItem] of Object.entries(document.paths)) {
      if (!path.startsWith("/api/v1/")) {
        failures.push(`${path}: path must start with /api/v1/`);
      }

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operationMethods.has(method)) continue;

        const label = `${method.toUpperCase()} ${path}`;
        const requiredAccess = operation["x-required-access"];
        if (typeof operation.summary !== "string" || operation.summary.length === 0) {
          failures.push(`${label}: missing summary`);
        }
        if (typeof operation.description !== "string" || operation.description.length === 0) {
          failures.push(`${label}: missing description`);
        }
        if (typeof operation.operationId !== "string" || operation.operationId.length === 0) {
          failures.push(`${label}: missing operationId`);
        }
        if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
          failures.push(`${label}: missing tags`);
        }
        if (!operation.responses || typeof operation.responses !== "object") {
          failures.push(`${label}: missing responses`);
        } else {
          for (const [status, response] of Object.entries(
            operation.responses as Record<string, { content?: Record<string, OpenApiMedia> }>
          )) {
            for (const [mediaType, media] of Object.entries(response.content ?? {})) {
              if (!("example" in media) && !("examples" in media)) {
                failures.push(`${label} ${status} ${mediaType}: missing example`);
              }
            }
          }
        }
        for (const [mediaType, media] of Object.entries(operation.requestBody?.content ?? {})) {
          if (!("example" in media) && !("examples" in media)) {
            failures.push(`${label} request ${mediaType}: missing example`);
          }
        }
        if (!["public", "read", "admin"].includes(String(requiredAccess))) {
          failures.push(`${label}: missing x-required-access`);
        }
        if (requiredAccess !== "public" && !Array.isArray(operation.security)) {
          failures.push(`${label}: missing security declaration`);
        }
        if (mutationMethods.has(method)) {
          const hasCsrfHeader = operation.parameters?.some(
            (parameter) => parameter.name === CSRF_HEADER && parameter.in === "header"
          );
          if (!hasCsrfHeader) {
            failures.push(`${label}: missing ${CSRF_HEADER} header parameter`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  test("keeps legacy action and proxy API surfaces out of the management document", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const document = json as OpenApiDocument;
    const paths = Object.keys(document.paths);
    const serialized = JSON.stringify(document);

    expect(paths.every((path) => path.startsWith("/api/v1/"))).toBe(true);
    expect(paths.some((path) => path.startsWith("/api/actions"))).toBe(false);
    expect(paths).not.toContain("/v1/messages");
    expect(paths).not.toContain("/api/v1/messages");
    expect(serialized).not.toContain("claude-auth");
    expect(serialized).not.toContain("gemini-cli");
  });
});
