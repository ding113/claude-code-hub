/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardView } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-view";

const fetchMock = vi.fn<typeof fetch>();
const { getAllUserTagsMock, getAllUserKeyGroupsMock } = vi.hoisted(() => ({
  getAllUserTagsMock: vi.fn(),
  getAllUserKeyGroupsMock: vi.fn(),
}));
const searchParamsState = vi.hoisted(() => ({
  value: new URLSearchParams(),
}));
const tMock = vi.hoisted(() => vi.fn((key: string) => key));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsState.value,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => tMock,
}));

vi.mock("@/actions/users", () => ({
  getAllUserTags: getAllUserTagsMock,
  getAllUserKeyGroups: getAllUserKeyGroupsMock,
}));

vi.mock("@/app/[locale]/settings/providers/_components/provider-type-filter", () => ({
  ProviderTypeFilter: ({ value }: { value: string }) => (
    <div data-testid="provider-filter">{value}</div>
  ),
}));

vi.mock("@/app/[locale]/dashboard/leaderboard/_components/date-range-picker", () => ({
  DateRangePicker: () => <div data-testid="date-range-picker" />,
}));

vi.mock("@/app/[locale]/dashboard/leaderboard/_components/leaderboard-table", () => ({
  LeaderboardTable: ({ data }: { data: unknown[] }) => (
    <div data-testid="leaderboard-table">{JSON.stringify(data)}</div>
  ),
}));

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({ "data-testid": testId }: { "data-testid"?: string }) => (
    <div data-testid={testId ?? "leaderboard-tag-input"} />
  ),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const globalFetch = global.fetch;

async function waitForFetchCalls(expectedCalls: number) {
  for (let i = 0; i < 20; i += 1) {
    if (fetchMock.mock.calls.length >= expectedCalls) {
      return;
    }

    await act(async () => {
      await Promise.resolve();
    });
  }

  throw new Error(`fetchMock call count did not reach ${expectedCalls}`);
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

function getRequestedScopes() {
  return fetchMock.mock.calls.map((call) => {
    const url = new URL(String(call[0]), "http://localhost");
    return url.searchParams.get("scope");
  });
}

describe("LeaderboardView grouped tabs", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    getAllUserTagsMock.mockResolvedValue({ ok: true, data: ["vip"] });
    getAllUserKeyGroupsMock.mockResolvedValue({ ok: true, data: ["default"] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    fetchMock.mockImplementation(
      async () =>
        ({
          ok: true,
          json: async () => [],
        }) as Response
    );

    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    global.fetch = globalFetch;
  });

  it("deep-links admin users to the user cost leaderboard", async () => {
    searchParamsState.value = new URLSearchParams("scope=user");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(
      container!.querySelector("[data-testid='leaderboard-primary-tab-user'][data-state='active']")
    ).not.toBeNull();
    expect(
      container!.querySelector(
        "[data-testid='leaderboard-secondary-tab-cost'][data-state='active']"
      )
    ).not.toBeNull();
    expect(getRequestedScopes()).toContain("user");
  });

  it("deep-links admin users to the cache-hit secondary tab", async () => {
    searchParamsState.value = new URLSearchParams("scope=userCacheHitRate");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(
      container!.querySelector("[data-testid='leaderboard-primary-tab-user'][data-state='active']")
    ).not.toBeNull();
    expect(
      container!.querySelector(
        "[data-testid='leaderboard-secondary-tab-cache-hit'][data-state='active']"
      )
    ).not.toBeNull();
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("scope=userCacheHitRate"))
    ).toBe(true);
  });

  it("switching primary tab resets grouped scopes to cost leaf", async () => {
    searchParamsState.value = new URLSearchParams("scope=userCacheHitRate");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    const providerTab = container!.querySelector(
      "[data-testid='leaderboard-primary-tab-provider']"
    ) as HTMLElement | null;
    expect(providerTab).not.toBeNull();

    await act(async () => {
      providerTab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      providerTab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForFetchCalls(2);
    await flushUi();

    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.at(-1)).toContain("scope=provider");
    expect(requestedUrls.at(-1)).not.toContain("providerCacheHitRate");
    expect(
      container!.querySelector(
        "[data-testid='leaderboard-secondary-tab-cost'][data-state='active']"
      )
    ).not.toBeNull();
  });

  it("renders no secondary tabs for model", async () => {
    searchParamsState.value = new URLSearchParams("scope=model");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(
      container!.querySelector("[data-testid='leaderboard-primary-tab-model'][data-state='active']")
    ).not.toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-secondary-tabs']")).toBeNull();
    expect(getRequestedScopes()).toContain("model");
  });

  it("falls back non-admin users to the user cost leaderboard", async () => {
    searchParamsState.value = new URLSearchParams("scope=providerCacheHitRate");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin={false} />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(
      container!.querySelector("[data-testid='leaderboard-primary-tab-user'][data-state='active']")
    ).not.toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-primary-tab-provider']")).toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-primary-tab-model']")).toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-secondary-tabs']")).toBeNull();
    expect(getRequestedScopes()).toContain("user");
    expect(getRequestedScopes()).not.toContain("userCacheHitRate");
    expect(getRequestedScopes()).not.toContain("provider");
    expect(getRequestedScopes()).not.toContain("providerCacheHitRate");
  });
});
