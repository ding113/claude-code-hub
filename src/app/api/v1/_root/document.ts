import type { OpenAPIHono } from "@hono/zod-openapi";
import { CSRF_HEADER, MANAGEMENT_API_VERSION } from "@/lib/api/v1/_shared/constants";

export const openApiDocumentConfig = {
  openapi: "3.1.0",
  info: {
    title: "Claude Code Hub Management API",
    version: MANAGEMENT_API_VERSION,
    description:
      "REST management API for Claude Code Hub. This HTTP surface is mounted separately from the proxy /v1 API and the deprecated /api/actions API while intentionally reusing existing server-side business actions during migration.",
    contact: {
      name: "Claude Code Hub maintainers",
      url: "https://github.com/ding113/claude-code-hub/issues",
    },
    license: {
      name: "MIT License",
      url: "https://github.com/ding113/claude-code-hub/blob/main/LICENSE",
    },
  },
  servers: [
    {
      url: "/",
      description: "Management REST API",
    },
  ],
  tags: [
    { name: "System", description: "Health, metadata, and API utility routes." },
    { name: "Auth", description: "Authentication and CSRF helper routes." },
    { name: "Users", description: "User and key management routes." },
    { name: "Providers", description: "Provider, endpoint, and group management routes." },
    {
      name: "Observability",
      description: "Usage logs, audit logs, sessions, and dashboard routes.",
    },
    { name: "Public", description: "Public status and public read routes." },
  ],
};

export function buildOpenApiDocument(
  app: OpenAPIHono
): ReturnType<OpenAPIHono["getOpenAPIDocument"]> {
  const document = app.getOpenAPIDocument(openApiDocumentConfig);
  fillOperationIds(document);
  appendCsrfHeaderParameter(document);
  appendDefaultExamples(document);
  return document;
}

type OpenApiDocument = ReturnType<OpenAPIHono["getOpenAPIDocument"]>;

const mutationMethods = new Set(["post", "put", "patch", "delete"]);
const operationMethods = new Set(["get", "post", "put", "patch", "delete", "options"]);

function fillOperationIds(document: OpenApiDocument): void {
  const seen = new Map<string, number>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operationMethods.has(method)) continue;
      if (!operation || typeof operation !== "object") continue;

      const op = operation as { operationId?: string };
      if (op.operationId) continue;

      const baseId = toOperationId(method, path);
      const count = seen.get(baseId) ?? 0;
      seen.set(baseId, count + 1);
      op.operationId = count === 0 ? baseId : `${baseId}${count + 1}`;
    }
  }
}

function toOperationId(method: string, path: string): string {
  const normalizedPath = path
    .replace(/^\/api\/v1\/?/, "")
    .replace(/\{([^}]+)\}/g, "by-$1")
    .replace(/:/g, "-")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  const parts = [method, ...normalizedPath.split(/\s+/).filter(Boolean)];
  return parts
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

function appendCsrfHeaderParameter(document: OpenApiDocument): void {
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!mutationMethods.has(method)) continue;
      if (!operation || typeof operation !== "object") continue;

      const op = operation as {
        parameters?: Array<{ name?: string; in?: string } | Record<string, unknown>>;
      };
      if (op.parameters?.some((param) => param.name === CSRF_HEADER && param.in === "header")) {
        continue;
      }

      op.parameters = [
        ...(op.parameters ?? []),
        {
          name: CSRF_HEADER,
          in: "header",
          required: false,
          description:
            "Required only when authenticating with the auth-token cookie on mutation requests.",
          schema: { type: "string" },
        },
      ];
    }
  }
}

function appendDefaultExamples(document: OpenApiDocument): void {
  for (const pathItem of Object.values(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operationMethods.has(method)) continue;
      if (!operation || typeof operation !== "object") continue;

      const op = operation as {
        requestBody?: { content?: Record<string, Record<string, unknown>> };
        responses?: Record<string, { content?: Record<string, Record<string, unknown>> }>;
      };

      for (const [mediaType, media] of Object.entries(op.requestBody?.content ?? {})) {
        ensureMediaExample(mediaType, media, true);
      }

      for (const response of Object.values(op.responses ?? {})) {
        for (const [mediaType, media] of Object.entries(response.content ?? {})) {
          ensureMediaExample(mediaType, media, false);
        }
      }
    }
  }
}

function ensureMediaExample(
  mediaType: string,
  media: Record<string, unknown>,
  isRequest: boolean
): void {
  if ("example" in media || "examples" in media) return;

  media.examples = {
    default: {
      summary: isRequest ? "Example request" : "Example response",
      value: defaultExampleValue(mediaType),
    },
  };
}

function defaultExampleValue(mediaType: string): unknown {
  if (mediaType === "application/problem+json") {
    return {
      type: "https://claude-code-hub.local/problems/request.validation_failed",
      title: "Validation failed",
      status: 400,
      detail: "One or more fields are invalid.",
      instance: "/api/v1/resource",
      errorCode: "request.validation_failed",
    };
  }
  if (mediaType.startsWith("text/")) return "example";
  return {};
}
