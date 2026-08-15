import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderSiteCreateSchema,
  ProviderSiteGroupRateSchema,
  ProviderSiteGroupRateUpdateSchema,
  ProviderSiteGroupRateUpsertSchema,
  ProviderSiteGroupUpstreamModelsResponseSchema,
  ProviderSiteIdParamSchema,
  ProviderSiteListResponseSchema,
  ProviderSiteReorderSchema,
  ProviderSiteSchema,
  ProviderSiteSyncAllResponseSchema,
  ProviderSiteSyncResultSchema,
  ProviderSiteUpdateSchema,
} from "@/lib/api/v1/schemas/provider-sites";
import {
  createProviderSite,
  deleteProviderSite,
  deleteProviderSiteGroupRate,
  fetchProviderSiteGroupUpstreamModels,
  listProviderSites,
  reorderProviderSitesHandler,
  syncAllProviderSiteRatesHandler,
  syncProviderSiteRatesHandler,
  updateProviderSite,
  updateProviderSiteGroupRate,
  upsertProviderSiteGroupRate,
} from "./handlers";

export const providerSitesRouter = new OpenAPIHono({
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
    description: "Admin access required.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  404: {
    description: "Provider site not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

const RateIdParamSchema = z.object({
  rateId: z.coerce.number().int().positive().describe("Site group rate id."),
});

providerSitesRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-sites",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "List provider sites",
    description: "Lists upstream websites with expandable group rates.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider sites.",
        content: { "application/json": { schema: ProviderSiteListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderSites as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-sites",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Create provider site",
    description: "Creates an upstream website configuration unit.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderSiteCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created provider site.",
        content: { "application/json": { schema: ProviderSiteSchema } },
      },
      ...problemResponses,
    },
  }),
  createProviderSite as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "patch",
    path: "/provider-sites/{id}",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Update provider site",
    description: "Partially updates a provider site.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderSiteIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderSiteUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated provider site.",
        content: { "application/json": { schema: ProviderSiteSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderSite as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "delete",
    path: "/provider-sites/{id}",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Delete provider site",
    description: "Deletes a provider site and detaches linked providers.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderSiteIdParamSchema },
    responses: {
      204: { description: "Provider site deleted." },
      ...problemResponses,
    },
  }),
  deleteProviderSite as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-sites:reorder",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Reorder provider sites",
    description: "Persists manual display order for provider site cards.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderSiteReorderSchema } },
      },
    },
    responses: {
      200: {
        description: "Reordered provider sites.",
        content: { "application/json": { schema: ProviderSiteListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  reorderProviderSitesHandler as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "put",
    path: "/provider-sites/{id}/group-rates",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Upsert site group rate",
    description: "Creates or updates one upstream group rate under a site.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderSiteIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderSiteGroupRateUpsertSchema } },
      },
    },
    responses: {
      200: {
        description: "Upserted group rate.",
        content: { "application/json": { schema: ProviderSiteGroupRateSchema } },
      },
      ...problemResponses,
    },
  }),
  upsertProviderSiteGroupRate as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "patch",
    path: "/provider-sites/group-rates/{rateId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Update site group rate",
    description: "Partially updates one site group rate.",
    "x-required-access": "admin",
    security,
    request: {
      params: RateIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderSiteGroupRateUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated group rate.",
        content: { "application/json": { schema: ProviderSiteGroupRateSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderSiteGroupRate as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "delete",
    path: "/provider-sites/group-rates/{rateId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Delete site group rate",
    description: "Deletes one site group rate.",
    "x-required-access": "admin",
    security,
    request: { params: RateIdParamSchema },
    responses: {
      204: { description: "Group rate deleted." },
      ...problemResponses,
    },
  }),
  deleteProviderSiteGroupRate as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-sites/{id}/sync-rates",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Sync one site group rates",
    description:
      "Logs into the upstream website with stored credentials and refreshes group rates + balance.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderSiteIdParamSchema },
    responses: {
      200: {
        description: "Sync result.",
        content: { "application/json": { schema: ProviderSiteSyncResultSchema } },
      },
      ...problemResponses,
    },
  }),
  syncProviderSiteRatesHandler as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-sites/sync-rates",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Sync all enabled site group rates",
    description:
      "Refreshes group rates and balances for all enabled provider sites with credentials.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Sync results.",
        content: { "application/json": { schema: ProviderSiteSyncAllResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  syncAllProviderSiteRatesHandler as never
);

providerSitesRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-sites/group-rates/{rateId}/upstream-models:fetch",
    middleware: requireAuth("admin"),
    tags: ["Provider Sites"],
    summary: "Fetch aggregated upstream models for a site group rate",
    description:
      "Fetches model ids from every enabled provider that belongs to the site group rate row and merges them.",
    "x-required-access": "admin",
    security,
    request: { params: RateIdParamSchema },
    responses: {
      200: {
        description: "Aggregated upstream models.",
        content: {
          "application/json": { schema: ProviderSiteGroupUpstreamModelsResponseSchema },
        },
      },
      ...problemResponses,
    },
  }),
  fetchProviderSiteGroupUpstreamModels as never
);
