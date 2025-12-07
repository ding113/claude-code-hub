export type AggregateSessionStatsResult = Awaited<
  ReturnType<typeof import("@/repository/message")["aggregateMultipleSessionStats"]>
>;

export type AggregateSessionStatsEntry = AggregateSessionStatsResult[number];

export type BatchTerminationSummary = {
  uniqueRequestedIds: string[];
  allowedSessionIds: string[];
  unauthorizedSessionIds: string[];
  missingSessionIds: string[];
};

export function summarizeTerminateSessionsBatch(
  requestedSessionIds: string[],
  sessionsData: AggregateSessionStatsResult,
  currentUserId: number,
  isAdmin: boolean
): BatchTerminationSummary {
  const uniqueRequestedIds = Array.from(new Set(requestedSessionIds));

  const sessionIdSet = new Set(sessionsData.map((session) => session.sessionId));
  const missingSessionIds = uniqueRequestedIds.filter((id) => !sessionIdSet.has(id));

  const allowedSessions: AggregateSessionStatsEntry[] = [];
  const unauthorizedSessions: AggregateSessionStatsEntry[] = [];

  for (const session of sessionsData) {
    if (isAdmin || session.userId === currentUserId) {
      allowedSessions.push(session);
    } else {
      unauthorizedSessions.push(session);
    }
  }

  return {
    uniqueRequestedIds,
    allowedSessionIds: allowedSessions.map((session) => session.sessionId),
    unauthorizedSessionIds: unauthorizedSessions.map((session) => session.sessionId),
    missingSessionIds,
  };
}
