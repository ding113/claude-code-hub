import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  BatchEndpointCircuitSchema,
  BatchProbeLogsSchema,
  BatchVendorEndpointStatsSchema,
  ProviderEndpointArrayResponseSchema,
  ProviderEndpointCreateSchema,
  ProviderEndpointGenericResponseSchema,
  ProviderEndpointIdParamSchema,
  ProviderEndpointListQuerySchema,
  ProviderEndpointProbeSchema,
  ProviderEndpointUpdateSchema,
  ProviderProbeLogsQuerySchema,
  ProviderVendorArrayResponseSchema,
  ProviderVendorIdParamSchema,
  ProviderVendorListQuerySchema,
  ProviderVendorUpdateSchema,
  VendorTypeBodySchema,
  VendorTypeManualOpenSchema,
  VendorTypeQuerySchema,
} from "@/lib/api/v1/schemas/provider-endpoints";
import {
  batchGetEndpointCircuits,
  batchGetProbeLogs,
  batchGetVendorEndpointStats,
  createProviderEndpoint,
  deleteProviderEndpoint,
  deleteProviderVendor,
  getEndpointCircuit,
  getProviderEndpointProbeLogs,
  getProviderVendor,
  getVendorCircuit,
  listProviderEndpoints,
  listProviderVendors,
  probeProviderEndpoint,
  resetEndpointCircuit,
  resetVendorCircuit,
  setVendorCircuitManualOpen,
  updateProviderEndpoint,
  updateProviderVendor,
} from "./handlers";

export const providerEndpointsRouter = new OpenAPIHono({
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
    description: "Provider endpoint resource not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
  409: {
    description: "Provider endpoint conflict.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-vendors",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "List provider vendors",
    description: "Lists provider vendors, optionally with dashboard provider types.",
    "x-required-access": "admin",
    security,
    request: { query: ProviderVendorListQuerySchema },
    responses: {
      200: {
        description: "Provider vendors.",
        content: { "application/json": { schema: ProviderVendorArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderVendors as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-vendors/{vendorId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Get provider vendor",
    description: "Returns one provider vendor by id.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderVendorIdParamSchema },
    responses: {
      200: {
        description: "Provider vendor.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderVendor as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/provider-vendors/{vendorId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Update provider vendor",
    description: "Updates provider vendor display metadata.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderVendorIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderVendorUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated provider vendor.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderVendor as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/provider-vendors/{vendorId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Delete provider vendor",
    description: "Deletes a provider vendor when allowed.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderVendorIdParamSchema },
    responses: { 204: { description: "Provider vendor deleted." }, ...problemResponses },
  }),
  deleteProviderVendor as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-vendors/{vendorId}/endpoints",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "List provider endpoints",
    description: "Lists endpoints for a vendor, optionally filtered by supported provider type.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderVendorIdParamSchema, query: ProviderEndpointListQuerySchema },
    responses: {
      200: {
        description: "Provider endpoints.",
        content: { "application/json": { schema: ProviderEndpointArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderEndpoints as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-vendors/{vendorId}/endpoints",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Create provider endpoint",
    description: "Creates an endpoint under a provider vendor.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderVendorIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderEndpointCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created provider endpoint.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  createProviderEndpoint as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "patch",
    path: "/provider-endpoints/{endpointId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Update provider endpoint",
    description: "Updates endpoint metadata, URL, sort order, or enabled state.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderEndpointIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ProviderEndpointUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Updated provider endpoint.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  updateProviderEndpoint as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "delete",
    path: "/provider-endpoints/{endpointId}",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Delete provider endpoint",
    description: "Soft-deletes a provider endpoint when no enabled providers still reference it.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderEndpointIdParamSchema },
    responses: { 204: { description: "Provider endpoint deleted." }, ...problemResponses },
  }),
  deleteProviderEndpoint as never
);

const probeProviderEndpointRoute = createRoute({
  method: "post",
  path: "/provider-endpoints/{endpointId}:probe",
  tags: ["Provider Endpoints"],
  summary: "Probe provider endpoint",
  description: "Runs an endpoint health probe and records the result.",
  "x-required-access": "admin",
  security,
  request: {
    params: ProviderEndpointIdParamSchema,
    body: {
      required: false,
      content: { "application/json": { schema: ProviderEndpointProbeSchema } },
    },
  },
  responses: {
    200: {
      description: "Probe result.",
      content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
    },
    ...problemResponses,
  },
});

providerEndpointsRouter.openAPIRegistry.registerPath(probeProviderEndpointRoute);
providerEndpointsRouter.post(
  "/provider-endpoints/:endpointId{[0-9]+:probe}",
  requireAuth("admin"),
  probeProviderEndpoint
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-endpoints/{endpointId}/probe-logs",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "List provider endpoint probe logs",
    description: "Lists probe logs for one provider endpoint.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderEndpointIdParamSchema, query: ProviderProbeLogsQuerySchema },
    responses: {
      200: {
        description: "Probe logs.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderEndpointProbeLogs as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-endpoints/probe-logs:batch",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Batch list provider endpoint probe logs",
    description: "Lists recent probe logs for multiple endpoints.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: BatchProbeLogsSchema } } },
    },
    responses: {
      200: {
        description: "Batch probe logs.",
        content: { "application/json": { schema: ProviderEndpointArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchGetProbeLogs as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-vendors/endpoint-stats:batch",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Batch get vendor endpoint stats",
    description: "Gets endpoint stats for vendor ids and one provider type.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: BatchVendorEndpointStatsSchema } },
      },
    },
    responses: {
      200: {
        description: "Vendor endpoint stats.",
        content: { "application/json": { schema: ProviderEndpointArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchGetVendorEndpointStats as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-endpoints/{endpointId}/circuit",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Get endpoint circuit",
    description: "Gets endpoint circuit breaker state.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderEndpointIdParamSchema },
    responses: {
      200: {
        description: "Endpoint circuit state.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getEndpointCircuit as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-endpoints/circuits:batch",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Batch get endpoint circuits",
    description: "Gets endpoint circuit states in batch.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: BatchEndpointCircuitSchema } },
      },
    },
    responses: {
      200: {
        description: "Endpoint circuit states.",
        content: { "application/json": { schema: ProviderEndpointArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchGetEndpointCircuits as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-endpoints/{endpointId}/circuit:reset",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Reset endpoint circuit",
    description: "Resets endpoint circuit breaker state.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderEndpointIdParamSchema },
    responses: { 204: { description: "Endpoint circuit reset." }, ...problemResponses },
  }),
  resetEndpointCircuit as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "get",
    path: "/provider-vendors/{vendorId}/circuit",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Get vendor type circuit",
    description: "Gets circuit breaker state for a vendor and provider type.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderVendorIdParamSchema, query: VendorTypeQuerySchema },
    responses: {
      200: {
        description: "Vendor type circuit state.",
        content: { "application/json": { schema: ProviderEndpointGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getVendorCircuit as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-vendors/{vendorId}/circuit:setManualOpen",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Set vendor type circuit manual open",
    description: "Sets manual-open state for a vendor type circuit.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderVendorIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: VendorTypeManualOpenSchema } },
      },
    },
    responses: { 204: { description: "Vendor type circuit updated." }, ...problemResponses },
  }),
  setVendorCircuitManualOpen as never
);

providerEndpointsRouter.openapi(
  createRoute({
    method: "post",
    path: "/provider-vendors/{vendorId}/circuit:reset",
    middleware: requireAuth("admin"),
    tags: ["Provider Endpoints"],
    summary: "Reset vendor type circuit",
    description: "Resets circuit breaker state for a vendor and provider type.",
    "x-required-access": "admin",
    security,
    request: {
      params: ProviderVendorIdParamSchema,
      body: { required: true, content: { "application/json": { schema: VendorTypeBodySchema } } },
    },
    responses: { 204: { description: "Vendor type circuit reset." }, ...problemResponses },
  }),
  resetVendorCircuit as never
);
