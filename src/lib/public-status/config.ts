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
const PUBLIC_STATUS_SLUG_MAX_LENGTH = 64;
const PUBLIC_STATUS_SLUG_SUFFIX_LENGTH = 6;
const PUBLIC_STATUS_SLUG_FALLBACK_PREFIX = "group";

interface CollectEnabledPublicStatusGroupsOptions {
  duplicateSlugStrategy?: "throw" | "suffix";
}

let cachedConfiguredGroups: EnabledPublicStatusGroup[] | null = null;
let cachedConfiguredGroupsAt = 0;

export class DuplicatePublicStatusGroupSlugError extends Error {
  constructor(
    public readonly publicGroupSlug: string,
    groupNames: string[]
  ) {
    super(
      `Duplicate normalized publicGroupSlug "${publicGroupSlug}" for groups: ${groupNames.join(", ")}`
    );
    this.name = "DuplicatePublicStatusGroupSlugError";
  }
}

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
    const providerTypeOverride = isObjectEntry
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

function createStablePublicGroupSlugSuffix(input: string): string {
  let hash = 0x811c9dc5;
  for (const character of input) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash
    .toString(36)
    .padStart(PUBLIC_STATUS_SLUG_SUFFIX_LENGTH, "0")
    .slice(0, PUBLIC_STATUS_SLUG_SUFFIX_LENGTH);
}

function appendStablePublicGroupSlugSuffix(base: string, suffix: string): string {
  const prefixLength = Math.max(1, PUBLIC_STATUS_SLUG_MAX_LENGTH - suffix.length - 1);
  const prefix =
    base.slice(0, prefixLength).replace(/-+$/g, "") || PUBLIC_STATUS_SLUG_FALLBACK_PREFIX;
  return `${prefix}-${suffix}`;
}

function slugifyPublicGroupAscii(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PUBLIC_STATUS_SLUG_MAX_LENGTH);
}

export function slugifyPublicGroup(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const asciiSlug = slugifyPublicGroupAscii(trimmed);
  const hasNonAsciiCharacters = Array.from(trimmed).some(
    (character) => (character.codePointAt(0) ?? 0) > 0x7f
  );
  if (!hasNonAsciiCharacters) {
    return asciiSlug;
  }

  const suffix = createStablePublicGroupSlugSuffix(trimmed);
  if (!asciiSlug) {
    return `${PUBLIC_STATUS_SLUG_FALLBACK_PREFIX}-${suffix}`;
  }

  return appendStablePublicGroupSlugSuffix(asciiSlug, suffix);
}

function normalizePublicGroupSlug(groupName: string, publicGroupSlug?: string): string {
  const normalized = slugifyPublicGroup(publicGroupSlug?.trim() || groupName);
  return normalized || slugifyPublicGroup(groupName);
}

export function createUniquePublicGroupSlug(groupName: string, usedSlugs: Set<string>): string {
  const baseSlug = normalizePublicGroupSlug(groupName);
  if (!usedSlugs.has(baseSlug)) {
    usedSlugs.add(baseSlug);
    return baseSlug;
  }

  let counter = 1;
  let candidate = baseSlug;
  while (usedSlugs.has(candidate)) {
    const suffixSource = counter === 1 ? groupName : `${groupName}-${counter}`;
    candidate = appendStablePublicGroupSlugSuffix(
      baseSlug || PUBLIC_STATUS_SLUG_FALLBACK_PREFIX,
      createStablePublicGroupSlugSuffix(suffixSource)
    );
    counter += 1;
  }

  usedSlugs.add(candidate);
  return candidate;
}

function createCollisionPublicGroupSlug(
  baseSlug: string,
  groupName: string,
  usedSlugs: Set<string>
): string {
  let counter = 1;
  let candidate = baseSlug;
  while (usedSlugs.has(candidate)) {
    const suffixSource = counter === 1 ? groupName : `${groupName}-${counter}`;
    candidate = appendStablePublicGroupSlugSuffix(
      baseSlug || PUBLIC_STATUS_SLUG_FALLBACK_PREFIX,
      createStablePublicGroupSlugSuffix(suffixSource)
    );
    counter += 1;
  }

  return candidate;
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
  groups: PublicStatusConfiguredGroupInput[],
  options: CollectEnabledPublicStatusGroupsOptions = {}
): EnabledPublicStatusGroup[] {
  const seenGroupNamesBySlug = new Map<string, string>();
  const usedSlugs = new Set<string>();

  return groups
    .flatMap((group) => {
      const publicModels = sanitizePublicModels(group.publicStatus?.publicModels);
      if (publicModels.length === 0) {
        return [];
      }

      const normalizedPublicGroupSlug = normalizePublicGroupSlug(
        group.groupName,
        group.publicStatus?.publicGroupSlug
      );
      let publicGroupSlug = normalizedPublicGroupSlug;

      const existingGroupName = seenGroupNamesBySlug.get(publicGroupSlug);
      if (existingGroupName) {
        if (options.duplicateSlugStrategy !== "suffix") {
          throw new DuplicatePublicStatusGroupSlugError(publicGroupSlug, [
            existingGroupName,
            group.groupName,
          ]);
        }
        publicGroupSlug = createCollisionPublicGroupSlug(
          normalizedPublicGroupSlug,
          group.groupName,
          usedSlugs
        );
      }

      seenGroupNamesBySlug.set(publicGroupSlug, group.groupName);
      usedSlugs.add(publicGroupSlug);

      return [
        {
          groupName: group.groupName,
          displayName: group.publicStatus?.displayName?.trim() || group.groupName,
          publicGroupSlug,
          explanatoryCopy: group.publicStatus?.explanatoryCopy?.trim() || null,
          sortOrder: group.publicStatus?.sortOrder ?? 0,
          publicModels,
        },
      ];
    })
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
