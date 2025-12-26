export interface RemoteConfigSync {
  id: number;
  configKey: string;
  remoteVersion: string | null;
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}
