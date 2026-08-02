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
}
