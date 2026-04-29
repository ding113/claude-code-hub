import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { requireAuth } from "@/lib/api/v1/_shared/auth-middleware";
import { fromZodError } from "@/lib/api/v1/_shared/error-envelope";
import { ProblemJsonSchema } from "@/lib/api/v1/schemas/_common";
import {
  ModelPriceCatalogQuerySchema,
  ModelPriceCatalogResponseSchema,
  ModelPriceExistsResponseSchema,
  ModelPriceListQuerySchema,
  ModelPriceListResponseSchema,
  ModelPriceNameParamSchema,
  ModelPriceOverwriteSchema,
  ModelPricePinRequestSchema,
  ModelPriceSchema,
  ModelPriceSyncConflictCheckResponseSchema,
  ModelPriceUpdateResultSchema,
  ModelPriceUploadSchema,
  SingleModelPriceSchema,
} from "@/lib/api/v1/schemas/model-prices";
import {
  checkLiteLlmSync,
  deleteModelPrice,
  getModelPriceCatalog,
  hasModelPrices,
  listModelPrices,
  pinModelPriceProvider,
  syncLiteLlmPrices,
  uploadModelPrices,
  upsertModelPrice,
} from "./handlers";

export const modelPricesRouter = new OpenAPIHono({
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
    description: "Model price not found.",
    content: { "application/problem+json": { schema: ProblemJsonSchema } },
  },
} as const;

modelPricesRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-prices",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "List model prices",
    description: "Lists latest model prices with pagination and filters.",
    "x-required-access": "admin",
    security,
    request: { query: ModelPriceListQuerySchema },
    responses: {
      200: {
        description: "Model price page.",
        content: { "application/json": { schema: ModelPriceListResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  listModelPrices as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-prices/catalog",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "List available model catalog",
    description: "Lists local model catalog entries derived from model prices.",
    "x-required-access": "admin",
    security,
    request: { query: ModelPriceCatalogQuerySchema },
    responses: {
      200: {
        description: "Model catalog.",
        content: { "application/json": { schema: ModelPriceCatalogResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  getModelPriceCatalog as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "get",
    path: "/model-prices/exists",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Check price table existence",
    description: "Checks whether any model price records exist.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Price table existence.",
        content: { "application/json": { schema: ModelPriceExistsResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  hasModelPrices as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-prices:upload",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Upload price table",
    description: "Uploads a JSON or TOML price table.",
    "x-required-access": "admin",
    security,
    request: {
      body: { required: true, content: { "application/json": { schema: ModelPriceUploadSchema } } },
    },
    responses: {
      200: {
        description: "Upload result.",
        content: { "application/json": { schema: ModelPriceUpdateResultSchema } },
      },
      ...problemResponses,
    },
  }),
  uploadModelPrices as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-prices:syncLitellmCheck",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Check LiteLLM sync conflicts",
    description: "Checks whether LiteLLM sync would overwrite manual model prices.",
    "x-required-access": "admin",
    security,
    responses: {
      200: {
        description: "Sync conflict check.",
        content: { "application/json": { schema: ModelPriceSyncConflictCheckResponseSchema } },
      },
      ...problemResponses,
    },
  }),
  checkLiteLlmSync as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-prices:syncLitellm",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Sync LiteLLM prices",
    description: "Syncs model prices from the LiteLLM cloud price table.",
    "x-required-access": "admin",
    security,
    request: {
      body: {
        required: false,
        content: { "application/json": { schema: ModelPriceOverwriteSchema } },
      },
    },
    responses: {
      200: {
        description: "Sync result.",
        content: { "application/json": { schema: ModelPriceUpdateResultSchema } },
      },
      ...problemResponses,
    },
  }),
  syncLiteLlmPrices as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "put",
    path: "/model-prices/{modelName}",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Upsert one model price",
    description: "Creates or updates one manual model price.",
    "x-required-access": "admin",
    security,
    request: {
      params: ModelPriceNameParamSchema,
      body: { required: true, content: { "application/json": { schema: SingleModelPriceSchema } } },
    },
    responses: {
      200: {
        description: "Updated model price.",
        content: { "application/json": { schema: ModelPriceSchema } },
      },
      ...problemResponses,
    },
  }),
  upsertModelPrice as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "delete",
    path: "/model-prices/{modelName}",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Delete one model price",
    description: "Deletes all price records for one model name.",
    "x-required-access": "admin",
    security,
    request: { params: ModelPriceNameParamSchema },
    responses: {
      204: { description: "Model price deleted." },
      ...problemResponses,
    },
  }),
  deleteModelPrice as never
);

modelPricesRouter.openapi(
  createRoute({
    method: "post",
    path: "/model-prices/{modelName}/pricing:pinManual",
    middleware: requireAuth("admin"),
    tags: ["Model Prices"],
    summary: "Pin pricing provider as manual",
    description: "Pins a nested pricing provider node as the manual price for a model.",
    "x-required-access": "admin",
    security,
    request: {
      params: ModelPriceNameParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: ModelPricePinRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Pinned model price.",
        content: { "application/json": { schema: ModelPriceSchema } },
      },
      ...problemResponses,
    },
  }),
  pinModelPriceProvider as never
);
