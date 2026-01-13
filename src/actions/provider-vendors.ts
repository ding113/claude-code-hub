"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { normalizeVendorKeyFromUrl } from "@/lib/utils/vendor-key";
import {
  findProviderVendorSummaries,
  type MergeProviderVendorsResult,
  mergeProviderVendors,
  type ProviderVendorSummary,
  splitProviderVendor,
  updateProviderVendor,
} from "@/repository/provider-vendor";
import type { ProviderVendor } from "@/types/provider";
import type { ActionResult } from "./types";

function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}

export async function getProviderVendors(): Promise<ProviderVendorSummary[]> {
  try {
    const session = await getSession();
    if (!isAdmin(session)) {
      return [];
    }

    return await findProviderVendorSummaries();
  } catch (error) {
    logger.error("[ProviderVendorsAction] Failed to list vendors", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function editProviderVendor(
  vendorId: number,
  patch: {
    displayName?: string;
    websiteUrl?: string | null;
    faviconUrl?: string | null;
    isEnabled?: boolean;
  }
): Promise<ActionResult<ProviderVendor>> {
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
    const updated = await updateProviderVendor(vendorId, patch);
    if (!updated) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    return { ok: true, data: updated };
  } catch (error) {
    logger.error("[ProviderVendorsAction] Failed to update vendor", {
      vendorId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: tError("UPDATE_FAILED"),
      errorCode: ERROR_CODES.UPDATE_FAILED,
    };
  }
}

export async function mergeProviderVendorsAction(args: {
  targetVendorId: number;
  sourceVendorIds: number[];
}): Promise<ActionResult<MergeProviderVendorsResult>> {
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

  if (!Number.isFinite(args.targetVendorId) || args.targetVendorId <= 0) {
    return {
      ok: false,
      error: tError("INVALID_FORMAT"),
      errorCode: ERROR_CODES.INVALID_FORMAT,
    };
  }

  try {
    const result = await mergeProviderVendors({
      targetVendorId: args.targetVendorId,
      sourceVendorIds: args.sourceVendorIds,
    });

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[ProviderVendorsAction] Failed to merge vendors", {
      targetVendorId: args.targetVendorId,
      sourceVendorIds: args.sourceVendorIds,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "";
    if (message.includes("not found")) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

export type SplitProviderVendorActionResult = {
  sourceVendorId: number;
  newVendor: ProviderVendor;
  movedProviderIds: number[];
};

export async function splitProviderVendorAction(args: {
  sourceVendorId: number;
  newVendorWebsiteUrlOrHost: string;
  newDisplayName: string;
  providerIdsToMove: number[];
  websiteUrl?: string | null;
  faviconUrl?: string | null;
}): Promise<ActionResult<SplitProviderVendorActionResult>> {
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

  const vendorKey = normalizeVendorKeyFromUrl(args.newVendorWebsiteUrlOrHost);
  if (!vendorKey) {
    return {
      ok: false,
      error: tError("INVALID_URL"),
      errorCode: ERROR_CODES.INVALID_URL,
    };
  }

  try {
    const result = await splitProviderVendor({
      sourceVendorId: args.sourceVendorId,
      newVendorKey: vendorKey,
      newDisplayName: args.newDisplayName,
      websiteUrl: args.websiteUrl ?? null,
      faviconUrl: args.faviconUrl ?? null,
      providerIdsToMove: args.providerIdsToMove,
    });

    return {
      ok: true,
      data: {
        sourceVendorId: result.sourceVendorId,
        newVendor: result.newVendor,
        movedProviderIds: result.movedProviderIds,
      },
    };
  } catch (error) {
    logger.error("[ProviderVendorsAction] Failed to split vendor", {
      sourceVendorId: args.sourceVendorId,
      vendorKey,
      providerIdsToMove: args.providerIdsToMove,
      error: error instanceof Error ? error.message : String(error),
    });

    const message = error instanceof Error ? error.message : "";
    const isUniqueViolation =
      message.includes("uniq_provider_vendors_vendor_key") ||
      message.includes("provider_vendors_vendor_key") ||
      message.toLowerCase().includes("duplicate");

    if (message.includes("source vendor not found")) {
      return { ok: false, error: tError("NOT_FOUND"), errorCode: ERROR_CODES.NOT_FOUND };
    }

    if (isUniqueViolation) {
      return { ok: false, error: tError("CONFLICT"), errorCode: ERROR_CODES.CONFLICT };
    }

    return {
      ok: false,
      error: tError("OPERATION_FAILED"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
