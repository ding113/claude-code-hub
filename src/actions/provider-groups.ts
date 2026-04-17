"use server";

import { getSession } from "@/lib/auth";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import { parseProviderGroups } from "@/lib/utils/provider-group";
import { findAllProvidersFresh } from "@/repository/provider";
import {
  countProvidersUsingGroup,
  findAllProviderGroups,
  findProviderGroupById,
  findProviderGroupByName,
  createProviderGroup as repoCreateProviderGroup,
  deleteProviderGroup as repoDeleteProviderGroup,
  updateProviderGroup as repoUpdateProviderGroup,
} from "@/repository/provider-groups";
import type { ProviderGroup } from "@/types/provider-group";
import type { ActionResult } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderGroupWithCount = ProviderGroup & {
  providerCount: number;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Return all provider groups with the number of providers in each group.
 * Admin-only.
 */
export async function getProviderGroups(): Promise<ActionResult<ProviderGroupWithCount[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "Unauthorized" };
    }

    const [groups, providers] = await Promise.all([
      findAllProviderGroups(),
      findAllProvidersFresh(),
    ]);

    // Count providers per group
    const groupCounts = new Map<string, number>();
    for (const provider of providers) {
      const providerGroups = parseProviderGroups(provider.groupTag);
      if (providerGroups.length === 0) {
        groupCounts.set(PROVIDER_GROUP.DEFAULT, (groupCounts.get(PROVIDER_GROUP.DEFAULT) || 0) + 1);
        continue;
      }
      for (const g of providerGroups) {
        groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
      }
    }

    const data: ProviderGroupWithCount[] = groups.map((group) => ({
      ...group,
      providerCount: groupCounts.get(group.name) || 0,
    }));

    return { ok: true, data };
  } catch (error) {
    logger.error("Failed to fetch provider groups:", error);
    return { ok: false, error: "Failed to fetch provider groups" };
  }
}

/**
 * Create a new provider group.
 * Admin-only. Validates name is non-empty and not duplicate, costMultiplier >= 0.
 */
export async function createProviderGroup(input: {
  name: string;
  costMultiplier?: number;
  description?: string;
}): Promise<ActionResult<ProviderGroup>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "Unauthorized" };
    }

    const name = input.name?.trim();
    if (!name) {
      return { ok: false, error: "Group name is required", errorCode: "NAME_REQUIRED" };
    }

    if (
      input.costMultiplier !== undefined &&
      (!Number.isFinite(input.costMultiplier) || input.costMultiplier < 0)
    ) {
      return {
        ok: false,
        error: "Cost multiplier must be a finite non-negative number",
        errorCode: "INVALID_MULTIPLIER",
      };
    }

    // Check for duplicate name
    const existing = await findProviderGroupByName(name);
    if (existing) {
      return {
        ok: false,
        error: "A group with this name already exists",
        errorCode: "DUPLICATE_NAME",
      };
    }

    const group = await repoCreateProviderGroup({
      name,
      costMultiplier: input.costMultiplier,
      description: input.description ?? null,
    });

    return { ok: true, data: group };
  } catch (error) {
    logger.error("Failed to create provider group:", error);
    return { ok: false, error: "Failed to create provider group" };
  }
}

/**
 * Update an existing provider group by id.
 * Admin-only.
 */
export async function updateProviderGroup(
  id: number,
  input: { costMultiplier?: number; description?: string | null }
): Promise<ActionResult<ProviderGroup>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "Unauthorized" };
    }

    if (
      input.costMultiplier !== undefined &&
      (!Number.isFinite(input.costMultiplier) || input.costMultiplier < 0)
    ) {
      return {
        ok: false,
        error: "Cost multiplier must be a finite non-negative number",
        errorCode: "INVALID_MULTIPLIER",
      };
    }

    const updated = await repoUpdateProviderGroup(id, {
      costMultiplier: input.costMultiplier,
      description: input.description,
    });

    if (!updated) {
      return { ok: false, error: "Provider group not found" };
    }

    return { ok: true, data: updated };
  } catch (error) {
    logger.error("Failed to update provider group:", error);
    return { ok: false, error: "Failed to update provider group" };
  }
}

/**
 * Delete a provider group by id.
 * Admin-only. Cannot delete the "default" group.
 */
export async function deleteProviderGroup(id: number): Promise<ActionResult<void>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "Unauthorized" };
    }

    // Pre-check: verify group exists and is not referenced by any provider.
    const existing = await findProviderGroupById(id);
    if (!existing) {
      return { ok: false, error: "Provider group not found" };
    }

    if (existing.name === PROVIDER_GROUP.DEFAULT) {
      return {
        ok: false,
        error: "Cannot delete the default group",
        errorCode: "CANNOT_DELETE_DEFAULT",
      };
    }

    const referenceCount = await countProvidersUsingGroup(existing.name);
    if (referenceCount > 0) {
      return {
        ok: false,
        error: "Cannot delete a group that is still referenced by providers",
        errorCode: "GROUP_IN_USE",
      };
    }

    await repoDeleteProviderGroup(id);
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof Error && error.message.includes("default")) {
      return {
        ok: false,
        error: "Cannot delete the default group",
        errorCode: "CANNOT_DELETE_DEFAULT",
      };
    }
    logger.error("Failed to delete provider group:", error);
    return { ok: false, error: "Failed to delete provider group" };
  }
}
