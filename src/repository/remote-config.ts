"use server";

import { eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { remoteConfigSync } from "@/drizzle/schema-v2";
import type { RemoteConfigSync } from "@/types/remote-config";
import { toRemoteConfigSync } from "./_shared/transformers";

export interface UpsertRemoteConfigSyncData {
  configKey: string;
  remoteVersion?: string | null;
  lastAttemptAt?: Date | null;
  lastSyncedAt?: Date | null;
  lastErrorMessage?: string | null;
}

export async function findRemoteConfigSyncByKey(
  configKey: string
): Promise<RemoteConfigSync | null> {
  const [row] = await db
    .select({
      id: remoteConfigSync.id,
      configKey: remoteConfigSync.configKey,
      remoteVersion: remoteConfigSync.remoteVersion,
      lastAttemptAt: remoteConfigSync.lastAttemptAt,
      lastSyncedAt: remoteConfigSync.lastSyncedAt,
      lastErrorMessage: remoteConfigSync.lastErrorMessage,
      createdAt: remoteConfigSync.createdAt,
      updatedAt: remoteConfigSync.updatedAt,
    })
    .from(remoteConfigSync)
    .where(eq(remoteConfigSync.configKey, configKey))
    .limit(1);

  if (!row) return null;
  return toRemoteConfigSync(row);
}

export async function upsertRemoteConfigSync(
  data: UpsertRemoteConfigSyncData
): Promise<RemoteConfigSync> {
  const now = new Date();
  const insertData = {
    configKey: data.configKey,
    remoteVersion: data.remoteVersion ?? null,
    lastAttemptAt: data.lastAttemptAt ?? null,
    lastSyncedAt: data.lastSyncedAt ?? null,
    lastErrorMessage: data.lastErrorMessage ?? null,
    updatedAt: now,
  };

  const updateData = {
    remoteVersion: insertData.remoteVersion,
    lastAttemptAt: insertData.lastAttemptAt,
    lastSyncedAt: insertData.lastSyncedAt,
    lastErrorMessage: insertData.lastErrorMessage,
    updatedAt: now,
  };

  const [row] = await db
    .insert(remoteConfigSync)
    .values(insertData)
    .onConflictDoUpdate({
      target: remoteConfigSync.configKey,
      set: updateData,
    })
    .returning({
      id: remoteConfigSync.id,
      configKey: remoteConfigSync.configKey,
      remoteVersion: remoteConfigSync.remoteVersion,
      lastAttemptAt: remoteConfigSync.lastAttemptAt,
      lastSyncedAt: remoteConfigSync.lastSyncedAt,
      lastErrorMessage: remoteConfigSync.lastErrorMessage,
      createdAt: remoteConfigSync.createdAt,
      updatedAt: remoteConfigSync.updatedAt,
    });

  return toRemoteConfigSync(row);
}
