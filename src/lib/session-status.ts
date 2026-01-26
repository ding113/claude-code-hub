import { logger } from "@/lib/logger";

/**
 * Session Display Status Constants
 * English uppercase abbreviations (no i18n for status labels)
 */
export const SESSION_DISPLAY_STATUS = {
  IN_PROGRESS: "IN_PROGRESS",
  IDLE: "IDLE",
  INITIALIZING: "INITIALIZING",
} as const;

export type SessionDisplayStatus =
  (typeof SESSION_DISPLAY_STATUS)[keyof typeof SESSION_DISPLAY_STATUS];

/**
 * Session Status Info for UI rendering
 */
export interface SessionStatusInfo {
  status: SessionDisplayStatus;
  label: string;
  tooltipKey: string;
  color: string;
  pulse: boolean;
}

/**
 * Input type for session status calculation
 */
export interface SessionStatusInput {
  concurrentCount?: number;
  requestCount?: number;
  status?: "in_progress" | "completed" | "error";
}

/**
 * Determine session display status based on request state
 *
 * Logic:
 * - IN_PROGRESS: concurrentCount > 0 AND requestCount > 1 (has active requests, not first)
 * - INITIALIZING: requestCount <= 1 AND concurrentCount > 0 (first request still running)
 * - IDLE: concurrentCount === 0 (all requests completed)
 *
 * @param session - Session data with concurrent and request counts
 * @returns SessionStatusInfo for UI rendering
 */
export function getSessionDisplayStatus(session: SessionStatusInput): SessionStatusInfo {
  const { concurrentCount = 0, requestCount = 0, status } = session;

  logger.trace("getSessionDisplayStatus", { concurrentCount, requestCount, status });

  // Error status takes priority
  if (status === "error") {
    return {
      status: SESSION_DISPLAY_STATUS.IN_PROGRESS,
      label: "FAIL",
      tooltipKey: "status.errorTooltip",
      color: "text-rose-500 dark:text-rose-400",
      pulse: true,
    };
  }

  // INITIALIZING: first request still running
  if (requestCount <= 1 && concurrentCount > 0) {
    return {
      status: SESSION_DISPLAY_STATUS.INITIALIZING,
      label: "INIT",
      tooltipKey: "status.initializingTooltip",
      color: "text-amber-500 dark:text-amber-400",
      pulse: true,
    };
  }

  // IN_PROGRESS: has active requests
  if (concurrentCount > 0) {
    return {
      status: SESSION_DISPLAY_STATUS.IN_PROGRESS,
      label: "BUSY",
      tooltipKey: "status.inProgressTooltip",
      color: "text-emerald-500 dark:text-emerald-400",
      pulse: true,
    };
  }

  // IDLE: no active requests
  return {
    status: SESSION_DISPLAY_STATUS.IDLE,
    label: "IDLE",
    tooltipKey: "status.idleTooltip",
    color: "text-muted-foreground/50",
    pulse: false,
  };
}
