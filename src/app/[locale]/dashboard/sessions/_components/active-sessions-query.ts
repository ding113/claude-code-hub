import { getAllSessions } from "@/lib/api-client/v1/actions/active-sessions";
import type { ActiveSessionInfo } from "@/types/session";

export const SESSION_FETCH_TIMEOUT_MS = 15_000;

export interface PaginatedSessionsData {
  active: ActiveSessionInfo[];
  inactive: ActiveSessionInfo[];
  totalActive: number;
  totalInactive: number;
  hasMoreActive: boolean;
  hasMoreInactive: boolean;
}

export async function fetchAllSessionsPage(input: {
  activePage: number;
  inactivePage: number;
  pageSize: number;
  signal: AbortSignal;
}): Promise<PaginatedSessionsData> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), SESSION_FETCH_TIMEOUT_MS);
  const abort = () => timeoutController.abort();
  input.signal.addEventListener("abort", abort, { once: true });

  try {
    const combinedSignal =
      typeof AbortSignal.any === "function"
        ? AbortSignal.any([input.signal, timeoutController.signal])
        : timeoutController.signal;
    const result = await getAllSessions(input.activePage, input.inactivePage, input.pageSize, {
      signal: combinedSignal,
    });
    if (input.signal.aborted) {
      throw new Error("FETCH_SESSIONS_CANCELLED");
    }
    if (timeoutController.signal.aborted && !input.signal.aborted) {
      throw new Error("FETCH_SESSIONS_TIMEOUT");
    }
    if (!result.ok) {
      throw new Error("FETCH_SESSIONS_FAILED");
    }
    return result.data;
  } catch {
    if (timeoutController.signal.aborted && !input.signal.aborted) {
      throw new Error("FETCH_SESSIONS_TIMEOUT");
    }
    if (input.signal.aborted) {
      throw new Error("FETCH_SESSIONS_CANCELLED");
    }
    throw new Error("FETCH_SESSIONS_FAILED");
  } finally {
    window.clearTimeout(timeoutId);
    input.signal.removeEventListener("abort", abort);
  }
}
