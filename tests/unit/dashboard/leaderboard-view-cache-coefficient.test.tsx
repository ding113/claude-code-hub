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

  it("shows a tooltip trigger on the cache coefficient column header", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=providerCacheHitRate")) {
        return {
          ok: true,
          json: async () => [cacheHitEntry({ providerId: 1, cacheCoefficientBp: 9000 })],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const coefficientHeader = Array.from(container!.querySelectorAll("th")).find((th) =>
      th.textContent?.includes("columns.cacheCoefficient")
    );
    expect(coefficientHeader).toBeDefined();
    const trigger = coefficientHeader!.querySelector('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();
  });

  it("does not trigger column sorting when the help icon is clicked", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=providerCacheHitRate")) {
        return {
          ok: true,
          json: async () => [
            cacheHitEntry({ providerId: 1, providerName: "high-first", cacheCoefficientBp: 9500 }),
            cacheHitEntry({ providerId: 2, providerName: "low-second", cacheCoefficientBp: 5000 }),
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const coefficientHeader = Array.from(container!.querySelectorAll("th")).find((th) =>
      th.textContent?.includes("columns.cacheCoefficient")
    );
    const trigger = coefficientHeader!.querySelector('[data-slot="tooltip-trigger"]');
    expect(trigger).not.toBeNull();

    await act(async () => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 行顺序保持默认（未触发升序排序，否则 low-second 会排到第一行）
    const bodyText = container!.querySelector("tbody")?.textContent ?? "";
    expect(bodyText.indexOf("high-first")).toBeLessThan(bodyText.indexOf("low-second"));
  });

  it("colors the coefficient by tier: >=0.9 green, >=0.8 yellow, else orange", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=providerCacheHitRate")) {
        return {
          ok: true,
          json: async () => [
            cacheHitEntry({ providerId: 1, providerName: "excellent", cacheCoefficientBp: 9500 }),
            cacheHitEntry({
              providerId: 2,
              providerName: "edge-excellent",
              cacheCoefficientBp: 9000,
            }),
            cacheHitEntry({ providerId: 3, providerName: "good", cacheCoefficientBp: 8600 }),
            cacheHitEntry({ providerId: 4, providerName: "edge-good", cacheCoefficientBp: 8000 }),
            cacheHitEntry({ providerId: 5, providerName: "poor", cacheCoefficientBp: 5000 }),
            cacheHitEntry({ providerId: 6, providerName: "missing", cacheCoefficientBp: null }),
          ],
        } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const hasColoredValue = (selector: string, text: string) =>
      Array.from(container!.querySelectorAll(selector)).some((el) => el.textContent === text);
    expect(hasColoredValue("span.text-green-600", "0.95")).toBe(true);
    // 边界值：0.90 仍属优秀档
    expect(hasColoredValue("span.text-green-600", "0.90")).toBe(true);
    expect(hasColoredValue("span.text-yellow-600", "0.86")).toBe(true);
    // 边界值：0.80 仍属良好档
    expect(hasColoredValue("span.text-yellow-600", "0.80")).toBe(true);
    expect(hasColoredValue("span.text-orange-600", "0.50")).toBe(true);
    // 缺失值：muted 样式展示占位符
    expect(hasColoredValue("span.text-muted-foreground", "–")).toBe(true);
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
              avgTtftMs: 150,
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
