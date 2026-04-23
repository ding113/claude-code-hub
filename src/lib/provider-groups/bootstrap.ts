import { logger } from "@/lib/logger";
import { resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";
import { findAllProvidersFresh } from "@/repository/provider";
import { ensureProviderGroupsExist, findAllProviderGroups } from "@/repository/provider-groups";
import type { ProviderGroup } from "@/types/provider-group";

const PROVIDER_GROUP_NAME_MAX = 200;

export interface ProviderGroupBootstrapResult {
  groups: ProviderGroup[];
  groupCounts: Map<string, number>;
}

interface ProviderGroupBootstrapInput {
  findAllProviderGroups?: () => Promise<ProviderGroup[]>;
  findAllProvidersFresh?: () => Promise<Array<{ groupTag: string | null }>>;
  ensureProviderGroupsExist?: (names: string[]) => Promise<void>;
  logSelfHealFailure?: (error: unknown, missing: string[]) => void;
}

export async function bootstrapProviderGroupsFromProviders(
  input: ProviderGroupBootstrapInput = {}
): Promise<ProviderGroupBootstrapResult> {
  const loadProviderGroups = input.findAllProviderGroups ?? findAllProviderGroups;
  const loadProviders = input.findAllProvidersFresh ?? findAllProvidersFresh;
  const ensureGroups = input.ensureProviderGroupsExist ?? ensureProviderGroupsExist;
  const logSelfHealFailure =
    input.logSelfHealFailure ??
    ((error: unknown, missing: string[]) => {
      logger.warn("provider-groups:bootstrap_self_heal_failed", {
        error: error instanceof Error ? error.message : String(error),
        missingCount: missing.length,
      });
    });

  const [initialGroups, providers] = await Promise.all([loadProviderGroups(), loadProviders()]);

  const referenced = new Set<string>();
  const groupCounts = new Map<string, number>();
  for (const provider of providers) {
    const parsed = resolveProviderGroupsWithDefault(provider.groupTag);
    for (const name of parsed) {
      referenced.add(name);
      groupCounts.set(name, (groupCounts.get(name) || 0) + 1);
    }
  }

  const existingNames = new Set(initialGroups.map((group) => group.name));
  const missing = [...referenced].filter(
    (groupName) => !existingNames.has(groupName) && groupName.length <= PROVIDER_GROUP_NAME_MAX
  );

  if (missing.length === 0) {
    return {
      groups: initialGroups,
      groupCounts,
    };
  }

  try {
    await ensureGroups(missing);
    return {
      groups: await loadProviderGroups(),
      groupCounts,
    };
  } catch (error) {
    logSelfHealFailure(error, missing);
    return {
      groups: initialGroups,
      groupCounts,
    };
  }
}
