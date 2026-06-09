import "server-only";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { userGroups, users } from "@/drizzle/schema";

export type UserGroupRow = typeof userGroups.$inferSelect;

type UserGroupCreateInput = {
  tag: string;
  name?: string | null;
  description?: string | null;
};

type UserGroupUpdateInput = Partial<UserGroupCreateInput>;

export async function createUserGroup(input: UserGroupCreateInput): Promise<UserGroupRow> {
  const [row] = await db
    .insert(userGroups)
    .values({
      tag: input.tag.trim(),
      name: input.name ?? null,
      description: input.description ?? null,
    })
    .returning();
  return row;
}

export async function updateUserGroup(
  id: number,
  input: UserGroupUpdateInput
): Promise<UserGroupRow> {
  const updates: Partial<typeof userGroups.$inferInsert> = {};
  if (input.tag !== undefined) updates.tag = input.tag.trim();
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  updates.updatedAt = new Date();

  const [row] = await db.update(userGroups).set(updates).where(eq(userGroups.id, id)).returning();
  return row;
}

export async function deleteUserGroup(id: number): Promise<void> {
  await db.delete(userGroups).where(eq(userGroups.id, id));
}

export async function listUserGroups(): Promise<UserGroupRow[]> {
  return db.select().from(userGroups).orderBy(asc(userGroups.tag));
}

export async function getUserGroup(id: number): Promise<UserGroupRow | null> {
  const [row] = await db.select().from(userGroups).where(eq(userGroups.id, id));
  return row ?? null;
}

export async function getUserGroupByTag(tag: string): Promise<UserGroupRow | null> {
  const [row] = await db.select().from(userGroups).where(eq(userGroups.tag, tag));
  return row ?? null;
}

export async function listUserGroupsForTags(tags: string[]): Promise<UserGroupRow[]> {
  if (tags.length === 0) return [];
  return db
    .select()
    .from(userGroups)
    .where(inArray(userGroups.tag, tags))
    .orderBy(asc(userGroups.tag));
}

export async function listUserGroupMembers(
  tags: string[]
): Promise<Array<{ tag: string; userId: number; userName: string }>> {
  if (tags.length === 0) return [];

  const tagConditions = tags.map((tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`);
  const rows = await db
    .select({ id: users.id, name: users.name, tags: users.tags })
    .from(users)
    .where(and(isNull(users.deletedAt), or(...tagConditions)))
    .orderBy(asc(users.name));

  const requested = new Set(tags);
  const members: Array<{ tag: string; userId: number; userName: string }> = [];
  for (const row of rows) {
    const userTags = Array.isArray(row.tags) ? row.tags : [];
    for (const tag of userTags) {
      if (requested.has(tag)) {
        members.push({ tag, userId: row.id, userName: row.name });
      }
    }
  }
  return members;
}

export async function countUsersInUserGroup(tag: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb AND ${isNull(users.deletedAt)}`);
  return result?.count ?? 0;
}
