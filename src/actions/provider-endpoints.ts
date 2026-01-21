"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { publishProviderCacheInvalidation } from "@/lib/cache/provider-cache";
import {
  getEndpointHealthInfo,
  resetEndpointCircuit as resetEndpointCircuitState,
} from "@/lib/endpoint-circuit-breaker";
import { logger } from "@/lib/logger";
import { probeProviderEndpointAndRecord } from "@/lib/provider-endpoints/probe";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { extractZodErrorCode, formatZodError } from "@/lib/utils/zod-i18n";
import {
  getVendorTypeCircuitInfo as getVendorTypeCircuitInfoState,
  resetVendorTypeCircuit as resetVendorTypeCircuitState,
  setVendorTypeCircuitManualOpen as setVendorTypeCircuitManualOpenState,
} from "@/lib/vendor-type-circuit-breaker";
import {
  createProviderEndpoint,
  deleteProviderVendor,
  findProviderEndpointById,
  findProviderEndpointProbeLogs,
  findProviderEndpointsByVendorAndType,
  findProviderVendorById,
  findProviderVendors,
  softDeleteProviderEndpoint,
  tryDeleteProviderVendorIfEmpty,
  updateProviderEndpoint,
  updateProviderVendor,
} from "@/repository";
import type {
  ProviderEndpoint,
  ProviderEndpointProbeLog,
  ProviderType,
  ProviderVendor,
} from "@/types/provider";
import type { ActionResult } from "./types";

const ProviderTypeSchema = z.enum([
  "claude",
  "claude-auth",
  "codex",
  "gemini-cli",
  "gemini",
  "openai-compatible",
]);

type ProviderTypeInput = z.infer<typeof ProviderTypeSchema>;

const VendorIdSchema = z.number().int().positive();
const EndpointIdSchema = z.number().int().positive();

const GetProviderEndpointsSchema = z.object({
  vendorId: VendorIdSchema,
  providerType: ProviderTypeSchema,
});

const CreateProviderEndpointSchema = z.object({
  vendorId: VendorIdSchema,
  providerType: ProviderTypeSchema,
  url: z.string().trim().url(ERROR_CODES.INVALID_URL),
  label: z.string().trim().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
});

const UpdateProviderEndpointSchema = z
  .object({
    endpointId: EndpointIdSchema,
    url: z.string().trim().url(ERROR_CODES.INVALID_URL).optional(),
    label: z.string().trim().max(200).optional().nullable(),
    sortOrder: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.url !== undefined ||
      value.label !== undefined ||
      value.sortOrder !== undefined ||
      value.isEnabled !== undefined,
    {
      message: ERROR_CODES.EMPTY_UPDATE,
      path: ["endpointId"],
    }
  );

const DeleteProviderEndpointSchema = z.object({
  endpointId: EndpointIdSchema,
});

const ProbeProviderEndpointSchema = z.object({
  endpointId: EndpointIdSchema,
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
});

const EditProviderVendorSchema = z.object({
  vendorId: VendorIdSchema,
  displayName: z.string().trim().max(200).optional().nullable(),
  websiteUrl: z.string().trim().url(ERROR_CODES.INVALID_URL).optional().nullable(),
});

const DeleteProviderVendorSchema = z.object({
  vendorId: VendorIdSchema,
});

const GetProbeLogsSchema = z.object({
  endpointId: EndpointIdSchema,
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).optional(),
});

const VendorTypeSchema = z.object({
  vendorId: VendorIdSchema,
  providerType: ProviderTypeSchema,
});

const SetVendorTypeManualOpenSchema = z.object({
  vendorId: VendorIdSchema,
  providerType: ProviderTypeSchema,
  manualOpen: z.boolean(),
});

async function getAdminSession() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return null;
  }
  return session;
}

export async function getProviderVendors(): Promise<ProviderVendor[]> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return [];
    }

    return await findProviderVendors(200, 0);
  } catch (error) {
    logger.error("getProviderVendors:error", error);
    return [];
  }
}

export async function getProviderVendorById(vendorId: number): Promise<ProviderVendor | null> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return null;
    }

    return await findProviderVendorById(vendorId);
  } catch (error) {
    logger.error("getProviderVendorById:error", error);
    return null;
  }
}

export async function getProviderEndpoints(input: {
  vendorId: number;
  providerType: ProviderType;
}): Promise<ProviderEndpoint[]> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return [];
    }

    const parsed = GetProviderEndpointsSchema.safeParse(input);
    if (!parsed.success) {
      logger.debug("getProviderEndpoints:invalid_input", {
        error: parsed.error,
      });
      return [];
    }

    return await findProviderEndpointsByVendorAndType(
      parsed.data.vendorId,
      parsed.data.providerType as ProviderTypeInput
    );
  } catch (error) {
    logger.error("getProviderEndpoints:error", error);
    return [];
  }
}

export async function addProviderEndpoint(
  input: unknown
): Promise<ActionResult<{ endpoint: ProviderEndpoint }>> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = CreateProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const endpoint = await createProviderEndpoint({
      vendorId: parsed.data.vendorId,
      providerType: parsed.data.providerType as ProviderTypeInput,
      url: parsed.data.url,
      label: parsed.data.label ?? null,
      sortOrder: parsed.data.sortOrder ?? 0,
      isEnabled: parsed.data.isEnabled ?? true,
    });

    return { ok: true, data: { endpoint } };
  } catch (error) {
    logger.error("addProviderEndpoint:error", error);
    const message = error instanceof Error ? error.message : "创建端点失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.CREATE_FAILED };
  }
}

export async function editProviderEndpoint(
  input: unknown
): Promise<ActionResult<{ endpoint: ProviderEndpoint }>> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = UpdateProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const endpoint = await updateProviderEndpoint(parsed.data.endpointId, {
      url: parsed.data.url,
      label: parsed.data.label,
      sortOrder: parsed.data.sortOrder,
      isEnabled: parsed.data.isEnabled,
    });

    if (!endpoint) {
      return {
        ok: false,
        error: "端点不存在",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    return { ok: true, data: { endpoint } };
  } catch (error) {
    logger.error("editProviderEndpoint:error", error);
    const message = error instanceof Error ? error.message : "更新端点失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

export async function removeProviderEndpoint(input: unknown): Promise<ActionResult> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = DeleteProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const endpoint = await findProviderEndpointById(parsed.data.endpointId);
    if (!endpoint) {
      return {
        ok: false,
        error: "端点不存在",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    const ok = await softDeleteProviderEndpoint(parsed.data.endpointId);
    if (!ok) {
      return {
        ok: false,
        error: "端点不存在",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    // Auto cleanup: if the vendor has no active providers/endpoints, delete it as well.
    await tryDeleteProviderVendorIfEmpty(endpoint.vendorId);

    return { ok: true };
  } catch (error) {
    logger.error("removeProviderEndpoint:error", error);
    const message = error instanceof Error ? error.message : "删除端点失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.DELETE_FAILED };
  }
}

export async function probeProviderEndpoint(input: unknown): Promise<
  ActionResult<{
    endpoint: ProviderEndpoint;
    result: {
      ok: boolean;
      method: "HEAD" | "GET";
      statusCode: number | null;
      latencyMs: number | null;
      errorType: string | null;
      errorMessage: string | null;
    };
  }>
> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = ProbeProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const endpoint = await findProviderEndpointById(parsed.data.endpointId);
    if (!endpoint) {
      return {
        ok: false,
        error: "端点不存在",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    const result = await probeProviderEndpointAndRecord({
      endpointId: endpoint.id,
      source: "manual",
      timeoutMs: parsed.data.timeoutMs,
    });

    if (!result) {
      return {
        ok: false,
        error: "端点不存在",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    return { ok: true, data: { endpoint, result } };
  } catch (error) {
    logger.error("probeProviderEndpoint:error", error);
    const message = error instanceof Error ? error.message : "端点测速失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function getProviderEndpointProbeLogs(
  input: unknown
): Promise<ActionResult<{ endpointId: number; logs: ProviderEndpointProbeLog[] }>> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = GetProbeLogsSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const logs = await findProviderEndpointProbeLogs(
      parsed.data.endpointId,
      parsed.data.limit ?? 200,
      parsed.data.offset ?? 0
    );

    return { ok: true, data: { endpointId: parsed.data.endpointId, logs } };
  } catch (error) {
    logger.error("getProviderEndpointProbeLogs:error", error);
    const message = error instanceof Error ? error.message : "获取端点测活历史失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function getEndpointCircuitInfo(input: unknown): Promise<
  ActionResult<{
    endpointId: number;
    health: {
      failureCount: number;
      lastFailureTime: number | null;
      circuitState: "closed" | "open" | "half-open";
      circuitOpenUntil: number | null;
      halfOpenSuccessCount: number;
    };
    config: {
      failureThreshold: number;
      openDuration: number;
      halfOpenSuccessThreshold: number;
    };
  }>
> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = DeleteProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const { health, config } = await getEndpointHealthInfo(parsed.data.endpointId);

    return {
      ok: true,
      data: {
        endpointId: parsed.data.endpointId,
        health,
        config,
      },
    };
  } catch (error) {
    logger.error("getEndpointCircuitInfo:error", error);
    const message = error instanceof Error ? error.message : "获取端点熔断状态失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function resetEndpointCircuit(input: unknown): Promise<ActionResult> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = DeleteProviderEndpointSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    await resetEndpointCircuitState(parsed.data.endpointId);

    return { ok: true };
  } catch (error) {
    logger.error("resetEndpointCircuit:error", error);
    const message = error instanceof Error ? error.message : "重置端点熔断失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function getVendorTypeCircuitInfo(input: unknown): Promise<
  ActionResult<{
    vendorId: number;
    providerType: ProviderType;
    circuitState: "closed" | "open";
    circuitOpenUntil: number | null;
    lastFailureTime: number | null;
    manualOpen: boolean;
  }>
> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = VendorTypeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const info = await getVendorTypeCircuitInfoState(
      parsed.data.vendorId,
      parsed.data.providerType as ProviderTypeInput
    );

    return { ok: true, data: info };
  } catch (error) {
    logger.error("getVendorTypeCircuitInfo:error", error);
    const message = error instanceof Error ? error.message : "获取临时熔断状态失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function setVendorTypeCircuitManualOpen(input: unknown): Promise<ActionResult> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = SetVendorTypeManualOpenSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    await setVendorTypeCircuitManualOpenState(
      parsed.data.vendorId,
      parsed.data.providerType as ProviderTypeInput,
      parsed.data.manualOpen
    );

    return { ok: true };
  } catch (error) {
    logger.error("setVendorTypeCircuitManualOpen:error", error);
    const message = error instanceof Error ? error.message : "设置临时熔断失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function resetVendorTypeCircuit(input: unknown): Promise<ActionResult> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = VendorTypeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    await resetVendorTypeCircuitState(
      parsed.data.vendorId,
      parsed.data.providerType as ProviderTypeInput
    );

    return { ok: true };
  } catch (error) {
    logger.error("resetVendorTypeCircuit:error", error);
    const message = error instanceof Error ? error.message : "重置临时熔断失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.OPERATION_FAILED };
  }
}

export async function editProviderVendor(
  input: unknown
): Promise<ActionResult<{ vendor: ProviderVendor }>> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = EditProviderVendorSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    let faviconUrl: string | null | undefined;
    if (parsed.data.websiteUrl !== undefined) {
      if (parsed.data.websiteUrl) {
        try {
          const url = new URL(parsed.data.websiteUrl);
          const domain = url.hostname;
          faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        } catch (_error) {
          faviconUrl = null;
        }
      } else {
        // websiteUrl explicitly cleared (null) -> clear favicon as well
        faviconUrl = null;
      }
    }

    const vendor = await updateProviderVendor(parsed.data.vendorId, {
      displayName: parsed.data.displayName,
      websiteUrl: parsed.data.websiteUrl,
      faviconUrl,
    });

    if (!vendor) {
      return {
        ok: false,
        error: "Vendor not found",
        errorCode: ERROR_CODES.NOT_FOUND,
      };
    }

    return { ok: true, data: { vendor } };
  } catch (error) {
    logger.error("editProviderVendor:error", error);
    const message = error instanceof Error ? error.message : "更新供应商失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.UPDATE_FAILED };
  }
}

export async function removeProviderVendor(input: unknown): Promise<ActionResult> {
  try {
    const session = await getAdminSession();
    if (!session) {
      return {
        ok: false,
        error: "无权限执行此操作",
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const parsed = DeleteProviderVendorSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: formatZodError(parsed.error),
        errorCode: extractZodErrorCode(parsed.error),
      };
    }

    const ok = await deleteProviderVendor(parsed.data.vendorId);
    if (!ok) {
      return {
        ok: false,
        error: "Vendor not found or could not be deleted",
        errorCode: ERROR_CODES.DELETE_FAILED,
      };
    }

    try {
      await publishProviderCacheInvalidation();
    } catch (error) {
      logger.warn("removeProviderVendor:cache_invalidation_failed", {
        vendorId: parsed.data.vendorId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { ok: true };
  } catch (error) {
    logger.error("removeProviderVendor:error", error);
    const message = error instanceof Error ? error.message : "删除供应商失败";
    return { ok: false, error: message, errorCode: ERROR_CODES.DELETE_FAILED };
  }
}
