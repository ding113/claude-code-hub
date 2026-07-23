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
  useTimeZone: () => "Asia/Shanghai",
}));

vi.mock("@/lib/api-client/v1/actions/users", () => ({
  getAllUserTags: getAllUserTagsMock,
  getAllUserKeyGroups: getAllUserKeyGroupsMock,
}));

vi.mock("@/app/[locale]/settings/providers/_components/provider-type-filter", () => ({
  ProviderTypeFilter: ({ value }: { value: string }) => (
    <div data-testid="provider-filter">{value}</div>
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

function cacheHitEntry(overrides: Record<string, unknown>) {
  return {
    providerId: 1,
    providerName: "provider-a",
    totalRequests: 10,
    totalCost: 2.5,
    totalCostFormatted: "$2.50",
    cacheReadTokens: 500,
    cacheCreationCost: 0.2,
    totalInputTokens: 1000,
    totalTokens: 1000,
    cacheHitRate: 0.5,
    cacheCoefficientBp: null,
    modelStats: [],
    ...overrides,
  };
}

describe("LeaderboardView cache coefficient column", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.value = new URLSearchParams("scope=providerCacheHitRate");
    getAllUserTagsMock.mockResolvedValue({ ok: true, data: [] });
    getAllUserKeyGroupsMock.mockResolvedValue({ ok: true, data: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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

  it("renders the coefficient as bp/10000 on the provider cache hit rate board", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=providerCacheHitRate")) {
        return {
          ok: true,
          json: async () => [
            cacheHitEntry({
              providerId: 1,
              providerName: "with-coefficient",
              cacheCoefficientBp: 8600,
            }),
            cacheHitEntry({
              providerId: 2,
              providerName: "without-coefficient",
              cacheCoefficientBp: null,
            }),
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const text = container!.textContent ?? "";
    expect(text).toContain("columns.cacheCoefficient");
    expect(text).toContain("0.86");
    expect(text).toContain("–");
  });

  it("renders the coefficient column on the provider usage board too", async () => {
    searchParamsState.value = new URLSearchParams("scope=provider");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=provider") && !url.includes("providerCacheHitRate")) {
        return {
          ok: true,
          json: async () => [
            {
              providerId: 3,
              providerName: "usage-provider",
              totalRequests: 12,
              totalCost: 4.2,
              totalCostFormatted: "$4.20",
              totalTokens: 2400,
              successRate: 0.9,
              avgTtfbMs: 150,
              avgTokensPerSecond: 42,
              avgCostPerRequest: 0.35,
              avgCostPerMillionTokens: 1750,
              cacheCoefficientBp: 1234,
              modelStats: [],
            },
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const text = container!.textContent ?? "";
    expect(text).toContain("columns.cacheCoefficient");
    expect(text).toContain("0.12");
  });
});
