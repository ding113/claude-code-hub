import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { modelGroupMembers, modelGroups } from "@/drizzle/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelGroupRow = typeof modelGroups.$inferSelect;

export interface ModelGroupWithMembers extends ModelGroupRow {
  members: string[];
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class ModelGroupMemberConflictError extends Error {
  readonly conflictGroupId: number;
  readonly conflictGroupName: string;

  constructor(model: string, groupId: number, groupName: string) {
    super(
      `Model "${model}" already belongs to group "${groupName}" (id=${groupId}). Each model may only belong to one group.`
    );
    this.name = "ModelGroupMemberConflictError";
    this.conflictGroupId = groupId;
    this.conflictGroupName = groupName;
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

async function fetchMembers(groupIds: number[]): Promise<Map<number, string[]>> {
  if (groupIds.length === 0) return new Map();
  const rows = await db
    .select({ modelGroupId: modelGroupMembers.modelGroupId, model: modelGroupMembers.model })
    .from(modelGroupMembers)
    .where(inArray(modelGroupMembers.modelGroupId, groupIds));

  const result = new Map<number, string[]>();
  for (const row of rows) {
    const list = result.get(row.modelGroupId) ?? [];
    list.push(row.model);
    result.set(row.modelGroupId, list);
  }
  return result;
}

// ---------------------------------------------------------------------------
// CRUD — model groups
// ---------------------------------------------------------------------------

export async function createModelGroup(input: {
  name: string;
  description?: string | null;
  isSingleton?: boolean;
}): Promise<ModelGroupRow> {
  const [row] = await db
    .insert(modelGroups)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      isSingleton: input.isSingleton ?? false,
    })
    .returning();

  return row;
}

export async function updateModelGroup(
  id: number,
  input: Partial<{ name: string; description: string | null; isSingleton: boolean }>
): Promise<ModelGroupRow> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.isSingleton !== undefined) set.isSingleton = input.isSingleton;

  const [row] = await db.update(modelGroups).set(set).where(eq(modelGroups.id, id)).returning();

  if (!row) {
    throw new Error(`Model group id=${id} not found`);
  }
  return row;
}

export async function deleteModelGroup(id: number): Promise<void> {
  await db.delete(modelGroups).where(eq(modelGroups.id, id));
}

export async function listModelGroups(): Promise<ModelGroupWithMembers[]> {
  const rows = await db.select().from(modelGroups).orderBy(modelGroups.name);
  if (rows.length === 0) return [];

  const membersMap = await fetchMembers(rows.map((r) => r.id));
  return rows.map((row) => ({ ...row, members: membersMap.get(row.id) ?? [] }));
}

export async function getModelGroup(id: number): Promise<ModelGroupWithMembers | null> {
  const [row] = await db.select().from(modelGroups).where(eq(modelGroups.id, id)).limit(1);

  if (!row) return null;

  const membersMap = await fetchMembers([id]);
  return { ...row, members: membersMap.get(id) ?? [] };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function addModelGroupMember(groupId: number, model: string): Promise<void> {
  const existing = await db
    .select({
      modelGroupId: modelGroupMembers.modelGroupId,
      groupName: modelGroups.name,
    })
    .from(modelGroupMembers)
    .innerJoin(modelGroups, eq(modelGroupMembers.modelGroupId, modelGroups.id))
    .where(eq(modelGroupMembers.model, model))
    .limit(1);

  if (existing.length > 0) {
    const { modelGroupId, groupName } = existing[0];
    if (modelGroupId === groupId) return;
    throw new ModelGroupMemberConflictError(model, modelGroupId, groupName);
  }

  await db.insert(modelGroupMembers).values({ modelGroupId: groupId, model }).onConflictDoNothing();
}

export async function removeModelGroupMember(groupId: number, model: string): Promise<void> {
  await db
    .delete(modelGroupMembers)
    .where(and(eq(modelGroupMembers.modelGroupId, groupId), eq(modelGroupMembers.model, model)));
}

export async function findModelGroupIdByModel(model: string): Promise<number | null> {
  const [row] = await db
    .select({ modelGroupId: modelGroupMembers.modelGroupId })
    .from(modelGroupMembers)
    .where(eq(modelGroupMembers.model, model))
    .limit(1);

  return row?.modelGroupId ?? null;
}

export async function listModelGroupMembers(groupId: number): Promise<string[]> {
  const rows = await db
    .select({ model: modelGroupMembers.model })
    .from(modelGroupMembers)
    .where(eq(modelGroupMembers.modelGroupId, groupId));

  return rows.map((r) => r.model);
}

// ---------------------------------------------------------------------------
// Convenience: singleton group (isSingleton=true, single model)
// ---------------------------------------------------------------------------

export async function createSingletonModelGroup(
  model: string,
  name?: string
): Promise<ModelGroupRow> {
  return db.transaction(async (tx) => {
    // D6: a model may belong to exactly one group. Reject before creating an
    // empty group; onConflictDoNothing would silently drop the membership and
    // leave a phantom group behind.
    const existing = await tx
      .select({
        modelGroupId: modelGroupMembers.modelGroupId,
        groupName: modelGroups.name,
      })
      .from(modelGroupMembers)
      .innerJoin(modelGroups, eq(modelGroupMembers.modelGroupId, modelGroups.id))
      .where(eq(modelGroupMembers.model, model))
      .limit(1);

    if (existing.length > 0) {
      const { modelGroupId, groupName } = existing[0];
      throw new ModelGroupMemberConflictError(model, modelGroupId, groupName);
    }

    const groupName = name?.trim() ?? model;

    const [row] = await tx
      .insert(modelGroups)
      .values({ name: groupName, isSingleton: true })
      .returning();

    await tx.insert(modelGroupMembers).values({ modelGroupId: row.id, model });

    return row;
  });
}
