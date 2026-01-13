"use server";

import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpointProbeEvents } from "@/drizzle/schema";
import type {
  ProviderEndpointProbeEvent,
  ProviderEndpointProbeResult,
  ProviderEndpointProbeSource,
} from "@/types/provider";
import { toProviderEndpointProbeEvent } from "./_shared/transformers";

const PROBE_EVENT_SELECT = {
  id: providerEndpointProbeEvents.id,
  endpointId: providerEndpointProbeEvents.endpointId,
  source: providerEndpointProbeEvents.source,
  result: providerEndpointProbeEvents.result,
  statusCode: providerEndpointProbeEvents.statusCode,
  latencyMs: providerEndpointProbeEvents.latencyMs,
  errorType: providerEndpointProbeEvents.errorType,
  errorMessage: providerEndpointProbeEvents.errorMessage,
  checkedAt: providerEndpointProbeEvents.checkedAt,
  createdAt: providerEndpointProbeEvents.createdAt,
} as const;

export async function createProviderEndpointProbeEvent(data: {
  endpointId: number;
  source: ProviderEndpointProbeSource;
  result: ProviderEndpointProbeResult;
  statusCode?: number | null;
  latencyMs?: number | null;
  errorType?: string | null;
  errorMessage?: string | null;
  checkedAt?: Date;
}): Promise<ProviderEndpointProbeEvent> {
  const [row] = await db
    .insert(providerEndpointProbeEvents)
    .values({
      endpointId: data.endpointId,
      source: data.source,
      result: data.result,
      statusCode: data.statusCode ?? null,
      latencyMs: data.latencyMs ?? null,
      errorType: data.errorType ?? null,
      errorMessage: data.errorMessage ?? null,
      checkedAt: data.checkedAt ?? new Date(),
    })
    .returning(PROBE_EVENT_SELECT);

  return toProviderEndpointProbeEvent(row);
}

export async function deleteProviderEndpointProbeEventsOlderThan(args: {
  days: number;
  now?: Date;
}): Promise<number> {
  const now = args.now ?? new Date();
  const cutoff = new Date(now.getTime() - args.days * 24 * 60 * 60 * 1000);

  const rows = await db
    .delete(providerEndpointProbeEvents)
    .where(lt(providerEndpointProbeEvents.checkedAt, cutoff))
    .returning({ id: providerEndpointProbeEvents.id });

  return rows.length;
}

export async function findProviderEndpointProbeEvents(args: {
  endpointId: number;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}): Promise<ProviderEndpointProbeEvent[]> {
  const limit = args.limit ?? 100;

  const conditions = [eq(providerEndpointProbeEvents.endpointId, args.endpointId)];
  if (args.startTime) {
    conditions.push(gte(providerEndpointProbeEvents.checkedAt, args.startTime));
  }
  if (args.endTime) {
    conditions.push(lte(providerEndpointProbeEvents.checkedAt, args.endTime));
  }

  const rows = await db
    .select(PROBE_EVENT_SELECT)
    .from(providerEndpointProbeEvents)
    .where(and(...conditions))
    .orderBy(desc(providerEndpointProbeEvents.checkedAt))
    .limit(limit);

  return rows.map(toProviderEndpointProbeEvent);
}
