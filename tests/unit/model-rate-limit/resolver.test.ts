import { describe, expect, it } from "vitest";
import {
  modelLimitSourceKey,
  resolveAllSubjectModelLimits,
  resolveModelLimitsFromSnapshot,
} from "@/lib/model-rate-limit/resolver";
import type {
  BoostGrant,
  LimitSubjectType,
  ModelLimitBucket,
  ModelLimitCaps,
  ModelLimitSnapshot,
} from "@/lib/model-rate-limit/types";

const NOW = new Date("2026-05-25T00:00:00.000Z");
const G_OPUS = 1;

function caps(partial: Partial<ModelLimitCaps> = {}): ModelLimitCaps {
  return {
    limit5hUsd: null,
    limit5hResetMode: "fixed",
    dailyLimitUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limit5hCostResetAt: null,
    ...partial,
  };
}

interface SnapConfig {
  modelToGroup?: Record<string, number>;
  groupMembers?: Record<number, string[]>;
  sources?: Array<{
    subjectType: LimitSubjectType;
    subjectId: number;
    modelGroupId: number;
    caps: Partial<ModelLimitCaps>;
  }>;
  userGroupIdsByTag?: Record<string, number[]>;
  boostGrantsByUser?: Record<number, BoostGrant[]>;
}

function buildSnapshot(cfg: SnapConfig): ModelLimitSnapshot {
  const modelToGroupId = new Map<string, number>(
    Object.entries(cfg.modelToGroup ?? { opus: G_OPUS })
  );
  const groupMembers = new Map<number, readonly string[]>(
    Object.entries(cfg.groupMembers ?? { [G_OPUS]: ["opus"] }).map(([k, v]) => [Number(k), v])
  );
  const limits = new Map<
    string,
    { subjectType: LimitSubjectType; subjectId: number; caps: ModelLimitCaps }
  >();
  for (const s of cfg.sources ?? []) {
    limits.set(modelLimitSourceKey(s.subjectType, s.subjectId, s.modelGroupId), {
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      caps: caps(s.caps),
    });
  }
  const userGroupIdsByTag = new Map<string, readonly number[]>(
    Object.entries(cfg.userGroupIdsByTag ?? {})
  );
  const boostGrantsByUser = new Map<number, readonly BoostGrant[]>(
    Object.entries(cfg.boostGrantsByUser ?? {}).map(([k, v]) => [Number(k), v])
  );
  return { modelToGroupId, groupMembers, limits, userGroupIdsByTag, boostGrantsByUser };
}

function userBucket(buckets: ModelLimitBucket[]): ModelLimitBucket | undefined {
  return buckets.find((b) => b.axis === "user");
}
function keyBucket(buckets: ModelLimitBucket[]): ModelLimitBucket | undefined {
  return buckets.find((b) => b.axis === "key");
}

function activeGrant(window: BoostGrant["window"], amountUsd: number): BoostGrant {
  return {
    modelGroupId: G_OPUS,
    window,
    amountUsd,
    validFrom: new Date(NOW.getTime() - 3600_000),
    validTo: new Date(NOW.getTime() + 3600_000),
  };
}

describe("resolveModelLimitsFromSnapshot — target & merge (§18.1)", () => {
  it("T-RS-1: resolves the model's group and exposes members", () => {
    const snap = buildSnapshot({
      groupMembers: { [G_OPUS]: ["opus", "opus-mini"] },
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
    });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      model: "opus",
      tags: [],
      now: NOW,
    });
    const u = userBucket(buckets);
    expect(u?.modelGroupId).toBe(G_OPUS);
    expect(u?.models).toEqual(["opus", "opus-mini"]);
  });

  it("T-RS-2: model in no group -> [] (both axes fall back, D9)", () => {
    const snap = buildSnapshot({ modelToGroup: { opus: G_OPUS } });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      model: "sonnet",
      tags: [],
      now: NOW,
    });
    expect(buckets).toEqual([]);
  });

  it("OPT-F: zero-group system short-circuits to []", () => {
    const snap = buildSnapshot({ modelToGroup: {} });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      model: "opus",
      tags: [],
      now: NOW,
    });
    expect(buckets).toEqual([]);
  });

  it("T-RS-3: userSide daily = max(individual 10, user_group 30) = 30, per-member", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
    });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      model: "opus",
      tags: ["team-a"],
      now: NOW,
    });
    const u = userBucket(buckets);
    expect(u?.scopeId).toBe(5); // measured against the user's own consumption (D5)
    expect(u?.caps.dailyLimitUsd).toBe(30);
  });

  it("T-RS-4: per-window winner can differ across sources", () => {
    const snap = buildSnapshot({
      sources: [
        {
          subjectType: "user",
          subjectId: 5,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 10, limitWeeklyUsd: 100 },
        },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30, limitWeeklyUsd: 50 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: ["team-a"], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(30); // group wins
    expect(u?.caps.limitWeeklyUsd).toBe(100); // individual wins
  });

  it("T-RS-5: key-only config -> keySide bucket, no user bucket (D3/D9)", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "key", subjectId: 99, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 5 } },
      ],
    });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      keyId: 99,
      model: "opus",
      tags: [],
      now: NOW,
    });
    expect(keyBucket(buckets)?.caps.dailyLimitUsd).toBe(5);
    expect(keyBucket(buckets)?.scopeId).toBe(99);
    expect(userBucket(buckets)).toBeUndefined();
  });

  it("T-RS-6: null (unlimited) wins the MAX; boost on that window is ignored", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: null } },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
      boostGrantsByUser: { 5: [activeGrant("daily", 50)] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: ["team-a"], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBeNull();
  });

  it("T-RS-7: MAX over individual + two user groups, per window", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 25 },
        },
        {
          subjectType: "user_group",
          subjectId: 200,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 40 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100], "team-b": [200] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, {
        userId: 5,
        model: "opus",
        tags: ["team-a", "team-b"],
        now: NOW,
      })
    );
    expect(u?.caps.dailyLimitUsd).toBe(40);
  });

  it("Key + user both configured -> two AND buckets", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "key", subjectId: 99, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 5 } },
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 30 } },
      ],
    });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 5,
      keyId: 99,
      model: "opus",
      tags: [],
      now: NOW,
    });
    expect(buckets).toHaveLength(2);
    expect(keyBucket(buckets)?.caps.dailyLimitUsd).toBe(5);
    expect(userBucket(buckets)?.caps.dailyLimitUsd).toBe(30);
  });
});

describe("resolveModelLimitsFromSnapshot — boosts (§18.2)", () => {
  it("T-BO-1: no individual row, group $30 + boost +$50 -> 80 (F1 virtual source)", () => {
    const snap = buildSnapshot({
      sources: [
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
      boostGrantsByUser: { 7: [activeGrant("daily", 50)] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 7, model: "opus", tags: ["team-a"], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(80);
  });

  it("T-BO-2: F1 with no boost -> virtual source = groupMax (no regression)", () => {
    const snap = buildSnapshot({
      sources: [
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 7, model: "opus", tags: ["team-a"], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(30);
  });

  it("T-BO-3: no source + stray boost -> userSide null (boost lazy, no fabricated limit)", () => {
    const snap = buildSnapshot({
      boostGrantsByUser: { 9: [activeGrant("daily", 50)] },
    });
    const buckets = resolveModelLimitsFromSnapshot(snap, {
      userId: 9,
      model: "opus",
      tags: [],
      now: NOW,
    });
    expect(userBucket(buckets)).toBeUndefined();
    expect(buckets).toEqual([]);
  });

  it("T-BO-4: individual 10 + group 30 + two overlapping boosts (+50,+20) -> max(80,30)=80", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
      boostGrantsByUser: { 5: [activeGrant("daily", 50), activeGrant("daily", 20)] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: ["team-a"], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(80);
  });

  it("T-BO-5: boost on a window with no finite cap (unlimited) is a no-op", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
      boostGrantsByUser: { 5: [activeGrant("weekly", 50)] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: [], now: NOW })
    );
    expect(u?.caps.limitWeeklyUsd).toBeNull(); // unlimited stays unlimited
    expect(u?.caps.dailyLimitUsd).toBe(10);
  });

  it("T-BO-6: future grant activates exactly on time (in-memory window, F2)", () => {
    const future: BoostGrant = {
      modelGroupId: G_OPUS,
      window: "daily",
      amountUsd: 50,
      validFrom: new Date(NOW.getTime() + 3600_000),
      validTo: new Date(NOW.getTime() + 7200_000),
    };
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
      boostGrantsByUser: { 5: [future] },
    });
    const before = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: [], now: NOW })
    );
    expect(before?.caps.dailyLimitUsd).toBe(10); // not yet active

    const afterStart = userBucket(
      resolveModelLimitsFromSnapshot(snap, {
        userId: 5,
        model: "opus",
        tags: [],
        now: new Date(NOW.getTime() + 3600_000),
      })
    );
    expect(afterStart?.caps.dailyLimitUsd).toBe(60); // active at validFrom
  });

  it("T-BO-7: expired grant still in snapshot does not apply (@> now guard)", () => {
    const expired: BoostGrant = {
      modelGroupId: G_OPUS,
      window: "daily",
      amountUsd: 50,
      validFrom: new Date(NOW.getTime() - 7200_000),
      validTo: new Date(NOW.getTime() - 3600_000),
    };
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
      boostGrantsByUser: { 5: [expired] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: [], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(10);
  });

  it("T-BO-8/9: removed grant (revocation) -> base cap, no boost", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: [], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(10);
  });

  it("boost only applies to the matching model group", () => {
    const otherGroupGrant: BoostGrant = {
      modelGroupId: 999,
      window: "daily",
      amountUsd: 50,
      validFrom: new Date(NOW.getTime() - 3600_000),
      validTo: new Date(NOW.getTime() + 3600_000),
    };
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
      boostGrantsByUser: { 5: [otherGroupGrant] },
    });
    const u = userBucket(
      resolveModelLimitsFromSnapshot(snap, { userId: 5, model: "opus", tags: [], now: NOW })
    );
    expect(u?.caps.dailyLimitUsd).toBe(10); // grant for a different group ignored
  });
});

describe("resolveAllSubjectModelLimits — per-subject enumeration (my-usage)", () => {
  const G_HAIKU = 2;

  it("enumerates buckets across every group the subject has a source for", () => {
    const snap = buildSnapshot({
      modelToGroup: { opus: G_OPUS, haiku: G_HAIKU },
      groupMembers: { [G_OPUS]: ["opus"], [G_HAIKU]: ["haiku"] },
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
        { subjectType: "user", subjectId: 5, modelGroupId: G_HAIKU, caps: { dailyLimitUsd: 20 } },
      ],
    });
    const buckets = resolveAllSubjectModelLimits(snap, { userId: 5, tags: [], now: NOW });
    const byGroup = new Map(buckets.map((b) => [b.modelGroupId, b]));
    expect(buckets).toHaveLength(2);
    expect(byGroup.get(G_OPUS)?.caps.dailyLimitUsd).toBe(10);
    expect(byGroup.get(G_HAIKU)?.caps.dailyLimitUsd).toBe(20);
  });

  it("includes key + user AND buckets and applies MAX merge per group", () => {
    const snap = buildSnapshot({
      modelToGroup: { opus: G_OPUS },
      groupMembers: { [G_OPUS]: ["opus", "opus-mini"] },
      sources: [
        { subjectType: "key", subjectId: 99, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 5 } },
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
        {
          subjectType: "user_group",
          subjectId: 100,
          modelGroupId: G_OPUS,
          caps: { dailyLimitUsd: 30 },
        },
      ],
      userGroupIdsByTag: { "team-a": [100] },
    });
    const buckets = resolveAllSubjectModelLimits(snap, {
      userId: 5,
      keyId: 99,
      tags: ["team-a"],
      now: NOW,
    });
    expect(keyBucket(buckets)?.caps.dailyLimitUsd).toBe(5);
    expect(userBucket(buckets)?.caps.dailyLimitUsd).toBe(30); // max(10, 30)
    expect(userBucket(buckets)?.models).toEqual(["opus", "opus-mini"]);
  });

  it("skips groups the subject has no source for", () => {
    const snap = buildSnapshot({
      modelToGroup: { opus: G_OPUS, haiku: G_HAIKU },
      groupMembers: { [G_OPUS]: ["opus"], [G_HAIKU]: ["haiku"] },
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
    });
    const buckets = resolveAllSubjectModelLimits(snap, { userId: 5, tags: [], now: NOW });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].modelGroupId).toBe(G_OPUS);
  });

  it("returns [] when the subject has no model-group config", () => {
    const snap = buildSnapshot({
      sources: [
        { subjectType: "user", subjectId: 7, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
    });
    expect(resolveAllSubjectModelLimits(snap, { userId: 5, tags: [], now: NOW })).toEqual([]);
  });

  it("applies an active boost to the enumerated bucket", () => {
    const snap = buildSnapshot({
      modelToGroup: { opus: G_OPUS },
      groupMembers: { [G_OPUS]: ["opus"] },
      sources: [
        { subjectType: "user", subjectId: 5, modelGroupId: G_OPUS, caps: { dailyLimitUsd: 10 } },
      ],
      boostGrantsByUser: { 5: [activeGrant("daily", 50)] },
    });
    const buckets = resolveAllSubjectModelLimits(snap, { userId: 5, tags: [], now: NOW });
    expect(userBucket(buckets)?.caps.dailyLimitUsd).toBe(60);
  });
});
