import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/drizzle/db";
import {
  availBucket1m,
  outboxEvents,
  projAppliedRequests,
  projectionMeta,
} from "@/lib/availability/projection-tables";

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

const run = describe.skipIf(!process.env.DSN);

// Ids far outside the range used by real traffic and other integration tests.
const BASE = 950_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 10;
const PROVIDER_ID = 960_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000);
const trackedRequestIds: number[] = [];

function requestId(offset: number): number {
  const id = BASE + offset;
  trackedRequestIds.push(id);
  return id;
}

async function insertOutboxEvent(input: {
  requestId: number;
  occurredAt: string;
  outcome?: string;
  createdAt?: string;
  publishedAt?: string | null;
}): Promise<number> {
  const rows = (await db.execute(sql`
    INSERT INTO outbox_events (
      event_type, aggregate_type, aggregate_id, occurred_at, payload, created_at, published_at
    ) VALUES (
      'request_finalized',
      'message_request',
      ${input.requestId},
      ${input.occurredAt}::timestamptz,
      jsonb_build_object(
        'request_id', ${input.requestId}::bigint,
        'provider_id', ${PROVIDER_ID}::int,
        'outcome', ${input.outcome ?? "success"}::text,
        'occurred_at', ${input.occurredAt}::text,
        'duration_ms', 100
      ),
      COALESCE(${input.createdAt ?? null}::timestamptz, now()),
      ${input.publishedAt ?? null}::timestamptz
    )
    RETURNING id
  `)) as unknown as Array<{ id: number | string }>;
  return Number(rows[0]?.id);
}

async function cleanup(): Promise<void> {
  if (trackedRequestIds.length === 0) return;
  await db.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, trackedRequestIds));
  await db
    .delete(projAppliedRequests)
    .where(inArray(projAppliedRequests.requestId, trackedRequestIds));
  await db.execute(sql`DELETE FROM avail_bucket_1m WHERE provider_id = ${PROVIDER_ID}`);
  await db.execute(sql`DELETE FROM avail_current WHERE provider_id = ${PROVIDER_ID}`);
}

async function drainOutbox(): Promise<void> {
  const { processBatch } = await import("@/lib/availability/projection-worker");
  for (let i = 0; i < 50; i++) {
    const remaining = (await db.execute(
      sql`SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL`
    )) as unknown as Array<{ n: number }>;
    if (Number(remaining[0]?.n ?? 0) === 0) return;
    await processBatch();
  }
}

run("availability projection on PostgreSQL", () => {
  beforeAll(async () => {
    // Other suites leave unpublished events behind; drain them so our assertions are isolated.
    await drainOutbox();
  });

  afterAll(async () => {
    await cleanup();
  });

  test("multi-row applied insert counts each request once across batches", async () => {
    const occurredAt = "2026-04-13T08:03:12.000Z";
    const first = requestId(1);
    const second = requestId(2);

    await insertOutboxEvent({ requestId: first, occurredAt });
    await insertOutboxEvent({ requestId: first, occurredAt });
    await insertOutboxEvent({ requestId: second, occurredAt, outcome: "failure" });
    await drainOutbox();

    // A late duplicate in a later batch must not be counted again.
    await insertOutboxEvent({ requestId: second, occurredAt, outcome: "failure" });
    await drainOutbox();

    const buckets = await db
      .select({
        successCnt: availBucket1m.successCnt,
        failureCnt: availBucket1m.failureCnt,
        latencyCnt: availBucket1m.latencyCnt,
      })
      .from(availBucket1m)
      .where(sql`${availBucket1m.providerId} = ${PROVIDER_ID}`);
    expect(buckets).toEqual([{ successCnt: 1, failureCnt: 1, latencyCnt: 2 }]);

    const applied = await db
      .select({ requestId: projAppliedRequests.requestId })
      .from(projAppliedRequests)
      .where(inArray(projAppliedRequests.requestId, [first, second]));
    expect(applied.map((row) => Number(row.requestId)).sort()).toEqual([first, second]);

    const unpublished = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        sql`${outboxEvents.aggregateId} IN (${first}, ${second}) AND ${outboxEvents.publishedAt} IS NULL`
      );
    expect(unpublished).toHaveLength(0);
  });

  test("retention removes only expired published outbox rows and expired applied rows", async () => {
    const { runProjectionRetention } = await import("@/lib/availability/projection-retention");
    // Run retention "10 days from now" so rows inserted now are expired, while rows stamped
    // 9 days ahead are still inside the window. Ids keep growing with insertion time, as in
    // production.
    const dayMs = 24 * 60 * 60 * 1000;
    const nowIso = new Date().toISOString();
    const futureIso = new Date(Date.now() + 9 * dayMs).toISOString();
    const retentionNow = new Date(Date.now() + 10 * dayMs);

    const oldPublished = await insertOutboxEvent({
      requestId: requestId(10),
      occurredAt: nowIso,
      createdAt: nowIso,
      publishedAt: nowIso,
    });
    const oldUnpublished = await insertOutboxEvent({
      requestId: requestId(11),
      occurredAt: nowIso,
      createdAt: nowIso,
      publishedAt: null,
    });
    const recentPublished = await insertOutboxEvent({
      requestId: requestId(12),
      occurredAt: futureIso,
      createdAt: futureIso,
      publishedAt: futureIso,
    });

    const oldApplied = requestId(20);
    const recentApplied = requestId(21);
    await db.execute(sql`
      INSERT INTO proj_applied_requests (request_id, event_id, applied_at) VALUES
        (${oldApplied}, gen_random_uuid(), now()),
        (${recentApplied}, gen_random_uuid(), ${futureIso}::timestamptz)
    `);

    const result = await runProjectionRetention(retentionNow);
    expect(result).not.toBeNull();
    expect(result?.outboxDeleted).toBeGreaterThanOrEqual(1);
    expect(result?.appliedDeleted).toBeGreaterThanOrEqual(1);

    const remainingOutbox = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(inArray(outboxEvents.id, [oldPublished, oldUnpublished, recentPublished]));
    expect(remainingOutbox.map((row) => Number(row.id)).sort((a, b) => a - b)).toEqual(
      [oldUnpublished, recentPublished].sort((a, b) => a - b)
    );

    const remainingApplied = await db
      .select({ requestId: projAppliedRequests.requestId })
      .from(projAppliedRequests)
      .where(inArray(projAppliedRequests.requestId, [oldApplied, recentApplied]));
    expect(remainingApplied.map((row) => Number(row.requestId))).toEqual([recentApplied]);

    const meta = await db
      .select({ value: projectionMeta.value })
      .from(projectionMeta)
      .where(sql`${projectionMeta.key} = 'applied_retention_cutoff'`);
    expect(meta[0]?.value).toMatchObject({ cutoff: expect.any(String) });

    // A second run with nothing expired deletes nothing and stays cheap.
    const second = await runProjectionRetention(retentionNow);
    expect(second).toEqual({ outboxDeleted: 0, appliedDeleted: 0 });

    await db.execute(sql`DELETE FROM projection_meta WHERE key = 'applied_retention_cutoff'`);
    await drainOutbox();
  });
});
