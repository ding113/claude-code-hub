import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { normalizeRoutingTrace, type RoutingTraceV1 } from "@/types/routing-trace";

export type RoutingTraceAssignments = {
  routingTrace: SQL;
  updatedAt: SQL;
};

/**
 * Build an idempotent assignment that never replaces a newer routing trace.
 * RoutingTrace.updatedAt is a logical revision clock (strictly increasing for
 * every mutation), so replay order does not affect the final stored value.
 */
export function buildMonotonicRoutingTraceAssignments(
  routingTrace: RoutingTraceV1,
  columns: { routingTrace: SQL; updatedAt: SQL }
): RoutingTraceAssignments {
  const normalized = normalizeRoutingTrace(routingTrace);
  if (!normalized) {
    throw new Error("routing trace is invalid");
  }

  const serialized = JSON.stringify(normalized);
  const storedRevision = sql`
    COALESCE(
      CASE
        WHEN jsonb_typeof(${columns.routingTrace}->'updatedAt') = 'number'
        THEN (${columns.routingTrace}->>'updatedAt')::numeric
      END,
      '-Infinity'::numeric
    )
  `;
  const shouldReplace = sql`${storedRevision} < ${normalized.updatedAt}::numeric`;

  return {
    routingTrace: sql`CASE WHEN ${shouldReplace} THEN ${serialized}::jsonb ELSE ${columns.routingTrace} END`,
    updatedAt: sql`CASE WHEN ${shouldReplace} THEN NOW() ELSE ${columns.updatedAt} END`,
  };
}
