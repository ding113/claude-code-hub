export interface PublicStatusGroupConfig {
  displayName?: string;
  publicGroupSlug?: string;
  explanatoryCopy?: string | null;
  sortOrder?: number;
  publicModelKeys: string[];
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
  publicGroupSlug: string;
  explanatoryCopy: string | null;
  sortOrder: number;
  publicModelKeys: string[];
}

const CONFIG_CACHE_TTL_MS = 60 * 1000;

let cachedConfiguredGroups: EnabledPublicStatusGroup[] | null = null;
let cachedConfiguredGroupsAt = 0;

function sanitizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizePublicModelKeys(modelKeys: unknown): string[] {
  if (!Array.isArray(modelKeys)) {
    return [];
  }

  return Array.from(
    new Set(
      modelKeys
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function slugifyPublicGroup(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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
      publicStatus?: {
        displayName?: unknown;
        publicGroupSlug?: unknown;
        explanatoryCopy?: unknown;
        sortOrder?: unknown;
        publicModelKeys?: unknown;
        modelIds?: unknown;
      } | null;
    };

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { note: description, publicStatus: null };
    }

    const note = sanitizeString(parsed.note) ?? null;
    const groupConfig =
      parsed.publicStatus && typeof parsed.publicStatus === "object"
        ? {
            displayName: sanitizeString(parsed.publicStatus.displayName),
            publicGroupSlug: sanitizeString(parsed.publicStatus.publicGroupSlug),
            explanatoryCopy: sanitizeString(parsed.publicStatus.explanatoryCopy) ?? null,
            sortOrder:
              typeof parsed.publicStatus.sortOrder === "number" &&
              Number.isFinite(parsed.publicStatus.sortOrder)
                ? parsed.publicStatus.sortOrder
                : undefined,
            publicModelKeys: sanitizePublicModelKeys(
              parsed.publicStatus.publicModelKeys ?? parsed.publicStatus.modelIds
            ),
          }
        : null;

    return {
      note,
      publicStatus:
        groupConfig &&
        (groupConfig.displayName ||
          groupConfig.publicGroupSlug ||
          groupConfig.explanatoryCopy ||
          groupConfig.sortOrder !== undefined ||
          groupConfig.publicModelKeys.length > 0)
          ? groupConfig
          : null,
    };
  } catch {
    return { note: description, publicStatus: null };
  }
}

export function serializePublicStatusDescription(
  input: ParsedPublicStatusDescription
): string | null {
  const note = sanitizeString(input.note) ?? null;
  const displayName = sanitizeString(input.publicStatus?.displayName);
  const publicGroupSlug = sanitizeString(input.publicStatus?.publicGroupSlug);
  const explanatoryCopy = sanitizeString(input.publicStatus?.explanatoryCopy) ?? null;
  const sortOrder =
    typeof input.publicStatus?.sortOrder === "number" &&
    Number.isFinite(input.publicStatus.sortOrder)
      ? input.publicStatus.sortOrder
      : undefined;
  const publicModelKeys = sanitizePublicModelKeys(input.publicStatus?.publicModelKeys);

  if (
    !note &&
    !displayName &&
    !publicGroupSlug &&
    !explanatoryCopy &&
    sortOrder === undefined &&
    publicModelKeys.length === 0
  ) {
    return null;
  }

  return JSON.stringify({
    ...(note ? { note } : {}),
    ...(displayName ||
    publicGroupSlug ||
    explanatoryCopy ||
    sortOrder !== undefined ||
    publicModelKeys.length > 0
      ? {
          publicStatus: {
            ...(displayName ? { displayName } : {}),
            ...(publicGroupSlug ? { publicGroupSlug } : {}),
            ...(explanatoryCopy ? { explanatoryCopy } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            publicModelKeys,
          },
        }
      : {}),
  });
}

export function collectEnabledPublicStatusGroups(
  groups: PublicStatusConfiguredGroupInput[]
): EnabledPublicStatusGroup[] {
  return groups
    .filter((group) => group.publicStatus && group.publicStatus.publicModelKeys.length > 0)
    .map((group) => ({
      groupName: group.groupName,
      displayName: group.publicStatus?.displayName?.trim() || group.groupName,
      publicGroupSlug:
        group.publicStatus?.publicGroupSlug?.trim() || slugifyPublicGroup(group.groupName),
      explanatoryCopy: group.publicStatus?.explanatoryCopy?.trim() || null,
      sortOrder: group.publicStatus?.sortOrder ?? 0,
      publicModelKeys: sanitizePublicModelKeys(group.publicStatus?.publicModelKeys),
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.displayName.localeCompare(right.displayName)
    );
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
