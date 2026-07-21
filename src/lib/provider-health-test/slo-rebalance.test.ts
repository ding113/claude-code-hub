import { describe, expect, it } from "vitest";
import {
  filterRebalanceChanges,
  getHealthRebalancePool,
  meetsHealthMetricsSlo,
  planHealthTestSloRebalanceAll,
  planHealthTestSloRebalanceForPool,
  type HealthRebalanceProvider,
} from "@/lib/provider-health-test/slo-rebalance";

function fullWindow(ok = true) {
  return Array.from({ length: 5 }, () => ({ ok }));
}

function p(
  partial: Partial<HealthRebalanceProvider> & { id: number }
): HealthRebalanceProvider {
  return {
    name: `p${partial.id}`,
    providerType: "claude",
    isEnabled: true,
    priority: 10,
    scheduledHealthTestEnabled: true,
    healthTestBudgetSuspendedDay: null,
    healthTestSloAutoDisabled: false,
    healthTestOnlineRate: 1,
    healthTestAvgFirstByteMs: 1000,
    healthTestRecentResults: fullWindow(true),
    ...partial,
  };
}

describe("getHealthRebalancePool", () => {
  it("groups claude auth with claude", () => {
    expect(getHealthRebalancePool("claude")).toBe("claude");
    expect(getHealthRebalancePool("claude-auth")).toBe("claude");
    expect(getHealthRebalancePool("codex")).toBe("codex");
    expect(getHealthRebalancePool("openai-compatible")).toBe("openai-compatible");
  });
});

describe("meetsHealthMetricsSlo", () => {
  it("requires full 5-sample window + 80% + ≤10s", () => {
    expect(
      meetsHealthMetricsSlo({
        healthTestOnlineRate: 0.8,
        healthTestAvgFirstByteMs: 10_000,
        healthTestRecentResults: fullWindow(true),
      })
    ).toBe(true);
    expect(
      meetsHealthMetricsSlo({
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 100,
        healthTestRecentResults: [{ ok: true }], // only 1 sample
      })
    ).toBe(false);
    expect(
      meetsHealthMetricsSlo({
        healthTestOnlineRate: 0.79,
        healthTestAvgFirstByteMs: 10_000,
        healthTestRecentResults: fullWindow(true),
      })
    ).toBe(false);
  });
});

describe("planHealthTestSloRebalanceForPool", () => {
  it("explores all when fewer than 2 qualify", () => {
    const list = [
      p({ id: 1, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 500 }),
      p({
        id: 2,
        priority: 2,
        healthTestOnlineRate: 0.5,
        healthTestAvgFirstByteMs: 100,
        scheduledHealthTestEnabled: false,
        healthTestSloAutoDisabled: true,
      }),
      p({ id: 3, priority: 3, healthTestOnlineRate: null, healthTestAvgFirstByteMs: null }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    expect(plan.mode).toBe("explore_all");
    expect(plan.keepIds).toEqual([1]);
    const d2 = plan.decisions.find((d) => d.providerId === 2);
    expect(d2?.scheduledHealthTestEnabled).toBe(true);
    expect(d2?.healthTestSloAutoDisabled).toBe(false);
    expect(d2?.reason).toBe("explore_all_on");
  });

  it("does not qualify short windows after clear — needs full window samples first", () => {
    const list = [
      p({
        id: 1,
        priority: 1,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 100,
        healthTestRecentResults: [{ ok: true }, { ok: true }], // only 2
      }),
      p({
        id: 2,
        priority: 2,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 200,
        healthTestRecentResults: fullWindow(true),
      }),
      p({
        id: 3,
        priority: 3,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 300,
        healthTestRecentResults: fullWindow(true),
      }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    // id1 is highest priority but short window → not top; top = 2,3
    expect(plan.keepIds).toEqual([2, 3]);
    expect(plan.keepIds).not.toContain(1);
  });

  it("never picks disabled providers as top1/top2 even with perfect metrics", () => {
    const list = [
      p({
        id: 1,
        isEnabled: false,
        priority: 0,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 10,
      }),
      p({ id: 2, priority: 5, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 300 }),
      p({ id: 3, priority: 6, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 400 }),
      p({ id: 4, priority: 9, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    expect(plan.mode).toBe("keep_top");
    expect(plan.keepIds).toEqual([2, 3]);
    expect(plan.keepIds).not.toContain(1);
    const d1 = plan.decisions.find((d) => d.providerId === 1);
    expect(d1?.reason).toBe("skip_disabled");
  });

  it("keeps only top1+top2 below, and all above top1", () => {
    // top1=12 (prio1,200ms), top2=11 (prio1,800ms)
    // above top1: none (prio better than 1)
    // below: 13 same prio slower, 14 prio2, 10 prio5 → all disable
    const list = [
      p({ id: 10, priority: 5, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
      p({ id: 11, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 800 }),
      p({ id: 12, priority: 1, healthTestOnlineRate: 0.9, healthTestAvgFirstByteMs: 200 }),
      p({ id: 13, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 900 }),
      p({ id: 14, priority: 2, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 50 }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    expect(plan.mode).toBe("keep_top");
    expect(plan.keepIds).toEqual([12, 11]);
    const byId = Object.fromEntries(plan.decisions.map((d) => [d.providerId, d]));
    expect(byId[12].scheduledHealthTestEnabled).toBe(true);
    expect(byId[11].scheduledHealthTestEnabled).toBe(true);
    expect(byId[13].scheduledHealthTestEnabled).toBe(false);
    expect(byId[13].reason).toBe("disable_below_top1");
    expect(byId[10].scheduledHealthTestEnabled).toBe(false);
    expect(byId[14].scheduledHealthTestEnabled).toBe(false);
  });

  it("keeps higher priority than top1 even if they miss SLO; disables everything below top1 except top2", () => {
    // top1=5 (prio5), top2=8 (prio8); prio1 offline must stay; prio9 disable
    const list = [
      p({
        id: 1,
        priority: 1,
        healthTestOnlineRate: 0.2,
        healthTestAvgFirstByteMs: 50,
        scheduledHealthTestEnabled: false,
        healthTestSloAutoDisabled: true,
      }),
      p({ id: 5, priority: 5, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 300 }),
      p({ id: 8, priority: 8, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 400 }),
      p({ id: 9, priority: 9, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
      // same tier as top1 but not top1/top2 → disable
      p({ id: 6, priority: 5, healthTestOnlineRate: 0.5, healthTestAvgFirstByteMs: 900 }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    expect(plan.keepIds).toEqual([5, 8]);
    const byId = Object.fromEntries(plan.decisions.map((d) => [d.providerId, d]));
    expect(byId[1].scheduledHealthTestEnabled).toBe(true);
    expect(byId[1].reason).toBe("keep_above_top1");
    expect(byId[9].scheduledHealthTestEnabled).toBe(false);
    expect(byId[9].reason).toBe("disable_below_top1");
    expect(byId[6].scheduledHealthTestEnabled).toBe(false);
    expect(byId[6].reason).toBe("disable_below_top1");
  });

  it("same priority as top1: only top1 and top2 stay; others at that priority disable", () => {
    const list = [
      p({ id: 1, priority: 3, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 200 }), // top1
      p({ id: 2, priority: 3, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 400 }), // top2
      p({
        id: 3,
        priority: 3,
        healthTestOnlineRate: null,
        healthTestAvgFirstByteMs: null,
        scheduledHealthTestEnabled: true,
      }),
      p({ id: 4, priority: 3, healthTestOnlineRate: 0.5, healthTestAvgFirstByteMs: 900 }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    expect(plan.keepIds).toEqual([1, 2]);
    const byId = Object.fromEntries(plan.decisions.map((d) => [d.providerId, d]));
    expect(byId[3].scheduledHealthTestEnabled).toBe(false);
    expect(byId[3].reason).toBe("disable_below_top1");
    expect(byId[4].scheduledHealthTestEnabled).toBe(false);
  });

  it("does not re-enable manual off or budget suspend", () => {
    const list = [
      p({ id: 1, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
      p({ id: 2, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 200 }),
      p({
        id: 3,
        priority: 9,
        scheduledHealthTestEnabled: false,
        healthTestSloAutoDisabled: false,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 50,
      }),
      p({
        id: 4,
        priority: 9,
        healthTestBudgetSuspendedDay: "2026-07-21",
        scheduledHealthTestEnabled: false,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 50,
      }),
    ];
    const plan = planHealthTestSloRebalanceForPool(list, 2);
    const byId = Object.fromEntries(plan.decisions.map((d) => [d.providerId, d]));
    expect(byId[3].reason).toBe("skip_manual_off");
    expect(byId[3].scheduledHealthTestEnabled).toBe(false);
    expect(byId[4].reason).toBe("skip_budget");
  });
});

describe("planHealthTestSloRebalanceAll", () => {
  it("isolates pools so codex champion does not disable claude", () => {
    const list = [
      p({
        id: 1,
        providerType: "claude",
        priority: 1,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 100,
      }),
      p({
        id: 2,
        providerType: "claude",
        priority: 2,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 100,
      }),
      p({
        id: 3,
        providerType: "claude",
        priority: 3,
        healthTestOnlineRate: 1,
        healthTestAvgFirstByteMs: 100,
      }),
      p({
        id: 10,
        providerType: "codex",
        priority: 1,
        healthTestOnlineRate: 0.5,
        healthTestAvgFirstByteMs: 100,
      }),
      p({
        id: 11,
        providerType: "codex",
        priority: 2,
        healthTestOnlineRate: null,
        healthTestAvgFirstByteMs: null,
        scheduledHealthTestEnabled: false,
        healthTestSloAutoDisabled: true,
      }),
    ];
    const all = planHealthTestSloRebalanceAll(list, 2);
    const claude = all.find((r) => r.pool === "claude")!;
    const codex = all.find((r) => r.pool === "codex")!;
    expect(claude.mode).toBe("keep_top");
    expect(claude.keepIds).toEqual([1, 2]);
    expect(codex.mode).toBe("explore_all");
    const codex11 = codex.decisions.find((d) => d.providerId === 11)!;
    expect(codex11.scheduledHealthTestEnabled).toBe(true);
  });
});

describe("filterRebalanceChanges", () => {
  it("only returns rows that need DB updates", () => {
    const plan = planHealthTestSloRebalanceForPool(
      [
        p({ id: 1, priority: 1, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
        p({ id: 2, priority: 2, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
        p({ id: 3, priority: 3, healthTestOnlineRate: 1, healthTestAvgFirstByteMs: 100 }),
      ],
      2
    );
    const changes = filterRebalanceChanges(
      [
        p({ id: 1, priority: 1 }),
        p({ id: 2, priority: 2 }),
        p({ id: 3, priority: 3, scheduledHealthTestEnabled: true, healthTestSloAutoDisabled: false }),
      ],
      plan.decisions
    );
    expect(changes.some((c) => c.providerId === 3 && c.scheduledHealthTestEnabled === false)).toBe(
      true
    );
    expect(changes.some((c) => c.providerId === 1)).toBe(false);
  });
});
