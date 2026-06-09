import { afterAll, describe, expect, test } from "vitest";
import {
  addModelGroupMember,
  billUntilFlag,
  cleanupLedger,
  closeSql,
  createKey,
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
  maxLedgerId,
  pollUntil,
  proxy,
  REAL_MODEL,
  redisStartAndWait,
  redisStop,
  RUN_ID,
  seedLedger,
} from "./_helpers/grl-harness";

/**
 * End-to-end walkthrough of the "用户组 × 模型组 限额" scenarios A–F from
 * docs/limit/group-rate-limit-review.html §5, driven against a running server.
 *
 * Observables (see the harness header for transports):
 *   - complete split (A) / asymmetric axis (B): the split DECISION is observed
 *     through the *mainline* global gate — seed counted=true usage to exhaust it,
 *     then a grouped request must BYPASS it (the model-group limit took over the
 *     axis) while a non-grouped / unconfigured-axis request is still blocked.
 *     Deterministic, sub-second, zero upstream cost.
 *   - per-capita (C) / boost-F1 (D) / laziness (E): the model bucket re-seeds its
 *     usage from a pre-seeded usage_ledger so the guard rejects (or not) *before*
 *     upstream forward. Deterministic, zero upstream cost.
 *   - the literal counted_in_*_global column: a separate best-effort test against a
 *     real priced upstream (skips when the live provider is down / bills $0).
 *
 * Synthetic group-member models (`<RUN_ID>-*`) have no provider, so a request that
 * the guard lets through fails forward with `no_available_providers` — which the
 * harness classifies as `passed_upstream_unavailable` (i.e. NOT blocked by a limit).
 */

const TEST_TIMEOUT = 180_000;
const run = HARNESS_READY ? describe : describe.skip;

// Accumulated for a single sweeping teardown.
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
  // Safety: if the fail-open test aborted mid-outage, make sure Redis is back.
  if (await dockerAvailable()) {
    await redisStartAndWait();
  }
  await teardown.run();
  // Synthetic models are run-unique → safe to delete by model. Test users' rows
  // are removed by user_id. We never delete by the shared real model name, which
  // would wipe unrelated production usage.
  await cleanupLedger(touchedUserIds, touchedModels);
  await hardPurgeUsers(touchedUserIds);
  await closeSql();
}, 60_000);

run("group-rate-limit scenarios (live, A–F)", () => {
  // -------------------------------------------------------------------------
  // A — Complete split: grouped traffic is DECOUPLED from the user's mainline
  //     global budget. With the user global gate exhausted, a non-grouped model
  //     is blocked, but a grouped model (governed by its own model-group limit)
  //     bypasses the gate entirely — proving the spend is split out, not merely
  //     "also checked against global".
  // -------------------------------------------------------------------------
  test(
    "A: complete split — grouped traffic bypasses the exhausted user global gate",
    async () => {
      const groupId = await createModelGroup(`${RUN_ID}-A`, teardown);
      const grouped = syntheticModel("A-grouped");
      const plain = syntheticModel("A-plain"); // never added to any group
      await addModelGroupMember(groupId, grouped);

      // Low mainline user global; generous model-group limit so the bucket never blocks.
      const user = await createUser(`${RUN_ID}-A`, { dailyQuota: 5 }, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 100 }, teardown);

      // Exhaust the mainline user global ($10 counted toward user global > $5 quota).
      await seedLedger({
        userId: user.id,
        key: user.key,
        model: syntheticModel("A-seed"),
        costUsd: 10,
        countedUser: true,
      });

      // Wait for the mainline daily lease to re-seed and start blocking non-grouped traffic.
      const plainOut = await pollUntil(
        () => proxy(plain, user.key),
        (o) => o.kind === "limit_block",
        { label: "A mainline user-global active", tries: 30, delayMs: 1500 }
      );
      expect(plainOut.kind).toBe("limit_block");
      expect(plainOut.message).toMatch(/5\.0000/); // $5 user quota surfaced

      // The grouped model bypasses that exhausted gate (user axis taken over by the
      // model-group limit) → NOT blocked (passes to forward → no_available_providers).
      const groupedOut = await proxy(grouped, user.key);
      expect(groupedOut.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // B — Asymmetric axis: with only the user axis configured, the KEY axis is NOT
  //     split — it still honors the mainline key gate. Configuring the key axis
  //     too then splits it (the block clears). Proves D9/O4: an unconfigured axis
  //     keeps its mainline cost guard.
  // -------------------------------------------------------------------------
  test(
    "B: asymmetric axis — unconfigured key axis keeps its mainline gate",
    async () => {
      const groupId = await createModelGroup(`${RUN_ID}-B`, teardown);
      const grouped = syntheticModel("B-grouped");
      await addModelGroupMember(groupId, grouped);

      const user = await createUser(`${RUN_ID}-B`, { dailyQuota: null }, teardown);
      trackUser(user.id);
      const key = await createKey(user.id, "B-key", { limitDailyUsd: 5 }, teardown);
      // Only the USER axis is configured for the group.
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 100 }, teardown);

      // Exhaust the mainline KEY global ($10 counted toward key global > $5 key limit).
      await seedLedger({
        userId: user.id,
        key: key.key,
        model: syntheticModel("B-seed"),
        costUsd: 10,
        countedKey: true,
      });

      // User axis is bypassed, but the key axis is NOT → the mainline key gate blocks.
      const blocked = await pollUntil(
        () => proxy(grouped, key.key),
        (o) => o.kind === "limit_block",
        { label: "B key gate still applies", tries: 30, delayMs: 1500 }
      );
      expect(blocked.kind).toBe("limit_block");

      // Now configure the key axis too → key axis is split → mainline key gate skipped.
      await createModelLimit("key", key.id, groupId, { dailyLimitUsd: 100 }, teardown);
      const cleared = await pollUntil(
        () => proxy(grouped, key.key),
        (o) => o.kind !== "limit_block",
        { label: "B key axis split clears the gate", tries: 30, delayMs: 1500 }
      );
      expect(cleared.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // C — Per-capita (D5): a user_group daily limit is a per-member cap, not a
  //     shared pool. One member exhausts their own bucket; another member with
  //     no usage is unaffected.
  // -------------------------------------------------------------------------
  test(
    "C: user-group limit is a per-capita cap (independent buckets)",
    async () => {
      const model = syntheticModel("C");
      const groupId = await createModelGroup(`${RUN_ID}-C`, teardown);
      await addModelGroupMember(groupId, model);
      const tag = `${RUN_ID}-team-c`;
      const ugId = await createUserGroup(tag, teardown);
      await createModelLimit("user_group", ugId, groupId, { dailyLimitUsd: 5 }, teardown);

      const userA = await createUser(`${RUN_ID}-C-A`, { tags: [tag], dailyQuota: null }, teardown);
      const userB = await createUser(`${RUN_ID}-C-B`, { tags: [tag], dailyQuota: null }, teardown);
      trackUser(userA.id);
      trackUser(userB.id);

      // A has already spent $10 (> $5) on the group model; B has spent nothing.
      await seedLedger({ userId: userA.id, key: userA.key, model, costUsd: 10 });

      // Wait until the snapshot resolves the user_group limit for A (A blocks).
      const aOut = await pollUntil(
        () => proxy(model, userA.key),
        (o) => o.kind === "limit_block",
        { label: "C user A blocked", tries: 30 }
      );
      expect(aOut.kind).toBe("limit_block");
      expect(aOut.message).toMatch(/5\.0000/); // limit $5 surfaced in the message

      // Cache is now warm; B (own bucket = $0) must NOT be blocked — proves the
      // $5 cap is per-member, not a shared $5 pool.
      const bOut = await proxy(model, userB.key);
      expect(bOut.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // D — Boost F1: a user whose only source is a user_group limit can still be
  //     boosted (synthetic virtual personal source). The boost raises the
  //     effective cap above the pre-seeded usage, flipping block → pass.
  // -------------------------------------------------------------------------
  test(
    "D: quota boost applies via a synthetic personal source (F1)",
    async () => {
      const model = syntheticModel("D");
      const groupId = await createModelGroup(`${RUN_ID}-D`, teardown);
      await addModelGroupMember(groupId, model);
      const tag = `${RUN_ID}-team-d`;
      const ugId = await createUserGroup(tag, teardown);
      await createModelLimit("user_group", ugId, groupId, { dailyLimitUsd: 5 }, teardown);

      const user = await createUser(
        `${RUN_ID}-D-user`,
        { tags: [tag], dailyQuota: null },
        teardown
      );
      trackUser(user.id);
      // $7 spent: above the $5 group cap, below the $5 + $10 boosted cap.
      await seedLedger({ userId: user.id, key: user.key, model, costUsd: 7 });

      // Phase 1: only the user_group limit applies → blocked at $5.
      const blocked = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block",
        { label: "D blocked at group cap", tries: 30 }
      );
      expect(blocked.kind).toBe("limit_block");

      // Phase 2: grant a +$10 daily boost (valid now). F1 synthesises a personal
      // source from groupMax → effective cap = max(5, 5 + 10) = $15 > $7.
      const now = new Date();
      await createQuotaBoost(
        {
          userId: user.id,
          modelGroupId: groupId,
          window: "daily",
          amountUsd: 10,
          validFrom: isoOffset(new Date(now.getTime() - 60_000)),
          validTo: isoOffset(new Date(now.getTime() + 24 * 3600_000)),
        },
        teardown
      );

      // Quota-boost writes do NOT invalidate the resolver snapshot (only the
      // limit CRUD does), so the grant propagates via the snapshot TTL (~30s).
      // Poll comfortably past it.
      const passed = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind !== "limit_block",
        { label: "D pass after boost", tries: 30, delayMs: 2000 }
      );
      expect(passed.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // E — Boost laziness: a boost for a user with NO source in the group must not
  //     conjure a limit out of thin air. A control user with a real limit blocks
  //     (proves the snapshot is warm); the boost-only user is never blocked.
  // -------------------------------------------------------------------------
  test(
    "E: a boost without a source is a no-op (laziness boundary)",
    async () => {
      const model = syntheticModel("E");
      const groupId = await createModelGroup(`${RUN_ID}-E`, teardown);
      await addModelGroupMember(groupId, model);

      // Control: has a real (user, group) limit → must block.
      const control = await createUser(`${RUN_ID}-E-ctrl`, { dailyQuota: null }, teardown);
      trackUser(control.id);
      await createModelLimit("user", control.id, groupId, { dailyLimitUsd: 5 }, teardown);
      await seedLedger({ userId: control.id, key: control.key, model, costUsd: 10 });

      // Lazy: NO limit row, not in any limited user_group, but granted a boost.
      const lazy = await createUser(`${RUN_ID}-E-lazy`, { dailyQuota: null }, teardown);
      trackUser(lazy.id);
      await seedLedger({ userId: lazy.id, key: lazy.key, model, costUsd: 999 });
      const now = new Date();
      await createQuotaBoost(
        {
          userId: lazy.id,
          modelGroupId: groupId,
          window: "daily",
          amountUsd: 50,
          validFrom: isoOffset(new Date(now.getTime() - 60_000)),
          validTo: isoOffset(new Date(now.getTime() + 24 * 3600_000)),
        },
        teardown
      );

      // Snapshot warm once the control blocks.
      const ctrlOut = await pollUntil(
        () => proxy(model, control.key),
        (o) => o.kind === "limit_block",
        { label: "E control blocked", tries: 30 }
      );
      expect(ctrlOut.kind).toBe("limit_block");

      // Lazy user has $999 spent but NO limit/source → boost is lazy → no model
      // bucket → never blocked by the model limit (falls back to mainline).
      const lazyOut = await proxy(model, lazy.key);
      expect(lazyOut.kind).not.toBe("limit_block");
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // Ledger marking (literal column): a billed grouped request must write
  //     counted_in_user_global=false (split) and counted_in_key_global=true
  //     (no key limit). The response handler only writes the flags when cost>0,
  //     so we send a real, larger request (forces priced output tokens). It only
  //     SKIPS if the live upstream is entirely unavailable / never bills (rare).
  // -------------------------------------------------------------------------
  test(
    "Ledger marking: a billed grouped request writes counted_in_user_global=false",
    async (ctx) => {
      const groupId = await createModelGroup(`${RUN_ID}-mark`, teardown);
      await addModelGroupMember(groupId, REAL_MODEL);
      const user = await createUser(`${RUN_ID}-mark`, { dailyQuota: null }, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 100 }, teardown);

      const base = await maxLedgerId(user.id, REAL_MODEL);
      const res = await billUntilFlag({
        userId: user.id,
        key: user.key,
        model: REAL_MODEL,
        afterId: base,
        // cost>0 is what triggers the flag write; a larger prompt/output forces it.
        predicate: (r) => Number(r.cost_usd) > 0,
        tries: 6,
        reqTimeoutMs: 25_000,
        maxMs: 70_000,
        maxTokens: 200,
        prompt: "Write two sentences about the ocean.",
      });
      if (!res.anySuccess || !res.row || Number(res.row.cost_usd) === 0) {
        // Live upstream entirely unavailable / never billed — cannot observe the write.
        ctx.skip();
        return;
      }
      expect(res.row.counted_in_user_global).toBe(false); // grouped spend split out
      expect(res.row.counted_in_key_global).toBe(true); // no key limit → still global
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // F — Redis outage: a model-limit rejection must NOT be silently dropped. The
  //     bucket is DB-authoritative — with Redis down (`docker stop`, socket
  //     closed), the lease re-seeds from usage_ledger and an over-budget request
  //     stays blocked (fail-CLOSED), so a Redis blip cannot become an accidental
  //     bypass / double pass-through. (The pure fail-open branch — a transient
  //     lease op-error → allow without setting bypass — is an internal race
  //     covered by unit tests; see the report for the nuance.)
  // -------------------------------------------------------------------------
  test(
    "F: a Redis outage does not silently drop the model limit (DB-authoritative)",
    async (ctx) => {
      if (!(await dockerAvailable())) {
        ctx.skip(); // cannot control the Redis container from here
        return;
      }
      const model = syntheticModel("F");
      const groupId = await createModelGroup(`${RUN_ID}-F`, teardown);
      await addModelGroupMember(groupId, model);
      const user = await createUser(`${RUN_ID}-F`, { dailyQuota: null }, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 1 }, teardown);
      await seedLedger({ userId: user.id, key: user.key, model, costUsd: 5 });

      // Redis up: the model limit blocks the over-budget request.
      const up = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block",
        { label: "F blocked (redis up)", tries: 30 }
      );
      expect(up.kind).toBe("limit_block");

      // Redis outage: enforcement must survive via the DB-authoritative lease.
      await redisStop();
      try {
        const down = await proxy(model, user.key, { timeoutMs: 15_000 });
        expect(down.kind).toBe("limit_block"); // still blocked from DB, not bypassed
      } finally {
        await redisStartAndWait();
      }
    },
    TEST_TIMEOUT
  );

  // -------------------------------------------------------------------------
  // Regression — a model-group cost-limit rejection must carry a rate-limit HTTP
  //     status (402 Payment Required for cost limits, per error-handler.ts:166),
  //     NOT 500 internal_server_error. Guards the cross-module `isRateLimitError`
  //     fix (errors.ts): the guard is spliced in via the globalThis registry, so
  //     classification must not rely on a bare `instanceof`.
  // -------------------------------------------------------------------------
  test(
    "model limit rejection uses a rate-limit status (402/429), not 500",
    async () => {
      const model = syntheticModel("SC");
      const groupId = await createModelGroup(`${RUN_ID}-SC`, teardown);
      await addModelGroupMember(groupId, model);
      const user = await createUser(`${RUN_ID}-SC-user`, { dailyQuota: null }, teardown);
      trackUser(user.id);
      await createModelLimit("user", user.id, groupId, { dailyLimitUsd: 1 }, teardown);
      await seedLedger({ userId: user.id, key: user.key, model, costUsd: 5 });

      const blocked = await pollUntil(
        () => proxy(model, user.key),
        (o) => o.kind === "limit_block",
        { label: "limit rejection", tries: 30 }
      );
      // The limit is enforced with the correct quota message...
      expect(blocked.message).toMatch(/额度超限|exceeded|quota/i);
      // ...and a proper rate-limit HTTP status, not a generic 500.
      expect([402, 429]).toContain(blocked.status);
      expect(blocked.code).not.toMatch(/internal_server_error/);
    },
    TEST_TIMEOUT
  );
});
