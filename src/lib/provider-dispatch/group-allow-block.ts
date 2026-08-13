/**
 * Group-level provider allow/block list filter.
 *
 * "先匹配白名单后匹配黑名单" semantics:
 *   1. Whitelist checked first: if non-empty, only providers whose id is in the
 *      whitelist may serve (whitelist empty = no restriction).
 *   2. Blacklist checked second: providers in the blacklist are always excluded,
 *      even if they passed the whitelist.
 *
 * Both lists are keyed by provider id (number).
 * null/empty array = list disabled.
 */

import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { parseProviderGroups, resolveProviderGroupsWithDefault } from "@/lib/utils/provider-group";

export type GroupAllowBlockLists = {
  whitelist: number[] | null;
  blacklist: number[] | null;
};

/**
 * Check if a single provider passes the allow/block lists for a single group.
 */
export function isProviderAllowedByGroupLists(
  providerId: number,
  lists: GroupAllowBlockLists | null | undefined
): boolean {
  if (!lists) return true;

  // Whitelist: if non-empty, provider must be in it
  const whitelist = lists.whitelist;
  if (whitelist && whitelist.length > 0) {
    if (!whitelist.includes(providerId)) return false;
  }

  // Blacklist: if non-empty, provider must NOT be in it
  const blacklist = lists.blacklist;
  if (blacklist && blacklist.length > 0) {
    if (blacklist.includes(providerId)) return false;
  }

  return true;
}

/**
 * Resolve the allow/block lists that apply to a provider in the context of
 * one or more effective dispatch groups.
 *
 * Semantics:
 * - Parse effectiveGroups (comma-separated tags from the session's key/user group).
 * - If effectiveGroups includes "all" → no lists apply (everything passes).
 * - For each effective group tag: if the provider's groupTag overlaps with it,
 *   look up that group's lists. Provider must pass ALL matching groups' lists.
 * - If no matching group has lists configured → passes.
 *
 * @param listsByGroup  Map of group name → { whitelist, blacklist } (from repository cache)
 * @param effectiveGroups  Comma-separated group tags from the session (e.g. "codex" or "codex,grok")
 * @param providerGroupTag  Provider's groupTag field (may be null or comma-separated)
 * @returns  Array of lists objects for each matching group (empty = no restriction)
 */
export function resolveProviderGroupListsForProvider(
  listsByGroup: ReadonlyMap<string, GroupAllowBlockLists> | null | undefined,
  effectiveGroups: string | null | undefined,
  providerGroupTag: string | null
): GroupAllowBlockLists[] {
  if (!listsByGroup || !effectiveGroups) return [];

  const effectiveTags = parseProviderGroups(effectiveGroups);
  if (effectiveTags.length === 0 || effectiveTags.includes(PROVIDER_GROUP.ALL)) return [];

  const providerTags = resolveProviderGroupsWithDefault(providerGroupTag);
  const matching: GroupAllowBlockLists[] = [];

  for (const tag of effectiveTags) {
    // Only apply lists for groups the provider actually belongs to
    if (!providerTags.includes(tag)) continue;

    const lists = listsByGroup.get(tag);
    if (lists && (lists.whitelist || lists.blacklist)) {
      matching.push(lists);
    }
  }

  return matching;
}

/**
 * Convenience: check a provider against all resolved lists.
 * Returns true only if the provider passes ALL lists.
 */
export function isProviderAllowedByAllLists(
  providerId: number,
  lists: GroupAllowBlockLists[]
): boolean {
  if (lists.length === 0) return true;
  return lists.every((l) => isProviderAllowedByGroupLists(providerId, l));
}