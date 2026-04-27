import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { userSecuritySettings } from "@/drizzle/schema";
import type { AuthSession } from "@/lib/auth";

export interface UserSecuritySettings {
  subjectId: string;
  totpEnabled: boolean;
  totpSecret: string | null;
  totpBoundAt: Date | null;
}

export function getSecuritySubjectId(session: Pick<AuthSession, "user">): string {
  return session.user.id === -1 ? "admin-token" : `user:${session.user.id}`;
}

function toUserSecuritySettings(
  row: typeof userSecuritySettings.$inferSelect
): UserSecuritySettings {
  return {
    subjectId: row.subjectId,
    totpEnabled: row.totpEnabled,
    totpSecret: row.totpSecret,
    totpBoundAt: row.totpBoundAt,
  };
}

export async function findUserSecuritySettings(
  subjectId: string
): Promise<UserSecuritySettings | null> {
  const [row] = await db
    .select()
    .from(userSecuritySettings)
    .where(eq(userSecuritySettings.subjectId, subjectId))
    .limit(1);

  return row ? toUserSecuritySettings(row) : null;
}

export async function getUserSecuritySettings(subjectId: string): Promise<UserSecuritySettings> {
  return (
    (await findUserSecuritySettings(subjectId)) ?? {
      subjectId,
      totpEnabled: false,
      totpSecret: null,
      totpBoundAt: null,
    }
  );
}

export async function saveTotpEnabled(subjectId: string, secret: string): Promise<void> {
  const now = new Date();
  await db
    .insert(userSecuritySettings)
    .values({
      subjectId,
      totpEnabled: true,
      totpSecret: secret,
      totpBoundAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSecuritySettings.subjectId,
      set: {
        totpEnabled: true,
        totpSecret: secret,
        totpBoundAt: now,
        updatedAt: now,
      },
    });
}

export async function disableTotp(subjectId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(userSecuritySettings)
    .values({
      subjectId,
      totpEnabled: false,
      totpSecret: null,
      totpBoundAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSecuritySettings.subjectId,
      set: {
        totpEnabled: false,
        totpSecret: null,
        totpBoundAt: null,
        updatedAt: now,
      },
    });
}
