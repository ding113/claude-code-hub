export type UserStatisticsResetStatus = "queued" | "running" | "completed" | "failed";

export interface UserStatisticsResetRecord {
  resetId: string;
  userId: number;
  status: UserStatisticsResetStatus;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  deletedMessageRequests: number;
  deletedUsageLedger: number;
  errorCode: string | null;
}

export interface UserStatisticsResetJobData {
  resetId: string;
  userId: number;
  requestedAt: string;
  fixed5hKeyIds?: number[];
  fixed5hPreparationVersion?: 1;
}

export interface UserStatisticsResetStoredRecord extends UserStatisticsResetRecord {
  fixed5hKeyIds: number[];
  fixed5hPreparationVersion: 1 | null;
}
