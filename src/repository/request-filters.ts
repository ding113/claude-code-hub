"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { requestFilters } from "@/drizzle/schema";
import { emitRequestFiltersUpdated } from "@/lib/emit-event";

export type RequestFilterScope = "header" | "body";
export type RequestFilterAction = "remove" | "set" | "json_path" | "text_replace";
export type RequestFilterMatchType = "regex" | "contains" | "exact" | null;

export interface RequestFilter {
  id: number;
  name: string;
  description: string | null;
  scope: RequestFilterScope;
  action: RequestFilterAction;
  matchType: RequestFilterMatchType;
  target: string;
  replacement: unknown;
  priority: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type Row = typeof requestFilters.$inferSelect;

function mapRow(row: Row): RequestFilter {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    scope: row.scope as RequestFilterScope,
    action: row.action as RequestFilterAction,
    matchType: (row.matchType as RequestFilterMatchType | null) ?? null,
    target: row.target,
    replacement: row.replacement ?? null,
    priority: row.priority,
    isEnabled: row.isEnabled,
    createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(),
  };
}

/**
 * 获取启用的请求过滤器（按优先级升序排列）
 */
export async function getActiveRequestFilters(): Promise<RequestFilter[]> {
  const rows = await db.query.requestFilters.findMany({
    where: eq(requestFilters.isEnabled, true),
    orderBy: [requestFilters.priority, requestFilters.id],
  });

  return rows.map(mapRow);
}

/**
 * 获取全部请求过滤器（包含禁用）
 */
export async function getAllRequestFilters(): Promise<RequestFilter[]> {
  const rows = await db.query.requestFilters.findMany({
    orderBy: [desc(requestFilters.createdAt)],
  });

  return rows.map(mapRow);
}

/**
 * 根据 ID 获取单个请求过滤器
 */
export async function getRequestFilterById(id: number): Promise<RequestFilter | null> {
  const row = await db.query.requestFilters.findFirst({
    where: eq(requestFilters.id, id),
  });

  return row ? mapRow(row) : null;
}

interface CreateRequestFilterInput {
  name: string;
  description?: string;
  scope: RequestFilterScope;
  action: RequestFilterAction;
  matchType?: RequestFilterMatchType;
  target: string;
  replacement?: unknown;
  priority?: number;
  isEnabled?: boolean;
}

export async function createRequestFilter(data: CreateRequestFilterInput): Promise<RequestFilter> {
  const [row] = await db
    .insert(requestFilters)
    .values({
      name: data.name,
      description: data.description,
      scope: data.scope,
      action: data.action,
      matchType: data.matchType ?? null,
      target: data.target,
      replacement: data.replacement ?? null,
      priority: data.priority ?? 0,
      isEnabled: data.isEnabled ?? true,
    })
    .returning();

  await emitRequestFiltersUpdated();
  return mapRow(row);
}

interface UpdateRequestFilterInput {
  name?: string;
  description?: string | null;
  scope?: RequestFilterScope;
  action?: RequestFilterAction;
  matchType?: RequestFilterMatchType;
  target?: string;
  replacement?: unknown;
  priority?: number;
  isEnabled?: boolean;
}

export async function updateRequestFilter(
  id: number,
  data: UpdateRequestFilterInput
): Promise<RequestFilter | null> {
  const [row] = await db
    .update(requestFilters)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(requestFilters.id, id))
    .returning();

  if (!row) {
    return null;
  }

  await emitRequestFiltersUpdated();
  return mapRow(row);
}

export async function deleteRequestFilter(id: number): Promise<boolean> {
  const rows = await db.delete(requestFilters).where(eq(requestFilters.id, id)).returning({
    id: requestFilters.id,
  });

  if (rows.length > 0) {
    await emitRequestFiltersUpdated();
    return true;
  }

  return false;
}
