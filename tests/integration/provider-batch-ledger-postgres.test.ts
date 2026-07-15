import { and, eq, inArray, like } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type * as Schema from "@/drizzle/schema";
import type { ApplyProviderBatchOperationIfUnchangedInput } from "@/repository/provider";

type ProviderRepository = typeof import("@/repository/provider");

const TEST_DSN = process.env.PROVIDER_BATCH_TEST_DSN?.trim();
const run = describe.skipIf(!TEST_DSN);
const PREFIX = `it-provider-batch-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`;

let db: PostgresJsDatabase<typeof Schema>;
let schema: typeof Schema;
let applyProviderBatchOperationIfUnchanged: ProviderRepository["applyProviderBatchOperationIfUnchanged"];
let undoProviderBatchOperation: ProviderRepository["undoProviderBatchOperation"];
let findProviderBatchApplyOperation: ProviderRepository["findProviderBatchApplyOperation"];
let vendorId: number | null = null;
const providerIds: number[] = [];

function assertDedicatedTestDsn(dsn: string): void {
  const databaseName = decodeURIComponent(new URL(dsn).pathname.replace(/^\//, ""));
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      `PROVIDER_BATCH_TEST_DSN 必须指向数据库名包含 test 的临时数据库，当前为 ${databaseName || "<empty>"}`
    );
  }
}

function token(tag: string): string {
  return `${PREFIX}-${tag}`;
}

function fingerprint(character: string): string {
  return character.repeat(64);
}

function expectedPreimages(ids: number[], priority = 1) {
  return ids.map((providerId) => ({
    providerId,
    providerType: "codex" as const,
    values: {
      isEnabled: false,
      priority,
      weight: 100,
      groupTag: "before",
      costMultiplier: 1,
    },
  }));
}

function makeInput(input: {
  claim: string;
  preview: string;
  fingerprint: string;
  previewProviderIds: number[];
  effectiveProviderIds: number[];
  priority: number;
}): ApplyProviderBatchOperationIfUnchangedInput {
  return {
    claimKey: token(input.claim),
    previewToken: token(input.preview),
    payloadFingerprint: input.fingerprint,
    groups: [{ ids: input.effectiveProviderIds, updates: { priority: input.priority } }],
    expectedPreimages: expectedPreimages(input.previewProviderIds),
    effectiveProviderIds: input.effectiveProviderIds,
    undoPreimage: Object.fromEntries(
      input.effectiveProviderIds.map((providerId) => [providerId, { priority: 1 }])
    ),
    undoRestorable: true,
    postCommitEffects: {
      clearLimit5hCostCache: false,
      circuitBreakerChanged: false,
      nextCircuitBreakerFailureThreshold: null,
    },
    operationId: token(`${input.claim}-operation`),
    undoToken: token(`${input.claim}-undo`),
    undoTtlSeconds: 600,
  };
}

async function insertProviders(count: number): Promise<number[]> {
  const offset = providerIds.length;
  const rows = await db
    .insert(schema.providers)
    .values(
      Array.from({ length: count }, (_, index) => ({
        name: token(`provider-${offset + index}`),
        url: `https://${PREFIX}-${offset + index}.example.test/v1`,
        key: token(`key-${offset + index}`),
        providerVendorId: vendorId!,
        providerType: "codex" as const,
        isEnabled: false,
        priority: 1,
        weight: 100,
        costMultiplier: "1.0000",
        groupTag: "before",
      }))
    )
    .returning({ id: schema.providers.id });

  const ids = rows.map((row) => row.id);
  providerIds.push(...ids);
  return ids;
}

async function readProviderPriorities(ids: number[]) {
  return db
    .select({ id: schema.providers.id, priority: schema.providers.priority })
    .from(schema.providers)
    .where(inArray(schema.providers.id, ids))
    .orderBy(schema.providers.id);
}

async function cleanup(): Promise<void> {
  if (!db || !schema) return;
  await db
    .delete(schema.providerBatchApplyOperations)
    .where(like(schema.providerBatchApplyOperations.claimKey, `${PREFIX}%`));
  if (providerIds.length > 0) {
    await db.delete(schema.providers).where(inArray(schema.providers.id, providerIds));
  }
  if (vendorId !== null) {
    await db.delete(schema.providerVendors).where(eq(schema.providerVendors.id, vendorId));
  }
}

run("provider batch durable ledger (PostgreSQL)", () => {
  beforeAll(async () => {
    assertDedicatedTestDsn(TEST_DSN!);
    process.env.DSN = TEST_DSN;
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.AUTO_CLEANUP_TEST_DATA = "false";

    schema = await import("@/drizzle/schema");
    ({ db } = await import("@/drizzle/db"));
    ({
      applyProviderBatchOperationIfUnchanged,
      undoProviderBatchOperation,
      findProviderBatchApplyOperation,
    } = await import("@/repository/provider"));

    await cleanup();
    const [vendor] = await db
      .insert(schema.providerVendors)
      .values({
        websiteDomain: `${PREFIX}.example.test`,
        displayName: PREFIX,
        websiteUrl: `https://${PREFIX}.example.test`,
      })
      .returning({ id: schema.providerVendors.id });
    if (!vendor) throw new Error("failed to create provider batch integration-test vendor");
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await cleanup();
  });

  test("same claim and payload concurrently update once and replay the identical result", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "same-claim",
      preview: "same-claim-preview",
      fingerprint: fingerprint("a"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: 11,
    });

    const results = await Promise.all([
      applyProviderBatchOperationIfUnchanged(input),
      applyProviderBatchOperationIfUnchanged(input),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["applied", "replay"]);
    expect("result" in results[0] && "result" in results[1]).toBe(true);
    if (!("result" in results[0]) || !("result" in results[1])) return;
    expect(results[0].result).toEqual(results[1].result);
    expect(results[0].result.applyResult.updatedCount).toBe(1);
    expect(await readProviderPriorities([providerId])).toEqual([{ id: providerId, priority: 11 }]);

    const ledgerRows = await db
      .select({ status: schema.providerBatchApplyOperations.status })
      .from(schema.providerBatchApplyOperations)
      .where(eq(schema.providerBatchApplyOperations.claimKey, input.claimKey));
    expect(ledgerRows).toEqual([{ status: "applied" }]);
  });

  test("same preview with different claims and mutually exclusive effective IDs is consumed once", async () => {
    const ids = await insertProviders(2);
    const first = makeInput({
      claim: "preview-race-a",
      preview: "shared-preview",
      fingerprint: fingerprint("b"),
      previewProviderIds: ids,
      effectiveProviderIds: [ids[0]],
      priority: 21,
    });
    const second = makeInput({
      claim: "preview-race-b",
      preview: "shared-preview",
      fingerprint: fingerprint("c"),
      previewProviderIds: ids,
      effectiveProviderIds: [ids[1]],
      priority: 22,
    });

    const results = await Promise.all([
      applyProviderBatchOperationIfUnchanged(first),
      applyProviderBatchOperationIfUnchanged(second),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["applied", "preview_consumed"]);
    const priorities = await readProviderPriorities(ids);
    const changed = priorities.filter((row) => row.priority !== 1);
    expect(changed).toHaveLength(1);
    expect(
      (changed[0]?.id === ids[0] && changed[0]?.priority === 21) ||
        (changed[0]?.id === ids[1] && changed[0]?.priority === 22)
    ).toBe(true);

    const ledgerRows = await db
      .select({ claimKey: schema.providerBatchApplyOperations.claimKey })
      .from(schema.providerBatchApplyOperations)
      .where(eq(schema.providerBatchApplyOperations.previewToken, first.previewToken));
    expect(ledgerRows).toHaveLength(1);
  });

  test("preimage drift rolls back the applying claim", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "stale-claim",
      preview: "stale-preview",
      fingerprint: fingerprint("d"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: 31,
    });
    input.expectedPreimages[0]!.values.priority = 999;

    await expect(applyProviderBatchOperationIfUnchanged(input)).resolves.toEqual({
      status: "stale",
    });
    expect(await readProviderPriorities([providerId])).toEqual([{ id: providerId, priority: 1 }]);

    const rows = await db
      .select({ status: schema.providerBatchApplyOperations.status })
      .from(schema.providerBatchApplyOperations)
      .where(
        and(
          eq(schema.providerBatchApplyOperations.claimKey, input.claimKey),
          eq(schema.providerBatchApplyOperations.previewToken, input.previewToken)
        )
      );
    expect(rows).toEqual([]);
  });

  test("database update failure rolls back the applying claim", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "error-claim",
      preview: "error-preview",
      fingerprint: fingerprint("e"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: Number.NaN,
    });

    await expect(applyProviderBatchOperationIfUnchanged(input)).rejects.toThrow();
    expect(await readProviderPriorities([providerId])).toEqual([{ id: providerId, priority: 1 }]);

    const rows = await db
      .select({ status: schema.providerBatchApplyOperations.status })
      .from(schema.providerBatchApplyOperations)
      .where(eq(schema.providerBatchApplyOperations.claimKey, input.claimKey));
    expect(rows).toEqual([]);
  });

  test("find replays the committed durable result", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "find-replay",
      preview: "find-replay-preview",
      fingerprint: fingerprint("f"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: 41,
    });

    const applied = await applyProviderBatchOperationIfUnchanged(input);
    expect(applied.status).toBe("applied");
    if (!("result" in applied)) return;

    const replay = await findProviderBatchApplyOperation({
      claimKey: input.claimKey,
      previewToken: input.previewToken,
      payloadFingerprint: input.payloadFingerprint,
    });
    expect(replay).toEqual({ status: "replay", result: applied.result, undoAvailable: true });
  });

  test("atomic undo restores providers and prevents durable replay from reviving the token", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "undo-consumed",
      preview: "undo-consumed-preview",
      fingerprint: fingerprint("1"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: 51,
    });

    const applied = await applyProviderBatchOperationIfUnchanged(input);
    expect(applied.status).toBe("applied");
    if (!("result" in applied)) return;

    await expect(
      undoProviderBatchOperation({
        undoToken: applied.result.applyResult.undoToken,
        operationId: applied.result.applyResult.operationId,
        groups: [{ ids: [providerId], updates: { priority: 1 } }],
        revertedAt: new Date(),
      })
    ).resolves.toEqual({ status: "reverted", revertedCount: 1 });

    const replay = await findProviderBatchApplyOperation({
      claimKey: input.claimKey,
      previewToken: input.previewToken,
      payloadFingerprint: input.payloadFingerprint,
    });
    expect(replay).toEqual({
      status: "replay",
      result: applied.result,
      undoAvailable: false,
    });
  });

  test("failed undo rolls back provider writes and leaves the token available", async () => {
    const [providerId] = await insertProviders(1);
    const input = makeInput({
      claim: "undo-rollback",
      preview: "undo-rollback-preview",
      fingerprint: fingerprint("2"),
      previewProviderIds: [providerId],
      effectiveProviderIds: [providerId],
      priority: 61,
    });

    const applied = await applyProviderBatchOperationIfUnchanged(input);
    expect(applied.status).toBe("applied");
    if (!("result" in applied)) return;

    await expect(
      undoProviderBatchOperation({
        undoToken: applied.result.applyResult.undoToken,
        operationId: applied.result.applyResult.operationId,
        groups: [
          { ids: [providerId], updates: { priority: 1 } },
          { ids: [providerId + 999_999], updates: { priority: 1 } },
        ],
        revertedAt: new Date(),
      })
    ).resolves.toEqual({ status: "mismatch" });

    const replay = await findProviderBatchApplyOperation({
      claimKey: input.claimKey,
      previewToken: input.previewToken,
      payloadFingerprint: input.payloadFingerprint,
    });
    expect(replay.status).toBe("replay");
    if (replay.status === "replay") expect(replay.undoAvailable).toBe(true);
  });
});
