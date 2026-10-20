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

  const claimedRequestedIds = new Set<string>();

  const allowedSessions: AggregateSessionStatsEntry[] = [];
  const unauthorizedSessions: AggregateSessionStatsEntry[] = [];

  for (const session of sessionsData) {
    const requestedIds = session.requestedSessionIds?.length
      ? session.requestedSessionIds
      : [session.sessionId];
    for (const requestedId of requestedIds) {
      claimedRequestedIds.add(requestedId);
    }
    if (isAdmin || session.userId === currentUserId) {
      allowedSessions.push(session);
    } else {
      unauthorizedSessions.push(session);
    }
  }

  const missingSessionIds = uniqueRequestedIds.filter((id) => !claimedRequestedIds.has(id));

  return {
    uniqueRequestedIds,
    allowedSessionIds: allowedSessions.map((session) => session.sessionId),
    unauthorizedSessionIds: unauthorizedSessions.map((session) => session.sessionId),
    missingSessionIds,
  };
}
