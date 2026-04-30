import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ProviderApiTestSchema,
  ProviderArrayResponseSchema,
  ProviderBatchPatchApplySchema,
  ProviderBatchPatchPreviewSchema,
  ProviderBatchUpdateSchema,
  ProviderConfirmBodySchema,
  ProviderCreateSchema,
  ProviderFetchUpstreamModelsSchema,
  ProviderGenericResponseSchema,
  ProviderGroupsQuerySchema,
  ProviderIdParamSchema,
  ProviderIdsBodySchema,
  ProviderKeyRevealResponseSchema,
  ProviderListQuerySchema,
  ProviderListResponseSchema,
  ProviderModelSuggestionsQuerySchema,
  ProviderProxyTestSchema,
  ProviderSummarySchema,
  ProviderTypeQuerySchema,
  ProviderUndoBodySchema,
  ProviderUnifiedTestSchema,
  ProviderUpdateSchema,
} from "@/lib/api/v1/schemas/providers";
import {
  applyBatchPatch,
  autoSortProviders,
  batchDeleteProviders,
  batchUpdateProviders,
  createProvider,
  deleteProvider,
  fetchProviderUpstreamModels,
  getProvider,
  getProviderLimit,
  getProviderLimitBatch,
  getProviderModelSuggestions,
  getProvidersHealth,
  getProviderTestPresets,
  listProviderGroups,
  listProviders,
  previewBatchPatch,
  reclusterProviderVendors,
  resetProviderCircuit,
  resetProviderCircuitsBatch,
  resetProviderUsage,
  revealProviderKey,
  testProviderAnthropic,
  testProviderGemini,
  testProviderOpenAIChat,
  testProviderOpenAIResponses,
  testProviderProxy,
  testProviderUnified,
  undoDeleteProvider,
  undoProviderBatchPatch,
  updateProvider,
} from "./handlers";

export const providersRouter = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return fromZodError(result.error, new URL(c.req.url).pathname);
    }
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
    description: "Provider not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

const undoMetadataHeaders = {
  "X-CCH-Undo-Token": {
    description: "Short-lived undo token for this provider operation.",
    schema: { type: "string" },
  },
  "X-CCH-Operation-Id": {
    description: "Operation id paired with the undo token.",
    schema: { type: "string" },
  },
} as const;

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "List providers",
    description:
      "Lists visible providers with optional search. Hidden legacy provider types are omitted.",
    "x-required-access": "admin",
    security,
    request: { query: ProviderListQuerySchema },
    responses: {
      200: {
        description: "Provider list.",
        content: { "application/json": { schema: ProviderListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviders as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Create provider",
    description:
      "Creates a provider using the existing provider action. Hidden legacy provider types are rejected.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderCreateSchema } },
      },
    },
    responses: {
      201: {
        description: "Created provider.",
        content: { "application/json": { schema: ProviderSummarySchema } },
      },
      ...problemResponses,
    },
  }),
  createProvider as never
);

const getProviderRoute = createRoute({
  method: "get",
  path: "/providers/{id}",
  tags: ["Providers"],
  summary: "Get provider",
  description: "Gets one visible provider by id. Hidden legacy provider types return 404.",
  "x-required-access": "admin",
  security,
  request: { params: ProviderIdParamSchema },
  responses: {
    200: {
      description: "Provider detail.",
      content: { "application/json": { schema: ProviderSummarySchema } },
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(getProviderRoute);
providersRouter.get("/providers/:id{[0-9]+}", requireAuth("admin"), getProvider);

const updateProviderRoute = createRoute({
  method: "patch",
  path: "/providers/{id}",
  tags: ["Providers"],
  summary: "Update provider",
  description:
    "Updates a visible provider. Hidden legacy provider types and deprecated fields are rejected.",
  "x-required-access": "admin",
  security,
  request: {
    params: ProviderIdParamSchema,
    body: {
      required: true,
      content: { "application/json": { schema: ProviderUpdateSchema } },
    },
  },
  responses: {
    200: {
      description: "Updated provider.",
      headers: undoMetadataHeaders,
      content: { "application/json": { schema: ProviderSummarySchema } },
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(updateProviderRoute);
providersRouter.patch("/providers/:id{[0-9]+}", requireAuth("admin"), updateProvider);

const deleteProviderRoute = createRoute({
  method: "delete",
  path: "/providers/{id}",
  tags: ["Providers"],
  summary: "Delete provider",
  description: "Deletes a visible provider using the existing provider action.",
  "x-required-access": "admin",
  security,
  request: { params: ProviderIdParamSchema },
  responses: {
    204: {
      description: "Provider deleted.",
      headers: undoMetadataHeaders,
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(deleteProviderRoute);
providersRouter.delete("/providers/:id{[0-9]+}", requireAuth("admin"), deleteProvider);

const revealProviderKeyRoute = createRoute({
  method: "get",
  path: "/providers/{id}/key:reveal",
  tags: ["Providers"],
  summary: "Reveal provider key",
  description:
    "Returns the unmasked provider API key for an admin caller and writes the existing audit log.",
  "x-required-access": "admin",
  security,
  request: { params: ProviderIdParamSchema },
  responses: {
    200: {
      description: "Unmasked provider key.",
      content: { "application/json": { schema: ProviderKeyRevealResponseSchema } },
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(revealProviderKeyRoute);
providersRouter.get("/providers/:id{[0-9]+}/key:reveal", requireAuth("admin"), revealProviderKey);

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/health",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Get provider health",
    description: "Returns circuit breaker health for all visible providers.",
    "x-required-access": "admin",
    security,
    request: { query: ProviderGroupsQuerySchema },
    responses: {
      200: {
        description: "Provider health.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProvidersHealth as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/{id}/circuit:reset",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Reset provider circuit",
    description: "Resets the circuit breaker state for one provider.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderIdParamSchema },
    responses: {
      200: {
        description: "Circuit reset result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  resetProviderCircuit as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/{id}/usage:reset",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Reset provider total usage",
    description: "Resets the total usage aggregation lower bound for one provider.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderIdParamSchema },
    responses: {
      200: {
        description: "Usage reset result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  resetProviderUsage as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/circuits:batchReset",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Batch reset provider circuits",
    description: "Resets circuit breaker state for multiple providers.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderIdsBodySchema } } },
    },
    responses: {
      200: {
        description: "Batch circuit reset result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  resetProviderCircuitsBatch as never
);

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/{id}/limit-usage",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Get provider limit usage",
    description: "Returns cost and concurrency buckets for one provider.",
    "x-required-access": "admin",
    security,
    request: { params: ProviderIdParamSchema },
    responses: {
      200: {
        description: "Provider limit usage.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderLimit as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/limit-usage:batch",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Batch get provider limit usage",
    description: "Returns cost and concurrency buckets for multiple visible providers.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderIdsBodySchema } } },
    },
    responses: {
      200: {
        description: "Provider limit usage items.",
        content: { "application/json": { schema: ProviderArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderLimitBatch as never
);

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/groups",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "List provider groups",
    description: "Returns available provider groups, optionally with provider counts.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Provider groups.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listProviderGroups as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers:autoSortPriority",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Auto sort provider priority",
    description: "Previews or applies priority sorting based on cost multipliers.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderConfirmBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Auto-sort result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  autoSortProviders as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers:batchUpdate",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Batch update providers",
    description: "Applies one update patch to multiple providers.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderBatchUpdateSchema } },
      },
    },
    responses: {
      200: {
        description: "Batch update result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchUpdateProviders as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers:batchDelete",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Batch delete providers",
    description: "Deletes multiple providers and returns undo metadata.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderIdsBodySchema } } },
    },
    responses: {
      200: {
        description: "Batch delete result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  batchDeleteProviders as never
);

const undoDeleteProviderRoute = createRoute({
  method: "post",
  path: "/providers:undoDelete",
  tags: ["Providers"],
  summary: "Undo provider delete",
  description: "Restores providers deleted by a previous delete operation.",
  "x-required-access": "admin",
  security,
  request: {
    body: { required: true, content: { "application/json": { schema: ProviderUndoBodySchema } } },
  },
  responses: {
    200: {
      description: "Undo delete result.",
      content: { "application/json": { schema: ProviderGenericResponseSchema } },
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(undoDeleteProviderRoute);
providersRouter.post("/providers:undoDelete", requireAuth("admin"), undoDeleteProvider);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers:batchPatch:preview",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Preview provider batch patch",
    description: "Previews a provider batch patch without applying it.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderBatchPatchPreviewSchema } },
      },
    },
    responses: {
      200: {
        description: "Preview result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  previewBatchPatch as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers:batchPatch:apply",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Apply provider batch patch",
    description: "Applies a previously previewed provider batch patch.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderBatchPatchApplySchema } },
      },
    },
    responses: {
      200: {
        description: "Apply result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  applyBatchPatch as never
);

const undoProviderPatchRoute = createRoute({
  method: "post",
  path: "/providers:undoPatch",
  tags: ["Providers"],
  summary: "Undo provider batch patch",
  description: "Reverts a previous provider batch patch within the undo window.",
  "x-required-access": "admin",
  security,
  request: {
    body: { required: true, content: { "application/json": { schema: ProviderUndoBodySchema } } },
  },
  responses: {
    200: {
      description: "Undo patch result.",
      content: { "application/json": { schema: ProviderGenericResponseSchema } },
    },
    ...problemResponses,
  },
});

providersRouter.openAPIRegistry.registerPath(undoProviderPatchRoute);
providersRouter.post("/providers:undoPatch", requireAuth("admin"), undoProviderBatchPatch);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:proxy",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Test provider proxy",
    description: "Tests provider connectivity through an optional proxy.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderProxyTestSchema } },
      },
    },
    responses: {
      200: {
        description: "Proxy test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderProxy as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:unified",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Run unified provider API test",
    description: "Runs the unified relay-style provider API test.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderUnifiedTestSchema } },
      },
    },
    responses: {
      200: {
        description: "Unified test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderUnified as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:anthropic-messages",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Run Anthropic messages provider test",
    description: "Runs a provider test against the Anthropic Messages API.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderApiTestSchema } } },
    },
    responses: {
      200: {
        description: "Anthropic test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderAnthropic as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:openai-chat-completions",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Run OpenAI chat completions provider test",
    description: "Runs a provider test against the OpenAI Chat Completions API.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderApiTestSchema } } },
    },
    responses: {
      200: {
        description: "OpenAI chat test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderOpenAIChat as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:openai-responses",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Run OpenAI responses provider test",
    description: "Runs a provider test against the OpenAI Responses API.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderApiTestSchema } } },
    },
    responses: {
      200: {
        description: "OpenAI responses test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderOpenAIResponses as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/test:gemini",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Run Gemini provider test",
    description: "Runs a provider test against the Gemini API.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ProviderApiTestSchema } } },
    },
    responses: {
      200: {
        description: "Gemini test result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  testProviderGemini as never
);

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/test:presets",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "List provider test presets",
    description: "Returns provider test presets for a supported provider type.",
    "x-required-access": "admin",
    security,
    request: { query: ProviderTypeQuerySchema },
    responses: {
      200: {
        description: "Provider test presets.",
        content: { "application/json": { schema: ProviderArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderTestPresets as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/upstream-models:fetch",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Fetch upstream models",
    description: "Fetches model ids from an upstream provider API.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderFetchUpstreamModelsSchema } },
      },
    },
    responses: {
      200: {
        description: "Upstream models.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  fetchProviderUpstreamModels as never
);

providersRouter.openapi(
  createRoute({
    method: "get",
    path: "/providers/model-suggestions",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "List provider model suggestions",
    description: "Returns model suggestions collected from enabled providers in a group.",
    "x-required-access": "admin",
    security,
    request: { query: ProviderModelSuggestionsQuerySchema },
    responses: {
      200: {
        description: "Model suggestions.",
        content: { "application/json": { schema: ProviderArrayResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getProviderModelSuggestions as never
);

providersRouter.openapi(
  createRoute({
    method: "post",
    path: "/providers/vendors:recluster",
    middleware: requireAuth("admin"),
    tags: ["Providers"],
    summary: "Recluster provider vendors",
    description: "Previews or applies provider vendor reclustering.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: ProviderConfirmBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Recluster result.",
        content: { "application/json": { schema: ProviderGenericResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  reclusterProviderVendors as never
);
