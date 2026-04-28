import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import type { FakeStreamingWhitelistEntry } from "@/types/system-config";

/**
 * Pure helper: decide whether a request is eligible for fake streaming
 * orchestration based on the configured whitelist.
 *
 * Rules:
 * - Trim model and group inputs.
 * - Empty / whitespace-only model => false.
 * - Match whitelist entries by EXACT trimmed model (no prefix / glob / regex).
 * - For the matching entry, an empty groupTags array means "all provider groups".
 * - For non-empty groupTags, the trimmed providerGroupTag must match one of the
 *   trimmed configured tags.
 * - A null / undefined / empty providerGroupTag is treated as PROVIDER_GROUP.DEFAULT
 *   for non-empty groupTags matching, mirroring resolveProviderGroupsWithDefault.
 */
export function isFakeStreamingEligible(
  clientRequestedModel: string,
  providerGroupTag: string | null | undefined,
  whitelist: ReadonlyArray<FakeStreamingWhitelistEntry>
): boolean {
  if (whitelist.length === 0) return false;

  const model = clientRequestedModel.trim();
  if (model.length === 0) return false;

  const entry = whitelist.find((candidate) => candidate.model.trim() === model);
  if (!entry) return false;

  const trimmedGroups = entry.groupTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);

  if (trimmedGroups.length === 0) return true;

  const requestGroup =
    typeof providerGroupTag === "string" && providerGroupTag.trim().length > 0
      ? providerGroupTag.trim()
      : PROVIDER_GROUP.DEFAULT;

  return trimmedGroups.includes(requestGroup);
}
