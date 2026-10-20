/**
 * Availability projection table definitions (outbox + 1m buckets).
 * Kept in sync with drizzle/0120_availability_projection.sql and re-exported from schema.ts
 * so drizzle-kit generate sees the same shape.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventId: uuid("event_id").notNull().defaultRandom(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: bigint("aggregate_id", { mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    unique("outbox_events_event_id_key").on(t.eventId),
    index("idx_outbox_events_unpublished").on(t.id.asc()).where(sql`${t.publishedAt} IS NULL`),
  ]
);

export const outboxProcessed = pgTable("outbox_processed", {
  eventId: uuid("event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projAppliedRequests = pgTable("proj_applied_requests", {
  requestId: bigint("request_id", { mode: "number" }).primaryKey(),
  eventId: uuid("event_id").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

export const availBucket1m = pgTable(
  "avail_bucket_1m",
  {
    providerId: integer("provider_id").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    successCnt: integer("success_cnt").notNull().default(0),
    failureCnt: integer("failure_cnt").notNull().default(0),
    excludedCnt: integer("excluded_cnt").notNull().default(0),
    latencyCnt: integer("latency_cnt").notNull().default(0),
    latencySumMs: bigint("latency_sum_ms", { mode: "number" }).notNull().default(0),
    lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.providerId, t.bucketStart], name: "avail_bucket_1m_pkey" }),
    index("idx_avail_bucket_1m_time").on(t.bucketStart.desc()),
  ]
);

export const availCurrent = pgTable("avail_current", {
  providerId: integer("provider_id").primaryKey(),
  state: text("state").notNull().default("unknown"),
  availability: doublePrecision("availability").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectionMeta = pgTable("projection_meta", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
