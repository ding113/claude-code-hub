import {
  MAX_PUBLIC_STATUS_RANGE_HOURS,
  PUBLIC_STATUS_INTERVAL_OPTIONS,
} from "@/lib/public-status/constants";
import type {
  PublicStatusGroupSnapshot,
  PublicStatusModelSnapshot,
  PublicStatusPayload,
  PublicStatusTimelineState,
} from "@/lib/public-status/payload";
import type { PublicStatusServeState } from "@/lib/public-status/redis-contract";

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

export const PUBLIC_STATUS_FILTER_STATUS_VALUES = [
  "operational",
  "degraded",
  "failed",
  "no_data",
] as const;
export const PUBLIC_STATUS_INCLUDE_VALUES = ["meta", "defaults", "groups", "timeline"] as const;
export const PUBLIC_STATUS_ROUTE_STATUS_VALUES = [
  "ready",
  "stale",
  "rebuilding",
  "no_snapshot",
  "no_data",
] as const;

export type PublicStatusFilterStatus = (typeof PUBLIC_STATUS_FILTER_STATUS_VALUES)[number];
export type PublicStatusInclude = (typeof PUBLIC_STATUS_INCLUDE_VALUES)[number];
export type PublicStatusRouteStatus = (typeof PUBLIC_STATUS_ROUTE_STATUS_VALUES)[number];

export interface PublicStatusQueryDefaults {
  intervalMinutes: number;
  rangeHours: number;
}

export interface PublicStatusValidationIssue {
  field: string;
  code: "invalid_number" | "invalid_enum" | "invalid_text" | "too_many_values" | "value_too_long";
  message: string;
  value?: string | null;
}

export class PublicStatusQueryValidationError extends Error {
  details: PublicStatusValidationIssue[];

  constructor(details: PublicStatusValidationIssue[]) {
    super("Invalid public status query parameters");
    this.name = "PublicStatusQueryValidationError";
    this.details = details;
  }
}

export interface ParsedPublicStatusQuery {
  intervalMinutes: number;
  rangeHours: number;
  filters: {
    groupSlugs: string[];
    models: string[];
    statuses: PublicStatusFilterStatus[];
    q: string | null;
  };
  include: PublicStatusInclude[];
  defaults: PublicStatusQueryDefaults;
  resolvedQuery: {
    intervalMinutes: number;
    rangeHours: number;
    groupSlugs: string[];
    models: string[];
    statuses: PublicStatusFilterStatus[];
    q: string | null;
    include: PublicStatusInclude[];
  };
}

export interface PublicStatusRouteMeta {
  siteTitle: string | null;
  siteDescription: string | null;
  timeZone: string | null;
}

export interface PublicStatusRouteRebuildState {
  state: PublicStatusServeState;
  hasSnapshot: boolean;
  reason: string | null;
}

export interface PublicStatusRouteResponse {
  generatedAt: string | null;
  freshUntil: string | null;
  status: PublicStatusRouteStatus;
  rebuildState: PublicStatusRouteRebuildState;
  defaults: PublicStatusQueryDefaults | null;
  resolvedQuery: ParsedPublicStatusQuery["resolvedQuery"];
  meta: PublicStatusRouteMeta | null;
  groups: PublicStatusGroupSnapshot[];
}

function pushIssue(
  issues: PublicStatusValidationIssue[],
  issue: PublicStatusValidationIssue
): void {
  issues.push(issue);
}

function dedupePreservingOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clampIntervalMinutes(rawMinutes: number): number {
  let bestValue: number = PUBLIC_STATUS_INTERVAL_OPTIONS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of PUBLIC_STATUS_INTERVAL_OPTIONS) {
    const distance = Math.abs(candidate - rawMinutes);
    if (distance < bestDistance || (distance === bestDistance && candidate > bestValue)) {
      bestValue = candidate;
      bestDistance = distance;
    }
  }

  return bestValue;
}

function parseWindowNumber(
  rawValue: string | null,
  field: "interval" | "rangeHours",
  issues: PublicStatusValidationIssue[]
): number | null {
  if (rawValue === null) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    pushIssue(issues, {
      field,
      code: "invalid_number",
      message: `${field} must be a positive integer`,
      value: rawValue,
    });
    return null;
  }

  const intervalMatch = field === "interval" ? trimmed.match(/^(\d+)(m)?$/i) : null;
  const normalized = field === "interval" ? (intervalMatch?.[1] ?? null) : trimmed;
  const numberSource = normalized ?? trimmed;
  if (!/^\d+$/.test(numberSource)) {
    pushIssue(issues, {
      field,
      code: "invalid_number",
      message: `${field} must be a positive integer`,
      value: rawValue,
    });
    return null;
  }

  const parsed = Number.parseInt(numberSource, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    pushIssue(issues, {
      field,
      code: "invalid_number",
      message: `${field} must be a positive integer`,
      value: rawValue,
    });
    return null;
  }

  return parsed;
}

function parseCsvList(searchParams: URLSearchParams, keys: string[]): string[] {
  return keys.flatMap((key) => {
    const raw = searchParams.get(key);
    if (raw === null) {
      return [];
    }
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  });
}

function validateTextList(
  rawValues: string[],
  field: string,
  issues: PublicStatusValidationIssue[],
  maxLength: number
): string[] {
  if (rawValues.length > 100) {
    pushIssue(issues, {
      field,
      code: "too_many_values",
      message: `${field} accepts at most 100 values`,
      value: String(rawValues.length),
    });
    return [];
  }

  const normalized: string[] = [];
  for (const rawValue of rawValues) {
    if (containsControlCharacters(rawValue)) {
      pushIssue(issues, {
        field,
        code: "invalid_text",
        message: `${field} cannot contain control characters`,
        value: rawValue,
      });
      continue;
    }

    if (rawValue.length > maxLength) {
      pushIssue(issues, {
        field,
        code: "value_too_long",
        message: `${field} values must be at most ${maxLength} characters`,
        value: rawValue,
      });
      continue;
    }

    normalized.push(rawValue);
  }

  return dedupePreservingOrder(normalized);
}

function validateEnumList<T extends readonly string[]>(
  rawValues: string[],
  field: string,
  issues: PublicStatusValidationIssue[],
  allowedValues: T
): T[number][] {
  const allowedSet = new Set<string>(allowedValues);
  const normalized: T[number][] = [];

  for (const rawValue of rawValues) {
    if (!allowedSet.has(rawValue)) {
      pushIssue(issues, {
        field,
        code: "invalid_enum",
        message: `${field} must be one of: ${allowedValues.join(", ")}`,
        value: rawValue,
      });
      continue;
    }

    normalized.push(rawValue as T[number]);
  }

  return dedupePreservingOrder(normalized) as T[number][];
}

function parseSearchQuery(
  rawValue: string | null,
  issues: PublicStatusValidationIssue[]
): string | null {
  if (rawValue === null) {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  if (containsControlCharacters(trimmed)) {
    pushIssue(issues, {
      field: "q",
      code: "invalid_text",
      message: "q cannot contain control characters",
      value: rawValue,
    });
    return null;
  }

  if (trimmed.length > 120) {
    pushIssue(issues, {
      field: "q",
      code: "value_too_long",
      message: "q must be at most 120 characters",
      value: rawValue,
    });
    return null;
  }

  return trimmed;
}

export function parsePublicStatusQuery(
  searchParams: URLSearchParams,
  defaults: PublicStatusQueryDefaults
): ParsedPublicStatusQuery {
  const issues: PublicStatusValidationIssue[] = [];

  const parsedInterval = parseWindowNumber(searchParams.get("interval"), "interval", issues);
  const parsedRangeHours = parseWindowNumber(searchParams.get("rangeHours"), "rangeHours", issues);

  const groupSlugs = validateTextList(
    parseCsvList(searchParams, ["groupSlug", "groupSlugs"]),
    "groupSlug",
    issues,
    120
  );
  const models = validateTextList(
    parseCsvList(searchParams, ["model", "models"]),
    "model",
    issues,
    200
  );
  const statuses = validateEnumList(
    parseCsvList(searchParams, ["status"]),
    "status",
    issues,
    PUBLIC_STATUS_FILTER_STATUS_VALUES
  );
  const include =
    validateEnumList(
      parseCsvList(searchParams, ["include"]),
      "include",
      issues,
      PUBLIC_STATUS_INCLUDE_VALUES
    ) || [];
  const q = parseSearchQuery(searchParams.get("q"), issues);

  if (issues.length > 0) {
    throw new PublicStatusQueryValidationError(issues);
  }

  const intervalMinutes =
    parsedInterval === null ? defaults.intervalMinutes : clampIntervalMinutes(parsedInterval);
  const rangeHours =
    parsedRangeHours === null
      ? defaults.rangeHours
      : Math.min(Math.max(parsedRangeHours, 1), MAX_PUBLIC_STATUS_RANGE_HOURS);
  const includeValues = include.length > 0 ? include : [...PUBLIC_STATUS_INCLUDE_VALUES];

  return {
    intervalMinutes,
    rangeHours,
    filters: {
      groupSlugs,
      models,
      statuses,
      q,
    },
    include: includeValues,
    defaults: {
      intervalMinutes: defaults.intervalMinutes,
      rangeHours: defaults.rangeHours,
    },
    resolvedQuery: {
      intervalMinutes,
      rangeHours,
      groupSlugs,
      models,
      statuses,
      q,
      include: includeValues,
    },
  };
}

function includesInsensitive(haystacks: Array<string | null | undefined>, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase();
  return haystacks.some((value) => value?.toLowerCase().includes(normalizedNeedle));
}

function deriveModelFilterState(
  model: Pick<PublicStatusModelSnapshot, "timeline" | "latestState">
): PublicStatusTimelineState {
  for (let index = model.timeline.length - 1; index >= 0; index--) {
    const bucket = model.timeline[index];
    if (bucket.state === "failed") {
      return "failed";
    }
    if (bucket.state === "no_data") {
      continue;
    }

    if (bucket.availabilityPct !== null && bucket.availabilityPct < 50) {
      return "degraded";
    }

    return bucket.state === "degraded" ? "degraded" : "operational";
  }

  return model.latestState ?? "no_data";
}

export function filterPublicStatusGroups(
  groups: PublicStatusGroupSnapshot[],
  query: ParsedPublicStatusQuery
): PublicStatusGroupSnapshot[] {
  const groupFilter = new Set(query.filters.groupSlugs);
  const modelFilter = new Set(query.filters.models);
  const statusFilter = new Set(query.filters.statuses);
  const searchQuery = query.filters.q;
  const includeTimeline = query.include.includes("timeline");

  if (!query.include.includes("groups")) {
    return [];
  }

  return groups.flatMap((group) => {
    if (groupFilter.size > 0 && !groupFilter.has(group.publicGroupSlug)) {
      return [];
    }

    const groupMatchesSearch = searchQuery
      ? includesInsensitive([group.displayName, group.publicGroupSlug], searchQuery)
      : false;

    const models = group.models.flatMap((model) => {
      const matchesModelFilter =
        modelFilter.size === 0 ||
        modelFilter.has(model.publicModelKey) ||
        modelFilter.has(model.label);
      if (!matchesModelFilter) {
        return [];
      }

      const derivedState = deriveModelFilterState(model);
      if (statusFilter.size > 0 && !statusFilter.has(derivedState)) {
        return [];
      }

      const modelMatchesSearch =
        !searchQuery ||
        groupMatchesSearch ||
        includesInsensitive([model.publicModelKey, model.label], searchQuery);
      if (!modelMatchesSearch) {
        return [];
      }

      return [
        {
          ...model,
          timeline: includeTimeline ? model.timeline : [],
        },
      ];
    });

    if (models.length === 0) {
      return [];
    }

    return [
      {
        ...group,
        models,
      },
    ];
  });
}

function mapRouteStatus(input: {
  payload: PublicStatusPayload;
  rebuildReason: string | null;
}): PublicStatusRouteStatus {
  if (input.payload.rebuildState === "fresh") {
    return "ready";
  }
  if (input.payload.rebuildState === "stale") {
    return "stale";
  }
  if (input.payload.rebuildState === "no-data") {
    return "no_data";
  }
  if (input.payload.generatedAt) {
    return "stale";
  }

  return input.rebuildReason === "redis-unavailable" ? "rebuilding" : "no_snapshot";
}

export function buildPublicStatusRouteResponse(input: {
  payload: PublicStatusPayload;
  query: ParsedPublicStatusQuery;
  defaults: PublicStatusQueryDefaults;
  meta: PublicStatusRouteMeta | null;
  rebuildReason?: string | null;
}): PublicStatusRouteResponse {
  const rebuildReason = input.rebuildReason ?? null;

  return {
    generatedAt: input.payload.generatedAt,
    freshUntil: input.payload.freshUntil,
    status: mapRouteStatus({
      payload: input.payload,
      rebuildReason,
    }),
    rebuildState: {
      state: input.payload.rebuildState,
      hasSnapshot: Boolean(input.payload.generatedAt),
      reason: null,
    },
    defaults: input.query.include.includes("defaults")
      ? {
          intervalMinutes: input.defaults.intervalMinutes,
          rangeHours: input.defaults.rangeHours,
        }
      : null,
    resolvedQuery: input.query.resolvedQuery,
    meta: input.query.include.includes("meta") ? input.meta : null,
    groups: filterPublicStatusGroups(input.payload.groups, input.query),
  };
}

function mapRouteStatusToPayloadState(status: PublicStatusRouteStatus): PublicStatusServeState {
  switch (status) {
    case "ready":
      return "fresh";
    case "stale":
      return "stale";
    case "rebuilding":
    case "no_snapshot":
      return "rebuilding";
    case "no_data":
      return "no-data";
  }
}

export function toPublicStatusPayload(response: PublicStatusRouteResponse): PublicStatusPayload {
  return {
    rebuildState: mapRouteStatusToPayloadState(response.status),
    sourceGeneration: "",
    generatedAt: response.generatedAt,
    freshUntil: response.freshUntil,
    groups: response.groups,
  };
}
