"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import {
  createProviderEndpoint,
  deleteProviderEndpoint,
  findProviderEndpointById,
  findProviderEndpointsByVendorIds,
  findProviderEndpointsByVendorType,
  updateProviderEndpoint,
} from "@/repository/provider-endpoint";
import type { ProviderEndpoint, ProviderType } from "@/types/provider";
import type { ActionResult } from "./types";

function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}

export async function getProviderEndpointsByVendors(args: {
  vendorIds: number[];
}): Promise<ProviderEndpoint[]> {
  try {
    const session = await getSession();
    if (!isAdmin(session)) {
      return [];
    }

    return await findProviderEndpointsByVendorIds(args.vendorIds);
  } catch (error) {
    logger.error("[ProviderEndpointsAction] Failed to list endpoints", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function getProviderEndpointsByVendorTypeAction(args: {
  vendorId: number;
  providerType: ProviderType;
}): Promise<ProviderEndpoint[]> {
  try {
    const session = await getSession();
    if (!isAdmin(session)) {
      return [];
    }

    return await findProviderEndpointsByVendorType(args.vendorId, args.providerType);
  } catch (error) {
    logger.error("[ProviderEndpointsAction] Failed to list endpoints by vendor/type", {
      vendorId: args.vendorId,
      providerType: args.providerType,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function createProviderEndpointAction(data: {
  vendorId: number;
  providerType: ProviderType;
  baseUrl: string;
  isEnabled?: boolean;
  priority?: number;
  weight?: number;
}): Promise<ActionResult<ProviderEndpoint>> {
  const tError = await getTranslations("errors");

  const session = await getSession();
  if (!session) {
    return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
  }
  if (!isAdmin(session)) {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  try {
    const created = await createProviderEndpoint({
      vendorId: data.vendorId,
      providerType: data.providerType,
      baseUrl: data.baseUrl,
      isEnabled: data.isEnabled,
      priority: data.priority,
      weight: data.weight,
    });

    return { ok: true, data: created };
  } catch (error) {
    logger.error("[ProviderEndpointsAction] Failed to create endpoint", {
      vendorId: data.vendorId,
      providerType: data.providerType,
      baseUrl: data.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "";
    const isUniqueViolation =
      message.includes("uniq_provider_endpoints_vendor_type_base_url") ||
      message.toLowerCase().includes("duplicate");

    if (isUniqueViolation) {
      return { ok: false, error: tError("CONFLICT"), errorCode: ERROR_CODES.CONFLICT };
    }

    return {
      ok: false,
      error: tError("CREATE_FAILED"),
      errorCode: ERROR_CODES.CREATE_FAILED,
    };
  }
}

export async function updateProviderEndpointAction(
  endpointId: number,
  patch: {
    baseUrl?: string;
    isEnabled?: boolean;
    priority?: number;
    weight?: number;
  }
): Promise<ActionResult<ProviderEndpoint>> {
  const tError = await getTranslations("errors");

  const session = await getSession();
  if (!session) {
    return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
  }
  if (!isAdmin(session)) {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  try {
    const updated = await updateProviderEndpoint(endpointId, patch);
    if (!updated) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    return { ok: true, data: updated };
  } catch (error) {
    logger.error("[ProviderEndpointsAction] Failed to update endpoint", {
      endpointId,
      patch,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "";
    const isUniqueViolation =
      message.includes("uniq_provider_endpoints_vendor_type_base_url") ||
      message.toLowerCase().includes("duplicate");

    if (isUniqueViolation) {
      return { ok: false, error: tError("CONFLICT"), errorCode: ERROR_CODES.CONFLICT };
    }

    return {
      ok: false,
      error: tError("UPDATE_FAILED"),
      errorCode: ERROR_CODES.UPDATE_FAILED,
    };
  }
}

export async function deleteProviderEndpointAction(endpointId: number): Promise<ActionResult> {
  const tError = await getTranslations("errors");

  const session = await getSession();
  if (!session) {
    return { ok: false, error: tError("UNAUTHORIZED"), errorCode: ERROR_CODES.UNAUTHORIZED };
  }
  if (!isAdmin(session)) {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  try {
    const endpoint = await findProviderEndpointById(endpointId);
    if (!endpoint) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    const ok = await deleteProviderEndpoint(endpointId);
    if (!ok) {
      return { ok: false, error: tError("DELETE_FAILED"), errorCode: ERROR_CODES.DELETE_FAILED };
    }

    return { ok: true };
  } catch (error) {
    logger.error("[ProviderEndpointsAction] Failed to delete endpoint", {
      endpointId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: tError("DELETE_FAILED"),
      errorCode: ERROR_CODES.DELETE_FAILED,
    };
  }
}
