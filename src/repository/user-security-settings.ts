import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { userSecuritySettings } from "@/drizzle/schema";
import { ADMIN_USER_ID, type AuthSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  TotpSecretDecryptionError,
} from "@/lib/security/totp-secret-encryption";

export interface UserSecuritySettings {
  subjectId: string;
  totpEnabled: boolean;
  totpSecret: string | null;
  totpLastUsedCounter: number | null;
  totpPendingSecret: string | null;
  totpPendingExpiresAt: Date | null;
  totpBoundAt: Date | null;
}

export function getSecuritySubjectId(session: Pick<AuthSession, "user">): string {
  return session.user.id === ADMIN_USER_ID ? "admin-token" : `user:${session.user.id}`;
}

function decryptStoredTotpSecret(
  subjectId: string,
  field: "totpSecret" | "totpPendingSecret",
  ciphertext: string | null
): string | null {
  try {
    return decryptTotpSecret(ciphertext);
  } catch (error) {
    if (error instanceof TotpSecretDecryptionError) {
      logger.warn("Stored TOTP secret decryption failed", {
        subjectId,
        field,
        error: error.message,
      });
      return null;
    }

    logger.warn("Stored TOTP secret read failed", {
      subjectId,
      field,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function toUserSecuritySettings(
  row: typeof userSecuritySettings.$inferSelect
): UserSecuritySettings {
  return {
    subjectId: row.subjectId,
    totpEnabled: row.totpEnabled,
    totpSecret: decryptStoredTotpSecret(row.subjectId, "totpSecret", row.totpSecret),
    totpLastUsedCounter: row.totpLastUsedCounter,
    totpPendingSecret: decryptStoredTotpSecret(
      row.subjectId,
      "totpPendingSecret",
      row.totpPendingSecret
    ),
    totpPendingExpiresAt: row.totpPendingExpiresAt,
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
      totpLastUsedCounter: null,
      totpPendingSecret: null,
      totpPendingExpiresAt: null,
      totpBoundAt: null,
    }
  );
}

export async function saveTotpSetupPending(
  subjectId: string,
  secret: string,
  expiresAt: Date
): Promise<void> {
  const now = new Date();
  const encryptedSecret = encryptTotpSecret(secret);
  await db
    .insert(userSecuritySettings)
    .values({
      subjectId,
      totpPendingSecret: encryptedSecret.ciphertext,
      totpPendingSecretKeyVersion: encryptedSecret.keyVersion,
      totpPendingExpiresAt: expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSecuritySettings.subjectId,
      set: {
        totpPendingSecret: encryptedSecret.ciphertext,
        totpPendingSecretKeyVersion: encryptedSecret.keyVersion,
        totpPendingExpiresAt: expiresAt,
        updatedAt: now,
      },
    });
}

export async function saveTotpEnabled(subjectId: string, secret: string): Promise<Date> {
  const now = new Date();
  const encryptedSecret = encryptTotpSecret(secret);
  await db
    .insert(userSecuritySettings)
    .values({
      subjectId,
      totpEnabled: true,
      totpSecret: encryptedSecret.ciphertext,
      totpSecretKeyVersion: encryptedSecret.keyVersion,
      totpLastUsedCounter: null,
      totpPendingSecret: null,
      totpPendingSecretKeyVersion: null,
      totpPendingExpiresAt: null,
      totpBoundAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSecuritySettings.subjectId,
      set: {
        totpEnabled: true,
        totpSecret: encryptedSecret.ciphertext,
        totpSecretKeyVersion: encryptedSecret.keyVersion,
        totpLastUsedCounter: null,
        totpPendingSecret: null,
        totpPendingSecretKeyVersion: null,
        totpPendingExpiresAt: null,
        totpBoundAt: now,
        updatedAt: now,
      },
    });

  return now;
}

export async function disableTotp(subjectId: string): Promise<void> {
  const now = new Date();
  await db
    .insert(userSecuritySettings)
    .values({
      subjectId,
      totpEnabled: false,
      totpSecret: null,
      totpSecretKeyVersion: null,
      totpLastUsedCounter: null,
      totpPendingSecret: null,
      totpPendingSecretKeyVersion: null,
      totpPendingExpiresAt: null,
      totpBoundAt: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userSecuritySettings.subjectId,
      set: {
        totpEnabled: false,
        totpSecret: null,
        totpSecretKeyVersion: null,
        totpLastUsedCounter: null,
        totpPendingSecret: null,
        totpPendingSecretKeyVersion: null,
        totpPendingExpiresAt: null,
        totpBoundAt: null,
        updatedAt: now,
      },
    });
}

export async function saveTotpLastUsedCounter(
  subjectId: string,
  counter: number
): Promise<boolean> {
  const [row] = await db
    .update(userSecuritySettings)
    .set({ totpLastUsedCounter: counter, updatedAt: new Date() })
    .where(
      and(
        eq(userSecuritySettings.subjectId, subjectId),
        or(
          isNull(userSecuritySettings.totpLastUsedCounter),
          lt(userSecuritySettings.totpLastUsedCounter, counter)
        )
      )
    )
    .returning({ subjectId: userSecuritySettings.subjectId });

  return Boolean(row);
}
