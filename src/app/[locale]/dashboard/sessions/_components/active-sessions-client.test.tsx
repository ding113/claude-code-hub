import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  sessions: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: string[] }) =>
    options.queryKey[0] === "all-sessions"
      ? queryState.sessions
      : { data: { currencyDisplay: "USD" } },
}));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("@/components/section", () => ({
  Section: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock("./active-sessions-table", () => ({
  ActiveSessionsTable: ({
    sessions,
    isLoading,
  }: {
    sessions: { sessionId: string }[];
    isLoading: boolean;
  }) => <div>{isLoading ? "loading" : sessions.map((session) => session.sessionId).join(",")}</div>,
}));

import { ActiveSessionsClient } from "./active-sessions-client";

const messages = {
  dashboard: {
    sessions: {
      back: "Back",
      monitoring: "Sessions",
      monitoringDescription: "Live status",
      loadingError: "Loading failed",
      refreshing: "Refreshing...",
      activeSessions: "Active Sessions",
      inactiveSessions: "Inactive Sessions",
      pagination: { total: "total" },
      errors: {
        fetchSessionsFailed: "Failed to load sessions",
        fetchSessionsTimeout: "The sessions request timed out",
        fetchSettingsFailed: "Failed to load settings",
        retry: "Retry",
      },
    },
  },
};

describe("ActiveSessionsClient", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    queryState.refetch.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => container.remove());

  async function render() {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <ActiveSessionsClient />
        </NextIntlClientProvider>
      );
    });
    return root;
  }

  it("shows a localized timeout and an explicit retry command", async () => {
    queryState.sessions = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("FETCH_SESSIONS_TIMEOUT"),
      refetch: queryState.refetch,
    };
    const root = await render();

    expect(container.textContent).toContain("The sessions request timed out");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry"
    );
    await act(async () => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(queryState.refetch).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("keeps existing rows visible during a background refresh", async () => {
    queryState.sessions = {
      data: {
        active: [{ sessionId: "session-existing" }],
        inactive: [],
        totalActive: 1,
        totalInactive: 0,
        hasMoreActive: false,
        hasMoreInactive: false,
      },
      isLoading: false,
      isFetching: true,
      error: null,
      refetch: queryState.refetch,
    };
    const root = await render();

    expect(container.textContent).toContain("session-existing");
    expect(container.textContent).toContain("Refreshing...");
    expect(container.textContent).not.toContain("loading");
    await act(async () => root.unmount());
  });

  it("keeps existing rows visible when a background refresh fails", async () => {
    queryState.sessions = {
      data: {
        active: [{ sessionId: "session-existing" }],
        inactive: [],
        totalActive: 1,
        totalInactive: 0,
        hasMoreActive: false,
        hasMoreInactive: false,
      },
      isLoading: false,
      isFetching: false,
      error: new Error("FETCH_SESSIONS_FAILED"),
      refetch: queryState.refetch,
    };
    const root = await render();

    expect(container.textContent).toContain("session-existing");
    expect(container.textContent).toContain("Failed to load sessions");
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Retry"
    );
    await act(async () => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(queryState.refetch).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
