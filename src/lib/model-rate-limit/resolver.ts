import type {
  BoostGrant,
  LimitSubjectType,
  LimitWindow,
  ModelLimitBucket,
  ModelLimitCaps,
  ModelLimitResolveParams,
  ModelLimitSnapshot,
  ModelLimitSource,
} from "./types";

// ============================================================================
// group-rate-limit resolver (§4) — PURE function over an in-process snapshot.
// No I/O: the snapshot (built by cache.ts) carries everything resolution needs,
// so the MAX-merge (D4/D5) and boost (F1/F2) logic is fully unit-testable.
// ============================================================================

type UsdField =
  | "limit5hUsd"
  | "dailyLimitUsd"
  | "limitWeeklyUsd"
  | "limitMonthlyUsd"
  | "limitTotalUsd";

const USD_WINDOWS: ReadonlyArray<{ window: LimitWindow; field: UsdField }> = [
  { window: "5h", field: "limit5hUsd" },
  { window: "daily", field: "dailyLimitUsd" },
  { window: "weekly", field: "limitWeeklyUsd" },
  { window: "monthly", field: "limitMonthlyUsd" },
  { window: "total", field: "limitTotalUsd" },
];

/** Snapshot key for a limit source. Shared with cache.ts to keep formats aligned. */
export function modelLimitSourceKey(
  subjectType: LimitSubjectType,
  subjectId: number,
  modelGroupId: number
): string {
  return `${subjectType}:${subjectId}:${modelGroupId}`;
}

/** MAX where `null` (unlimited) wins as +infinity (§4.4). Both args defined. */
function maxCap(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

/** MAX over user-group sources for one window; undefined when there are none. */
function groupMaxForField(
  ugSources: readonly ModelLimitSource[],
  field: UsdField
): number | null | undefined {
  if (ugSources.length === 0) return undefined;
  let acc: number | null = ugSources[0].caps[field];
  for (let i = 1; i < ugSources.length; i++) {
    acc = maxCap(acc, ugSources[i].caps[field]);
  }
  return acc;
}

/** Sum of active boosts for (user, group, window) at `now` (F2 in-memory window). */
function boostSum(
  grants: readonly BoostGrant[] | undefined,
  modelGroupId: number,
  window: LimitWindow,
  now: Date
): number {
  if (!grants) return 0;
  const t = now.getTime();
  let sum = 0;
  for (const g of grants) {
    if (g.modelGroupId !== modelGroupId || g.window !== window) continue;
    if (g.validFrom.getTime() <= t && t < g.validTo.getTime()) {
      sum += g.amountUsd;
    }
  }
  return sum;
}

/** Combine groupMax and the (boost-adjusted) personal effective cap for a window. */
function mergeWindow(
  groupMax: number | null | undefined,
  personalEff: number | null | undefined
): number | null {
  if (groupMax === undefined) return (personalEff ?? null) as number | null;
  if (personalEff === undefined) return groupMax;
  return maxCap(groupMax, personalEff);
}

function mergeUserCaps(
  indiv: ModelLimitSource | null,
  ugSources: readonly ModelLimitSource[],
  grants: readonly BoostGrant[] | undefined,
  modelGroupId: number,
  now: Date
): ModelLimitCaps {
  // 5h reset metadata follows the individual source if present, else the first
  // user-group source (the bucket is always measured against the user's own 5h usage).
  const metaSource = indiv ?? ugSources[0];
  const caps: ModelLimitCaps = {
    limit5hUsd: null,
    limit5hResetMode: metaSource.caps.limit5hResetMode,
    dailyLimitUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limit5hCostResetAt: metaSource.caps.limit5hCostResetAt,
  };

  for (const { window, field } of USD_WINDOWS) {
    const groupMax = groupMaxForField(ugSources, field);
    // F1: with no individual row, the virtual personal source baseline = groupMax,
    // so a boost still lifts the cap above the user-group ceiling.
    const personalBase: number | null | undefined = indiv ? indiv.caps[field] : groupMax;
    const sum = boostSum(grants, modelGroupId, window, now);
    const personalEff: number | null | undefined =
      personalBase === undefined ? undefined : personalBase === null ? null : personalBase + sum;

    caps[field] = mergeWindow(groupMax, personalEff);
  }

  return caps;
}

/**
 * Resolve the enforceable buckets for a request (§4). Returns [] when the model
 * belongs to no group (D9). Key side is an independent AND bucket; user side is
 * the MAX merge of individual + user-group sources with boosts applied (D4/D5/F1).
 */
export function resolveModelLimitsFromSnapshot(
  snapshot: ModelLimitSnapshot,
  params: ModelLimitResolveParams
): ModelLimitBucket[] {
  const { userId, keyId, model, tags, now } = params;

  // OPT-F: zero-group system short-circuits before any per-model lookup.
  if (snapshot.modelToGroupId.size === 0) return [];

  const modelGroupId = snapshot.modelToGroupId.get(model);
  if (modelGroupId === undefined) return []; // model in no group -> both axes fall back (D9)

  const members = [...(snapshot.groupMembers.get(modelGroupId) ?? [])];
  const buckets: ModelLimitBucket[] = [];

  // Key side: independent bucket, no boost (D11).
  if (keyId !== undefined) {
    const keyRow = snapshot.limits.get(modelLimitSourceKey("key", keyId, modelGroupId));
    if (keyRow) {
      buckets.push({
        axis: "key",
        scopeId: keyId,
        modelGroupId,
        models: members,
        caps: keyRow.caps,
      });
    }
  }

  // User side: MAX merge across individual + user-group sources (per-member, D5).
  const indiv = snapshot.limits.get(modelLimitSourceKey("user", userId, modelGroupId)) ?? null;
  const ugSources: ModelLimitSource[] = [];
  for (const tag of tags) {
    const ugIds = snapshot.userGroupIdsByTag.get(tag);
    if (!ugIds) continue;
    for (const ugId of ugIds) {
      const ugRow = snapshot.limits.get(modelLimitSourceKey("user_group", ugId, modelGroupId));
      if (ugRow) ugSources.push(ugRow);
    }
  }

  if (indiv || ugSources.length > 0) {
    const grants = snapshot.boostGrantsByUser.get(userId);
    buckets.push({
      axis: "user",
      scopeId: userId,
      modelGroupId,
      models: members,
      caps: mergeUserCaps(indiv, ugSources, grants, modelGroupId, now),
    });
  }
  // No source -> userSide null -> boost lazy, axis falls back to mainline (D9).

  return buckets;
}

/** Per-subject resolution inputs (no `model`): enumerate across all groups. */
export interface SubjectModelLimitsParams {
  userId: number;
  keyId?: number;
  tags: readonly string[];
  now: Date;
}

/**
 * Enumerate every enforceable bucket the subject (user / key / its user groups)
 * has across ALL model groups — the display counterpart of the per-request
 * resolver. Used by the self-service usage page to show one quota view per model
 * group. Reuses resolveModelLimitsFromSnapshot per candidate group (via a
 * representative member model) so MAX-merge / boost / per-member semantics stay
 * identical to enforcement (D4/D5/F1).
 */
export function resolveAllSubjectModelLimits(
  snapshot: ModelLimitSnapshot,
  params: SubjectModelLimitsParams
): ModelLimitBucket[] {
  const { userId, keyId, tags, now } = params;
  if (snapshot.modelToGroupId.size === 0) return [];

  const userGroupIds = new Set<number>();
  for (const tag of tags) {
    for (const ugId of snapshot.userGroupIdsByTag.get(tag) ?? []) {
      userGroupIds.add(ugId);
    }
  }

  const buckets: ModelLimitBucket[] = [];
  for (const [groupId, members] of snapshot.groupMembers) {
    if (members.length === 0) continue;

    const hasKeySource =
      keyId !== undefined && snapshot.limits.has(modelLimitSourceKey("key", keyId, groupId));
    const hasUserSource = snapshot.limits.has(modelLimitSourceKey("user", userId, groupId));
    const hasUserGroupSource = [...userGroupIds].some((ugId) =>
      snapshot.limits.has(modelLimitSourceKey("user_group", ugId, groupId))
    );
    if (!hasKeySource && !hasUserSource && !hasUserGroupSource) continue;

    buckets.push(
      ...resolveModelLimitsFromSnapshot(snapshot, { userId, keyId, model: members[0], tags, now })
    );
  }

  return buckets;
}
