import { afterAll, describe, expect, test } from "vitest";
import {
  addModelGroupMember,
  cleanupLedger,
  closeSql,
  createModelGroup,
  createModelLimit,
  createQuotaBoost,
  createTeardown,
  createUser,
  createUserGroup,
  dockerAvailable,
  hardPurgeUsers,
  HARNESS_READY,
  isoOffset,
  pollUntil,
  proxy,
  redisStartAndWait,
  RUN_ID,
  seedLedger,
} from "./_helpers/grl-harness";

/**
 * End-to-end walkthrough of the supplementary scenarios G–K from
 * docs/limit/group-rate-limit-review.html §5.1, driven against a running server.
 * These complete the §5 A–F suite by exercising invariants the prose stresses
 * but that A–F never narrated as a live case.
 *
 * Every assertion is deterministic and costs zero real upstream spend: the model
 * bucket / mainline gate re-seeds usage from a pre-seeded usage_ledger, so the
 * guard's accept/reject decision happens BEFORE any provider is contacted. The
 * grouped models are run-unique synthetics (`<RUN_ID>-*`) with no provider, so a
 * request the guard lets through fails forward with `no_available_providers`,
 * which the harness classifies as `passed_upstream_unavailable` (NOT a limit block).
 *
 * The block messages carry the *effective* (post-resolution) cap via `.toFixed(4)`
 * (model-rate-limit-guard.ts), so G and H read the resolved number straight out of
 * the rejection text — e.g. "$30.0000" proves the daily cap resolved to 30.
 */

const TEST_TIMEOUT = 180_000;
const run = HARNESS_READY ? describe : describe.skip;

const teardown = createTeardown();
const touchedUserIds: number[] = [];
const touchedModels: string[] = [];

function trackUser(id: number) {
  touchedUserIds.push(id);
}
function syntheticModel(suffix: string): string {
  const m = `${RUN_ID}-${suffix}`;
  touchedModels.push(m);
  return m;
}

afterAll(async () => {
  if (await dockerAvailable()) {
    await redisStartAndWait();
  }
  await teardown.run();
  await cleanupLedger(touchedUserIds, touchedModels);
  await hardPurgeUsers(touchedUserIds);
  await closeSql();
}, 60_000);

run("group-rate-limit supplementary scenarios (live, G–K)", () => {
  // -------------------------------------------------------------------------
  // G — Per-window cross-source MAX (D4): caps[w] = MAX over sources is computed
  //     INDEPENDENTLY per window, not "whichever whole source is higher wins".
  //     With the same dual-source config (personal daily $10/weekly $100,
  //     user-group daily $30/weekly $50):
  //       - daily  effective = max(10, 30) = $30  → user-group wins
  //       - weekly effective = max(100, 50) = $100 → personal wins
  //     We pin each window's effective cap by reading it out of the block message.
  // -------------------------------------------------------------------------
  test(
    "G: per-window cross-source max — daily wins from the group, weekly from the individual",
    async () => {
      const model = syntheticModel("G");
      const groupId = await createModelGroup(`${RUN_ID}-G`, teardown);
      await addModelGroupMember(groupId, model);
      const tag = `${RUN_ID}-team-g`;
      const ugId = await createUserGroup(tag, teardown);
      // user-group source: daily $30 (higher), weekly $50 (lower).
      await createModelLimit(
        "user_group",
        ugId,
        groupId,
        { dailyLimitUsd: 30, limitWeeklyUsd: 50 },
        teardown
      );

      // --- daily window: group's $30 must win over the personal $10 ---
      const uDaily = await createUser(`${RUN_ID}-G-daily`, { tags: [tag] }, teardown);
      trackUser(uDaily.id);
      // personal source: daily $10 (lower), weekly $100 (higher).
      await createModelLimit(
        "user",
        uDaily.id,
        groupId,
        { dailyLimitUsd: 10, limitWeeklyUsd: 100 },
        teardown
      );
      // $35 spent TODAY: above max(10,30)=$30 daily, below max(100,50)=$100 weekly.
      await seedLedger({ userId: uDaily.id, key: uDaily.key, model, costUsd: 35 });

      // Poll on the RESOLVED cap, not merely "blocked": $35 exceeds both the
      // personal $10 and the merged $30, so a stale (personal-not-yet-loaded)
      // snapshot would also block — at $10 — and a naive "any block" poll could
      // stop there. We wait until the merged $30 surfaces.
      const dailyBlock = await pollUntil(
        () => proxy(model, uDaily.key),
        (o) => o.kind === "limit_block" && /30\.0000/.test(o.message),
        { label: "G daily merged cap $30", tries: 30, delayMs: 1500 }
      );
      // Effective daily cap surfaced as the group's $30 — NOT the personal $10.
      expect(dailyBlock.message).toMatch(/30\.0000/);
      expect(dailyBlock.message).not.toMatch(/10\.0000/);
      expect(dailyBlock.status).toBe(402);

      // --- weekly window: personal's $100 must win over the group's $50 ---
      const uWeekly = await createUser(`${RUN_ID}-G-weekly`, { tags: [tag] }, teardown);
      trackUser(uWeekly.id);
      await createModelLimit(
        "user",
        uWeekly.id,
        groupId,
        { dailyLimitUsd: 10, limitWeeklyUsd: 100 },
        teardown
      );
      // $120 spent ~30h ago: inside this week's window (Mon 00:00→now, system TZ
      // Asia/Shanghai) but BEFORE today's fixed daily reset, so today's daily
      // usage is $0 while the weekly bucket sees $120. (Assumes the run day is not
      // within ~30h of the week start; today 2026-05-27 is Wednesday → safe.)
      await seedLedger({
        userId: uWeekly.id,
        key: uWeekly.key,
        model,
        costUsd: 120,
        createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
      });

      // Wait for the merged weekly cap to settle. $120 exceeds both the group's
      // $50 and the merged $100, so a stale snapshot (personal-not-yet-loaded)
      // would block at $50; we poll until the merged $100 surfaces to prove the
      // personal source is part of the MAX, not shadowed by the user-group source.
      const weeklyBlock = await pollUntil(
        () => proxy(model, uWeekly.key),
        (o) => o.kind === "limit_block" && /100\.0000/.test(o.message),
        { label: "G weekly merged cap $100", tries: 30, delayMs: 1500 }
      );
      // Only the weekly window binds (daily usage today is $0 < $30); its effective
      // cap surfaced as the personal $100 — NOT the group's $50. If the daily
      // window had wrongly bound, the message would read "$30.0000" instead.
      expect(weeklyBlock.message).toMatch(/100\.0000/);
      expect(weeklyBlock.message).not.toMatch(/30\.0000/);
      expect(weeklyBlock.message).not.toMatch(/50\.0000/);
      expect(weeklyBlock.status).toBe(402);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // H — Boost valid_period is an in-memory `@> now` filter (F2): only the grant
  //     active at request time counts; a pre-scheduled (future) or expired grant
  //     never lifts the cap, even though all three live in the snapshot. We pin
  //     the resolved cap by reading it from the block message: it moves 30 → 80
  //     (one +$50 boost applied), never 130 / 180 (future+expired filtered out).
  // -------------------------------------------------------------------------
  test(
    "H: only the time-window-active boost lifts the cap (future/expired filtered)",
    async () => {
      const model = syntheticModel("H");
      const groupId = await createModelGroup(`${RUN_ID}-H`, teardown);
      await addModelGroupMember(groupId, model);
      const user = await createUser(`${RUN_ID}-H`, {}, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 30 }, teardown);
      // $250 spent today: above EVERY candidate cap below, so the window always
      // blocks and the message reports the live cap verbatim — no slow timeouts,
      // and the resolved number alone discriminates which boost(s) were applied.
      await seedLedger({ userId: user.id, key: user.key, model, costUsd: 250 });

      // Phase 1: base cap $30 surfaced.
      const base = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block" && /\$30\.0000/.test(o.message),
        { label: "H base cap $30", tries: 30, delayMs: 1500 }
      );
      expect(base.message).toMatch(/\$30\.0000/);

      // Phase 2: three daily boosts with DISTINCT amounts, created so the active one
      // is neither first nor last. The resolved cap then pins down *time-validity*,
      // not a positional ("first"/"last"-created) or "sum-all" heuristic:
      //   active only  → 30 + 50  = $80   (the correct, time-window-filtered result)
      //   future only  → 30 + 70  = $100  (would mean future grants wrongly count)
      //   expired only → 30 + 90  = $120  (would mean expired grants wrongly count)
      //   sum of all   → 30 + 210 = $240  (would mean no time filtering at all)
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      // future (+$70, created FIRST): starts tomorrow → valid_period @> now is false.
      await createQuotaBoost(
        {
          userId: user.id,
          modelGroupId: groupId,
          window: "daily",
          amountUsd: 70,
          validFrom: isoOffset(new Date(now + day)),
          validTo: isoOffset(new Date(now + 2 * day)),
        },
        teardown
      );
      // active (+$50, created SECOND/MIDDLE): started a minute ago, ends tomorrow.
      await createQuotaBoost(
        {
          userId: user.id,
          modelGroupId: groupId,
          window: "daily",
          amountUsd: 50,
          validFrom: isoOffset(new Date(now - 60_000)),
          validTo: isoOffset(new Date(now + day)),
        },
        teardown
      );
      // expired (+$90, created LAST): ended yesterday → valid_period @> now is false.
      await createQuotaBoost(
        {
          userId: user.id,
          modelGroupId: groupId,
          window: "daily",
          amountUsd: 90,
          validFrom: isoOffset(new Date(now - 2 * day)),
          validTo: isoOffset(new Date(now - day)),
        },
        teardown
      );

      // Boost CRUD does not invalidate the resolver snapshot (only limit CRUD does),
      // so the grant lands via the snapshot TTL (~30s). The cap moves to exactly $80.
      const boosted = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block" && /\$80\.0000/.test(o.message),
        { label: "H boosted cap $80", tries: 30, delayMs: 2000 }
      );
      expect(boosted.message).toMatch(/\$80\.0000/); // 30 + the active 50 only
      expect(boosted.message).not.toMatch(/\$100\.0000/); // not 30 + future 70
      expect(boosted.message).not.toMatch(/\$120\.0000/); // not 30 + expired 90
      expect(boosted.message).not.toMatch(/\$240\.0000/); // not 30 + all 210
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // I — Regrouping is not retroactive (R2 / write-time marking): the counted flag
  //     is frozen when the row is written. Moving a model into a group only affects
  //     subsequent rows; historical spend stays in the mainline global bucket.
  //     Read-time NOT-IN (the rejected design) would retroactively pull the old
  //     spend OUT of global the instant the model joined a group → global back to $0.
  // -------------------------------------------------------------------------
  test(
    "I: moving a model into a group does not retroactively reclassify past spend",
    async () => {
      const mNew = syntheticModel("I-new"); // starts ungrouped, joins a group mid-test
      const mProbe = syntheticModel("I-probe"); // stays ungrouped → exercises mainline global
      const user = await createUser(`${RUN_ID}-I`, { dailyQuota: 6 }, teardown);
      trackUser(user.id);
      // $6 spent on the (currently ungrouped) model, counted toward user global.
      await seedLedger({
        userId: user.id,
        key: user.key,
        model: mNew,
        costUsd: 6,
        countedUser: true,
      });

      // Phase 1: mainline user global is exhausted ($6 / $6) — a non-grouped probe blocks.
      const before = await pollUntil(
        () => proxy(mProbe, user.key),
        (o) => o.kind === "limit_block",
        { label: "I global exhausted", tries: 30, delayMs: 1500 }
      );
      expect(before.message).toMatch(/6\.0000/);

      // Phase 2: move mNew into a fresh group with a generous (user, group) limit.
      const groupId = await createModelGroup(`${RUN_ID}-I`, teardown);
      await addModelGroupMember(groupId, mNew);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 30 }, teardown);

      // mNew is now grouped: its $6 (< $30 bucket) lets the request bypass the
      // exhausted global gate → NOT blocked. Poll until the snapshot picks up the
      // new membership (otherwise we'd attribute a stale snapshot to the invariant).
      const grouped = await pollUntil(
        () => proxy(mNew, user.key),
        (o) => o.kind !== "limit_block",
        { label: "I regrouped model bypasses", tries: 30, delayMs: 1500 }
      );
      expect(grouped.kind).not.toBe("limit_block");

      // Phase 3: the historical $6 stays counted in global (write-time marking is
      // frozen) → the ungrouped probe is STILL blocked. Read-time NOT-IN would have
      // dropped global to $0 and let this through.
      const after = await proxy(mProbe, user.key);
      expect(after.kind).toBe("limit_block");
      expect(after.message).toMatch(/6\.0000/);
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // J — The model `total` bucket is NOT split (OPT-A): counted_in_*_global only
  //     filters the MAINLINE global aggregation. The model bucket is its own budget
  //     and counts ALL spend on the group's member models, including spend that was
  //     bypassed (counted_in_user_global=false). Seed $120 of bypassed spend:
  //       - the model total bucket ($100) sees it → blocks
  //       - the mainline user global does NOT see it → a non-grouped probe passes
  // -------------------------------------------------------------------------
  test(
    "J: the model total bucket counts bypassed spend; the mainline global does not",
    async () => {
      const model = syntheticModel("J"); // grouped
      const mProbe = syntheticModel("J-probe"); // ungrouped → exercises mainline global
      const groupId = await createModelGroup(`${RUN_ID}-J`, teardown);
      await addModelGroupMember(groupId, model);
      const user = await createUser(`${RUN_ID}-J`, { dailyQuota: 10 }, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { limitTotalUsd: 100 }, teardown);
      // $120 of split-out spend (counted_in_user_global=false) on the group model.
      // Seeded BEFORE the first probe so the 300s total-cost cache reads it on the
      // first (cache-miss) DB lookup rather than caching a stale $0.
      await seedLedger({
        userId: user.id,
        key: user.key,
        model,
        costUsd: 120,
        countedUser: false,
        countedKey: false,
      });

      // The model total bucket counts the bypassed $120 (>$100) → block at $100.
      const totalBlock = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block",
        { label: "J model total blocks", tries: 30, delayMs: 1500 }
      );
      expect(totalBlock.message).toMatch(/100\.0000/);
      expect(totalBlock.status).toBe(402);

      // The very same $120 is invisible to the mainline user global (counted=false),
      // so a non-grouped probe — guarded only by the $10 global — passes.
      const probe = await proxy(mProbe, user.key);
      expect(probe.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // K — RPM / concurrency are resource guards that are NEVER bypassed (D8). The
  //     bypass flag only relaxes the User-*/Key-* COST gates; a request that hits
  //     (and bypasses) a model-group cost limit still consumes RPM and is rejected
  //     once the per-minute ceiling is reached.
  //
  //     A warm-up user (no RPM cap) warms the process-global model-limit snapshot
  //     so the rpm-capped user spends its whole 5-request budget on real probes —
  //     none on warm-up. With the user's mainline global exhausted, the grouped
  //     requests still bypass cost (proving the model limit is in play), yet the
  //     6th is RPM-blocked (429).
  // -------------------------------------------------------------------------
  test(
    "K: RPM guard still fires for grouped traffic that bypasses the cost gate",
    async () => {
      const model = syntheticModel("K");
      const groupId = await createModelGroup(`${RUN_ID}-K`, teardown);
      await addModelGroupMember(groupId, model);

      // Warm-up user: no RPM cap; its global is exhausted, its grouped limit generous.
      const warm = await createUser(`${RUN_ID}-K-warm`, { dailyQuota: 1 }, teardown);
      trackUser(warm.id);
      await createModelLimit("user", warm.id, groupId, { dailyLimitUsd: 100 }, teardown);
      await seedLedger({ userId: warm.id, key: warm.key, model, costUsd: 5, countedUser: true });

      // Target user: RPM = 5, global exhausted, grouped cost limit generous.
      const rpmUser = await createUser(`${RUN_ID}-K-rpm`, { dailyQuota: 1, rpm: 5 }, teardown);
      trackUser(rpmUser.id);
      await createModelLimit("user", rpmUser.id, groupId, { dailyLimitUsd: 100 }, teardown);
      await seedLedger({
        userId: rpmUser.id,
        key: rpmUser.key,
        model,
        costUsd: 5,
        countedUser: true,
      });

      // Warm the shared snapshot on the warm-up user (single Node process, verified):
      // once a grouped request bypasses the exhausted global gate, the membership +
      // both (user, group) limits are live for the rpm user too.
      await pollUntil(
        () => proxy(model, warm.key),
        (o) => o.kind === "passed_upstream_unavailable",
        { label: "K snapshot warm (bypass active)", tries: 30, delayMs: 1500 }
      );

      // Fire exactly 6 back-to-back requests on the rpm user — its only RPM traffic.
      const outcomes: string[] = [];
      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const out = await proxy(model, rpmUser.key, { timeoutMs: 15_000 });
        outcomes.push(out.kind);
        lastStatus = out.status;
      }

      // The first 5 bypass the (exhausted) cost gate and fail forward — proving the
      // model-group limit is in play AND that cost bypass did not also waive RPM.
      const firstFive = outcomes.slice(0, 5);
      expect(firstFive.every((k) => k !== "limit_block")).toBe(true);
      expect(firstFive).toContain("passed_upstream_unavailable");

      // The 6th trips the RPM ceiling: a resource guard, blocked with HTTP 429.
      expect(outcomes[5]).toBe("limit_block");
      expect(lastStatus).toBe(429);
    },
    TEST_TIMEOUT
  );
});
