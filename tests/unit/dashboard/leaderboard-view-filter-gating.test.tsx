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
  TagInput: ({ ["data-testid"]: testId }: { "data-testid"?: string }) => (
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

describe("LeaderboardView filter gating", () => {
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

  it("shows provider filters for provider family and preserves provider request params", async () => {
    searchParamsState.value = new URLSearchParams("scope=provider");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(container!.querySelector("[data-testid='provider-filter']")).not.toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("scope=provider");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("includeModelStats=1");

    searchParamsState.value = new URLSearchParams("scope=providerCacheHitRate");
    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(2);
    await flushUi();

    expect(container!.querySelector("[data-testid='provider-filter']")).not.toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("scope=providerCacheHitRate");
    expect(fetchMock.mock.calls.at(-1)?.[0]).not.toContain("includeModelStats=1");
  });

  it("hides secondary tabs and family filters for model scope", async () => {
    searchParamsState.value = new URLSearchParams("scope=model");

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });
    await waitForFetchCalls(1);
    await flushUi();

    expect(container!.querySelector("[data-testid='leaderboard-secondary-tabs']")).toBeNull();
    expect(container!.querySelector("[data-testid='provider-filter']")).toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-user-tag-filter']")).toBeNull();
    expect(container!.querySelector("[data-testid='leaderboard-user-group-filter']")).toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("scope=model");
  });
});
