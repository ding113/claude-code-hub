import { swaggerUI } from "@hono/swagger-ui";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { createProblemResponse } from "@/lib/api/v1/_shared/error-envelope";
import { logger } from "@/lib/logger";
import { buildOpenApiDocument } from "./document";

type BuildOpenApiDocument = typeof buildOpenApiDocument;

export function registerDocs(
  app: OpenAPIHono,
  buildDocument: BuildOpenApiDocument = buildOpenApiDocument
): void {
  app.get("/openapi.json", (c) => {
    try {
      return c.json(buildDocument(app));
    } catch (error) {
      logger.error("GET /api/v1/openapi.json failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return createProblemResponse({
        status: 500,
        instance: new URL(c.req.url).pathname,
        errorCode: "openapi.generation_failed",
        detail: "OpenAPI generation failed.",
      });
    }
  });

  app.get("/docs", swaggerUI({ url: "/api/v1/openapi.json" }));

  app.get(
    "/scalar",
    apiReference({
      theme: "purple",
      url: "/api/v1/openapi.json",
      layout: "modern",
    })
  );
}
