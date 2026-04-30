/**
 * /api/v1/model-prices handler 集合
 *
 * 设计要点：
 * - 所有 handler 走 callAction 桥接到 src/actions/model-prices；
 * - getModelPrices / getModelPricesPaginated 不返回 ActionResult（getModelPrices 直接返回数组），
 *   通过 treatRawAsActionResult 处理；
 * - hasPriceTable 直接返回 boolean，需要 raw 模式包装；
 * - upload / sync 系列写操作均会触发 server action 的权限检查（admin only）。
 */

import type { Context } from "hono";
import {
  checkLiteLLMSyncConflicts as checkLiteLLMSyncConflictsAction,
  deleteSingleModelPrice as deleteSingleModelPriceAction,
  getAvailableModelCatalog as getAvailableModelCatalogAction,
  getAvailableModelsByProviderType as getAvailableModelsByProviderTypeAction,
  getModelPrices as getModelPricesAction,
  getModelPricesPaginated as getModelPricesPaginatedAction,
  hasPriceTable as hasPriceTableAction,
  pinModelPricingProviderAsManual as pinModelPricingProviderAsManualAction,
  syncLiteLLMPrices as syncLiteLLMPricesAction,
  uploadPriceTable as uploadPriceTableAction,
  upsertSingleModelPrice as upsertSingleModelPriceAction,
} from "@/actions/model-prices";
import { callAction } from "@/lib/api/v1/_shared/action-bridge";
import { problem } from "@/lib/api/v1/_shared/error-envelope";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";
import { respondJson, respondNoContent } from "@/lib/api/v1/_shared/response-helpers";
import {
  type ModelPriceCatalogItem,
  ModelPriceSyncSchema,
  ModelPriceUploadSchema,
  SingleModelPriceUpsertSchema,
  serializeModelPrice,
} from "@/lib/api/v1/schemas/model-prices";
import type { ModelPrice, PriceUpdateResult, SyncConflictCheckResult } from "@/types/model-price";

type AnyAction = (...args: unknown[]) => Promise<unknown>;

const listAction = getModelPricesAction as unknown as AnyAction;
const listPaginatedAction = getModelPricesPaginatedAction as unknown as AnyAction;
const existsAction = hasPriceTableAction as unknown as AnyAction;
const catalogAction = getAvailableModelCatalogAction as unknown as AnyAction;
const catalogChatAction = getAvailableModelsByProviderTypeAction as unknown as AnyAction;
const uploadAction = uploadPriceTableAction as unknown as AnyAction;
const syncCheckAction = checkLiteLLMSyncConflictsAction as unknown as AnyAction;
const syncAction = syncLiteLLMPricesAction as unknown as AnyAction;
const upsertAction = upsertSingleModelPriceAction as unknown as AnyAction;
const deleteAction = deleteSingleModelPriceAction as unknown as AnyAction;
const pinAction = pinModelPricingProviderAsManualAction as unknown as AnyAction;

interface PaginatedRaw {
  data: ModelPrice[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== GET /model-prices ====================

export async function listModelPrices(c: Context): Promise<Response> {
  const q = c.req.query();
  const page = q.page ? Number(q.page) : 1;
  const limit = q.limit ? Number(q.limit) : 0;
  const search = q.q?.trim();

  if (limit > 0 && Number.isInteger(page) && Number.isInteger(limit)) {
    // Use paginated action when explicit limit is provided
    const result = await callAction<PaginatedRaw>(c, listPaginatedAction, [
      { page, pageSize: limit, search },
    ]);
    if (!result.ok) return result.problem;
    const paginated = result.data;
    return respondJson(
      c,
      {
        items: paginated.data.map(serializeModelPrice),
        pageInfo: {
          page: paginated.page,
          pageSize: paginated.pageSize,
          total: paginated.total,
          totalPages: paginated.totalPages,
        },
      },
      200
    );
  }

  // Fallback: full list (raw array, not ActionResult)
  const raw = await callAction<ModelPrice[]>(c, listAction, [], { treatRawAsActionResult: true });
  if (!raw.ok) return raw.problem;
  const items = raw.data;
  return respondJson(
    c,
    {
      items: items.map(serializeModelPrice),
      pageInfo: {
        page: 1,
        pageSize: items.length,
        total: items.length,
        totalPages: items.length > 0 ? 1 : 0,
      },
    },
    200
  );
}

// ==================== GET /model-prices/exists ====================

export async function existsModelPrices(c: Context): Promise<Response> {
  const result = await callAction<boolean>(c, existsAction, [], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { exists: Boolean(result.data) }, 200);
}

// ==================== GET /model-prices/catalog ====================

export async function getCatalog(c: Context): Promise<Response> {
  const scope = c.req.query("scope");
  if (scope === "chat") {
    // chat-only: action returns string[]
    const result = await callAction<string[]>(c, catalogChatAction, [], {
      treatRawAsActionResult: true,
    });
    if (!result.ok) return result.problem;
    const items: ModelPriceCatalogItem[] = result.data.map((modelName) => ({
      modelName,
      litellmProvider: null,
      updatedAt: new Date(0).toISOString(),
    }));
    return respondJson(c, { items }, 200);
  }

  const result = await callAction<ModelPriceCatalogItem[]>(c, catalogAction, [{ scope }], {
    treatRawAsActionResult: true,
  });
  if (!result.ok) return result.problem;
  return respondJson(c, { items: result.data }, 200);
}

// ==================== POST /model-prices:upload ====================

export async function uploadModelPrices(c: Context): Promise<Response> {
  const body = await parseJsonBody<typeof ModelPriceUploadSchema>(c, ModelPriceUploadSchema);
  if (!body.ok) return body.response;
  const result = await callAction<PriceUpdateResult>(c, uploadAction, [
    body.data.jsonContent,
    body.data.overwriteManual,
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== POST /model-prices:syncLitellmCheck ====================

export async function syncLitellmCheck(c: Context): Promise<Response> {
  const result = await callAction<SyncConflictCheckResult>(c, syncCheckAction, []);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== POST /model-prices:syncLitellm ====================

export async function syncLitellm(c: Context): Promise<Response> {
  // Body is optional; allow empty body
  let overwriteManual: string[] | undefined;
  try {
    const text = await c.req.text();
    if (text.trim().length > 0) {
      const parsed = ModelPriceSyncSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return problem(c, {
          status: 400,
          errorCode: "validation_failed",
          title: "Invalid request body",
          detail: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }
      overwriteManual = parsed.data.overwriteManual;
    }
  } catch {
    return problem(c, {
      status: 400,
      errorCode: "malformed_json",
      title: "Malformed JSON",
      detail: "Request body is not valid JSON.",
    });
  }
  const result = await callAction<PriceUpdateResult>(c, syncAction, [overwriteManual]);
  if (!result.ok) return result.problem;
  return respondJson(c, result.data, 200);
}

// ==================== GET /model-prices/{modelName} ====================

function readModelName(c: Context): string | null {
  const raw = c.req.param("modelName") ?? c.req.param("modelNameDelete") ?? null;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export async function getSingleModelPrice(c: Context): Promise<Response> {
  const modelName = readModelName(c);
  if (!modelName) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `modelName` is required.",
    });
  }
  const raw = await callAction<ModelPrice[]>(c, listAction, [], { treatRawAsActionResult: true });
  if (!raw.ok) return raw.problem;
  const found = raw.data.find((m) => m.modelName === modelName);
  if (!found) {
    return problem(c, {
      status: 404,
      errorCode: "not_found",
      title: "Model price not found",
      detail: `Model "${modelName}" does not exist.`,
    });
  }
  return respondJson(c, serializeModelPrice(found), 200);
}

// ==================== PUT /model-prices/{modelName} ====================

export async function upsertSingleModelPriceHandler(c: Context): Promise<Response> {
  const modelName = readModelName(c);
  if (!modelName) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `modelName` is required.",
    });
  }
  const body = await parseJsonBody<typeof SingleModelPriceUpsertSchema>(
    c,
    SingleModelPriceUpsertSchema
  );
  if (!body.ok) return body.response;
  const result = await callAction<ModelPrice>(c, upsertAction, [
    {
      modelName,
      ...body.data,
    },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeModelPrice(result.data), 200);
}

// ==================== DELETE /model-prices/{modelName} ====================

export async function deleteSingleModelPriceHandler(c: Context): Promise<Response> {
  const modelName = readModelName(c);
  if (!modelName) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `modelName` is required.",
    });
  }
  const result = await callAction<void>(c, deleteAction, [modelName]);
  if (!result.ok) return result.problem;
  return respondNoContent(c);
}

// ==================== POST /model-prices/{modelName}/pricing/{providerType}:pinManual ====================

export async function pinModelPricingProvider(c: Context): Promise<Response> {
  const modelName = readModelName(c);
  if (!modelName) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `modelName` is required.",
    });
  }
  // providerType 路径段形如 "anthropic:pinManual"，需要剥离尾部 :pinManual
  const rawProvider = c.req.param("providerTypePin") ?? c.req.param("providerType") ?? "";
  let providerType = rawProvider;
  const colonIdx = providerType.indexOf(":");
  if (colonIdx >= 0) {
    providerType = providerType.slice(0, colonIdx);
  }
  if (!providerType) {
    return problem(c, {
      status: 400,
      errorCode: "validation_failed",
      title: "Invalid path parameter",
      detail: "Path parameter `providerType` is required.",
    });
  }
  const result = await callAction<ModelPrice>(c, pinAction, [
    {
      modelName,
      pricingProviderKey: providerType,
    },
  ]);
  if (!result.ok) return result.problem;
  return respondJson(c, serializeModelPrice(result.data), 200);
}
