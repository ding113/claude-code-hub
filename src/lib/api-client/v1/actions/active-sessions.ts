import type { ActiveSessionInfo } from "@/types/session";
import {
  apiDelete,
  apiGet,
  apiPost,
  searchParams,
  toActionResult,
  toVoidActionResult,
  unwrapItems,
} from "./_compat";

export function getActiveSessions() {
  return toActionResult(
    apiGet<{ items?: ActiveSessionInfo[] }>("/api/v1/sessions").then(unwrapItems)
  );
}

export function getAllSessions(activePage?: number, inactivePage?: number, pageSize?: number) {
  return toActionResult(
    apiGet(
      `/api/v1/sessions${searchParams({
        state: "all",
        activePage,
        inactivePage,
        pageSize,
      })}`
    )
  );
}

export function getSessionMessages(sessionId: string, requestSequence?: number) {
  return toActionResult(
    apiGet(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages${searchParams({
        requestSequence,
      })}`
    )
  );
}

export function hasSessionMessages(sessionId: string, requestSequence?: number) {
  return toActionResult(
    apiGet<{ exists: boolean }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages/exists${searchParams({
        requestSequence,
      })}`
    ).then((body) => body.exists)
  );
}

export function getSessionDetails(sessionId: string, requestSequence?: number) {
  return toActionResult(
    apiGet(`/api/v1/sessions/${encodeURIComponent(sessionId)}${searchParams({ requestSequence })}`)
  );
}

export function getSessionRequests(
  sessionId: string,
  page?: number,
  pageSize?: number,
  order?: string
) {
  return toActionResult(
    apiGet(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/requests${searchParams({
        page,
        pageSize,
        order,
      })}`
    )
  );
}

export function terminateActiveSession(sessionId: string) {
  return toVoidActionResult(apiDelete(`/api/v1/sessions/${encodeURIComponent(sessionId)}`));
}

export function terminateActiveSessionsBatch(sessionIds: string[]) {
  return toActionResult(apiPost("/api/v1/sessions:batchTerminate", { sessionIds }));
}
