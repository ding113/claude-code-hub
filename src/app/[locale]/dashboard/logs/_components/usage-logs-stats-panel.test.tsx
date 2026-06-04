import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stable translation function so loadStats identity stays stable across rerenders
// (mirrors real next-intl, where useTranslations returns a memoized fn). This ensures
// the only refetch triggers are filtersKey and refreshKey, matching production.
const i18nMock = vi.hoisted(() => ({ t: (key: string) => key }));

const getUsageLogsStatsMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl", () => ({
  useTranslations: () => i18nMock.t,
}));

vi.mock("@/lib/api-client/v1/actions/usage-logs", () => ({
  getUsageLogsStats: getUsageLogsStatsMock,
}));

import { UsageLogsStatsPanel } from "./usage-logs-stats-panel";

// Same object reference across rerenders so only refreshKey drives the refetch.
const FILTERS = { userId: 1 };

async function renderPanel(root: Root, refreshKey: number) {
  await act(async () => {
    root.render(<UsageLogsStatsPanel filters={FILTERS} refreshKey={refreshKey} />);
  });
}

describe("UsageLogsStatsPanel manual refresh", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    getUsageLogsStatsMock.mockReset();
    // Error branch avoids rendering the full stats shape while still exercising the fetch path.
    getUsageLogsStatsMock.mockResolvedValue({ ok: false, error: "stub" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("fetches stats once on mount", async () => {
    await renderPanel(root, 0);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(1);
  });

  it("refetches when refreshKey is bumped (manual refresh)", async () => {
    await renderPanel(root, 0);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(1);

    await renderPanel(root, 1);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(2);

    await renderPanel(root, 2);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(3);
  });

  it("does not refetch when refreshKey is unchanged on rerender", async () => {
    await renderPanel(root, 5);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(1);

    await renderPanel(root, 5);
    expect(getUsageLogsStatsMock).toHaveBeenCalledTimes(1);
  });
});
