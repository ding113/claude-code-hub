/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaderboardView } from "@/app/[locale]/dashboard/leaderboard/_components/leaderboard-view";

const fetchMock = vi.fn<typeof fetch>();
const { usersTagsMock, usersKeyGroupsMock } = vi.hoisted(() => ({
  usersTagsMock: vi.fn(),
  usersKeyGroupsMock: vi.fn(),
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

vi.mock("@/lib/api-client/v1/users", () => ({
  usersClient: {
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    enable: vi.fn(),
    renew: vi.fn(),
    resetLimits: vi.fn(),
    tags: usersTagsMock,
    keyGroups: usersKeyGroupsMock,
  },
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

describe("LeaderboardView user cache hit rate scope", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.value = new URLSearchParams("scope=userCacheHitRate");
    usersTagsMock.mockResolvedValue({ items: ["vip"] });
    usersKeyGroupsMock.mockResolvedValue({ items: ["default"] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=userCacheHitRate")) {
        return {
          ok: true,
          json: async () => [
            {
              userId: 9,
              userName: "cache-user",
              totalRequests: 15,
              totalCost: 1.5,
              totalCostFormatted: "$1.50",
              cacheReadTokens: 500,
              cacheCreationCost: 0.2,
              totalInputTokens: 1000,
              totalTokens: 1000,
              cacheHitRate: 0.5,
              modelStats: [
                {
                  model: "claude-sonnet-4",
                  totalRequests: 15,
                  cacheReadTokens: 500,
                  totalInputTokens: 1000,
                  cacheHitRate: 0.5,
                },
              ],
            },
          ],
        } as Response;
      }

      return {
        ok: true,
        json: async () => [],
      } as Response;
    });

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

  it("fetches and renders user cache hit rate leaderboard for admin", async () => {
    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    expect(fetchMock).toHaveBeenCalled();
    const requestedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requestedUrls.some((url) => url.includes("scope=userCacheHitRate"))).toBe(true);
    expect(
      requestedUrls.some(
        (url) => url.includes("scope=userCacheHitRate") && url.includes("includeUserModelStats=1")
      )
    ).toBe(true);
    expect(
      container!.querySelector("[data-testid='leaderboard-primary-tab-user'][data-state='active']")
    ).not.toBeNull();
    expect(
      container!.querySelector(
        "[data-testid='leaderboard-secondary-tab-cache-hit'][data-state='active']"
      )
    ).not.toBeNull();
    expect(container!.textContent).toContain("cache-user");
    expect(container!.textContent).toContain("50.0%");
  });

  it("keeps model cost visible in the existing user leaderboard drilldown", async () => {
    searchParamsState.value = new URLSearchParams("scope=user");
    fetchMock.mockImplementationOnce(async (input) => {
      const url = String(input);
      if (url.includes("scope=user")) {
        return {
          ok: true,
          json: async () => [
            {
              userId: 3,
              userName: "cost-user",
              totalRequests: 12,
              totalCost: 4.2,
              totalCostFormatted: "$4.20",
              totalTokens: 2400,
              modelStats: [
                {
                  model: "claude-sonnet-4",
                  totalRequests: 7,
                  totalCost: 2.1,
                  totalCostFormatted: "$2.10",
                  totalTokens: 1400,
                },
              ],
            },
          ],
        } as Response;
      }

      return {
        ok: true,
        json: async () => [],
      } as Response;
    });

    await act(async () => {
      root!.render(<LeaderboardView isAdmin />);
    });

    const expandButton = container!.querySelector(
      'button[aria-label="expandModelStats"]'
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    await act(async () => {
      expandButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container!.textContent).toContain("cost-user");
    expect(container!.textContent).toContain("claude-sonnet-4");
    expect(container!.textContent).toContain("$2.10");
  });
});
