import type { ProviderType } from "@/types/provider";

export const PUBLIC_STATUS_DESCRIPTION_VERSION = 2;

const VALID_PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set([
  "claude",
  "claude-auth",
  "codex",
  "gemini",
  "gemini-cli",
  "openai-compatible",
]);

export interface PublicStatusModelConfig {
  modelKey: string;
  providerTypeOverride?: ProviderType;
}

export interface PublicStatusGroupConfig {
  displayName?: string;
  publicGroupSlug?: string;
  explanatoryCopy?: string | null;
  sortOrder?: number;
  publicModels: PublicStatusModelConfig[];
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
  publicModels: PublicStatusModelConfig[];
}

interface LegacyPublicStatusGroupConfigInput {
  displayName?: unknown;
  publicGroupSlug?: unknown;
  explanatoryCopy?: unknown;
  sortOrder?: unknown;
  publicModels?: unknown;
  publicModelKeys?: unknown;
  modelIds?: unknown;
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

function sanitizeProviderType(value: unknown): ProviderType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim() as ProviderType;
  return VALID_PROVIDER_TYPES.has(normalized) ? normalized : undefined;
}

function sanitizePublicModels(publicModels: unknown): PublicStatusModelConfig[] {
  if (!Array.isArray(publicModels)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: PublicStatusModelConfig[] = [];

  for (const entry of publicModels) {
    const isObjectEntry = typeof entry === "object" && entry !== null;
    const modelKey =
      typeof entry === "string"
        ? sanitizeString(entry)
        : isObjectEntry
          ? sanitizeString((entry as { modelKey?: unknown }).modelKey)
          : undefined;

    if (!modelKey || seen.has(modelKey)) {
      continue;
    }

    seen.add(modelKey);
    const providerTypeOverride =
      isObjectEntry
        ? sanitizeProviderType((entry as { providerTypeOverride?: unknown }).providerTypeOverride)
        : undefined;

    normalized.push({
      modelKey,
      ...(providerTypeOverride ? { providerTypeOverride } : {}),
    });
  }

  return normalized;
}

function sanitizeLegacyPublicModels(
  publicModels: unknown,
  publicModelKeys: unknown,
  modelIds: unknown
): PublicStatusModelConfig[] {
  const normalizedPublicModels = sanitizePublicModels(publicModels);
  if (normalizedPublicModels.length > 0) {
    return normalizedPublicModels;
  }

  return sanitizePublicModels(publicModelKeys ?? modelIds);
}

export function getPublicStatusModelKeys(publicModels: PublicStatusModelConfig[]): string[] {
  return publicModels.map((model) => model.modelKey);
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
      version?: unknown;
      note?: unknown;
      publicStatus?: LegacyPublicStatusGroupConfigInput | null;
    };

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { note: description, publicStatus: null };
    }

    if (typeof parsed.version === "number" && parsed.version > PUBLIC_STATUS_DESCRIPTION_VERSION) {
      return { note: description, publicStatus: null };
    }

    const note = sanitizeString(parsed.note) ?? null;
    const publicStatus = parsed.publicStatus;
    const groupConfig =
      publicStatus && typeof publicStatus === "object"
        ? {
            displayName: sanitizeString(publicStatus.displayName),
            publicGroupSlug: sanitizeString(publicStatus.publicGroupSlug),
            explanatoryCopy: sanitizeString(publicStatus.explanatoryCopy) ?? null,
            sortOrder:
              typeof publicStatus.sortOrder === "number" && Number.isFinite(publicStatus.sortOrder)
                ? publicStatus.sortOrder
                : undefined,
            publicModels: sanitizeLegacyPublicModels(
              publicStatus.publicModels,
              publicStatus.publicModelKeys,
              publicStatus.modelIds
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
          groupConfig.publicModels.length > 0)
          ? groupConfig
          : null,
    };
  } catch {
    return { note: description, publicStatus: null };
  }
}

export function serializePublicStatusDescription(
  input: ParsedPublicStatusDescription & {
    publicStatus?:
      | (ParsedPublicStatusDescription["publicStatus"] & { publicModelKeys?: unknown })
      | null;
  }
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
  const publicModels = sanitizeLegacyPublicModels(
    input.publicStatus?.publicModels,
    input.publicStatus?.publicModelKeys,
    undefined
  );

  if (
    !note &&
    !displayName &&
    !publicGroupSlug &&
    !explanatoryCopy &&
    sortOrder === undefined &&
    publicModels.length === 0
  ) {
    return null;
  }

  return JSON.stringify({
    version: PUBLIC_STATUS_DESCRIPTION_VERSION,
    ...(note ? { note } : {}),
    ...(displayName ||
    publicGroupSlug ||
    explanatoryCopy ||
    sortOrder !== undefined ||
    publicModels.length > 0
      ? {
          publicStatus: {
            ...(displayName ? { displayName } : {}),
            ...(publicGroupSlug ? { publicGroupSlug } : {}),
            ...(explanatoryCopy ? { explanatoryCopy } : {}),
            ...(sortOrder !== undefined ? { sortOrder } : {}),
            publicModels,
          },
        }
      : {}),
  });
}

export function collectEnabledPublicStatusGroups(
  groups: PublicStatusConfiguredGroupInput[]
): EnabledPublicStatusGroup[] {
  return groups
    .map((group) => {
      const publicModels = sanitizePublicModels(group.publicStatus?.publicModels);

      return {
        groupName: group.groupName,
        displayName: group.publicStatus?.displayName?.trim() || group.groupName,
        publicGroupSlug:
          group.publicStatus?.publicGroupSlug?.trim() || slugifyPublicGroup(group.groupName),
        explanatoryCopy: group.publicStatus?.explanatoryCopy?.trim() || null,
        sortOrder: group.publicStatus?.sortOrder ?? 0,
        publicModels,
      };
    })
    .filter((group) => group.publicModels.length > 0)
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
