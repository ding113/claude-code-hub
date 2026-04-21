export interface PublicStatusGroupConfig {
  displayName?: string;
  modelIds: string[];
}

export interface ParsedPublicStatusDescription {
  note: string | null;
  publicStatus: PublicStatusGroupConfig | null;
}

export interface PublicStatusConfiguredGroupInput extends ParsedPublicStatusDescription {
  groupName: string;
}

export interface EnabledPublicStatusGroup {
  groupName: string;
  displayName: string;
  modelIds: string[];
}

const CONFIG_CACHE_TTL_MS = 60 * 1000;

let cachedConfiguredGroups: EnabledPublicStatusGroup[] | null = null;
let cachedConfiguredGroupsAt = 0;

function sanitizeModelIds(modelIds: unknown): string[] {
  if (!Array.isArray(modelIds)) {
    return [];
  }

  return Array.from(
    new Set(
      modelIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function parsePublicStatusDescription(
  description: string | null | undefined
): ParsedPublicStatusDescription {
  if (!description) {
    return { note: null, publicStatus: null };
  }

  try {
    const parsed = JSON.parse(description) as {
      note?: unknown;
      publicStatus?: { displayName?: unknown; modelIds?: unknown } | null;
    };

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { note: description, publicStatus: null };
    }

    const note =
      typeof parsed.note === "string" && parsed.note.trim().length > 0 ? parsed.note.trim() : null;
    const publicStatus =
      parsed.publicStatus && typeof parsed.publicStatus === "object"
        ? {
            displayName:
              typeof parsed.publicStatus.displayName === "string" &&
              parsed.publicStatus.displayName.trim().length > 0
                ? parsed.publicStatus.displayName.trim()
                : undefined,
            modelIds: sanitizeModelIds(parsed.publicStatus.modelIds),
          }
        : null;

    return {
      note,
      publicStatus:
        publicStatus && (publicStatus.displayName || publicStatus.modelIds.length > 0)
          ? publicStatus
          : null,
    };
  } catch {
    return { note: description, publicStatus: null };
  }
}

export function serializePublicStatusDescription(
  input: ParsedPublicStatusDescription
): string | null {
  const note = input.note?.trim() || null;
  const displayName = input.publicStatus?.displayName?.trim() || undefined;
  const modelIds = sanitizeModelIds(input.publicStatus?.modelIds);

  if (!note && !displayName && modelIds.length === 0) {
    return null;
  }

  return JSON.stringify({
    ...(note ? { note } : {}),
    ...(displayName || modelIds.length > 0
      ? {
          publicStatus: {
            ...(displayName ? { displayName } : {}),
            modelIds,
          },
        }
      : {}),
  });
}

export function collectEnabledPublicStatusGroups(
  groups: PublicStatusConfiguredGroupInput[]
): EnabledPublicStatusGroup[] {
  return groups
    .filter((group) => group.publicStatus && group.publicStatus.modelIds.length > 0)
    .map((group) => ({
      groupName: group.groupName,
      displayName: group.publicStatus?.displayName?.trim() || group.groupName,
      modelIds: sanitizeModelIds(group.publicStatus?.modelIds),
    }));
}

export function hasConfiguredPublicStatusTargets(
  groups: PublicStatusConfiguredGroupInput[]
): boolean {
  return collectEnabledPublicStatusGroups(groups).length > 0;
}

export function getConfiguredPublicStatusGroupsOnlyCache(): EnabledPublicStatusGroup[] | null {
  if (!cachedConfiguredGroups) {
    return null;
  }

  if (Date.now() - cachedConfiguredGroupsAt >= CONFIG_CACHE_TTL_MS) {
    return null;
  }

  return cachedConfiguredGroups;
}

export function setConfiguredPublicStatusGroupsCache(groups: EnabledPublicStatusGroup[]): void {
  cachedConfiguredGroups = groups;
  cachedConfiguredGroupsAt = Date.now();
}

export function invalidateConfiguredPublicStatusGroupsCache(): void {
  cachedConfiguredGroups = null;
  cachedConfiguredGroupsAt = 0;
}
