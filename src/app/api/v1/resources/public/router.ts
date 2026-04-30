import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  IpGeoLookupResponseSchema,
  IpGeoParamSchema,
  IpGeoQuerySchema,
  PublicStatusResponseSchema,
  PublicStatusSettingsUpdateResponseSchema,
  PublicStatusSettingsUpdateSchema,
} from "@/lib/api/v1/schemas/public";
import { getPublicStatus, lookupIpGeo, updatePublicStatusSettings } from "./handlers";

export const publicRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return fromZodError(result.error, new URL(c.req.url).pathname);
  },
});

const security: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
  { apiKeyAuth: [] },
];

const problemResponses = {
  400: {
    description: "Invalid request.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  401: {
    description: "Authentication required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  403: {
    description: "Access forbidden.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "Resource disabled or not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

publicRouter.openapi(
  createRoute({
    method: "get",
    path: "/public/status",
    middleware: requireAuth("public"),
    tags: ["Public Status"],
    summary: "Get public status",
    description: "Returns the public status payload without authentication.",
    "x-required-access": "public",
    responses: {
      200: {
        description: "Public status payload.",
        content: { "application/json": { schema: PublicStatusResponseSchema } },
      },
      400: problemResponses[400],
      503: {
        description: "Public status projection is rebuilding.",
        content: { "application/json": { schema: PublicStatusResponseSchema } },
      },
    },
  }),
  getPublicStatus as never
);

publicRouter.openapi(
  createRoute({
    method: "put",
    path: "/public/status/settings",
    middleware: requireAuth("admin"),
    tags: ["Public Status"],
    summary: "Update public status settings",
    description: "Updates public status group publishing settings.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: PublicStatusSettingsUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated public status settings.",
        content: { "application/json": { schema: PublicStatusSettingsUpdateResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  updatePublicStatusSettings as never
);

publicRouter.openapi(
  createRoute({
    method: "get",
    path: "/ip-geo/{ip}",
    middleware: requireAuth("read"),
    tags: ["IP Geo"],
    summary: "Look up IP geolocation",
    description: "Returns geolocation and network metadata for one IP address.",
    "x-required-access": "read",
    security,
    request: {
      params: IpGeoParamSchema,
      query: IpGeoQuerySchema,
    },
    responses: {
      200: {
        description: "IP geolocation result.",
        content: { "application/json": { schema: IpGeoLookupResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  lookupIpGeo as never
);
