/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderDisplay } from "@/types/provider";

const mockGetProviderGroups = vi.fn();
const mockUpdateProviderGroup = vi.fn();
const mockCreateProviderGroup = vi.fn();
const mockDeleteProviderGroup = vi.fn();
const mockEditProvider = vi.fn();

vi.mock("@/actions/provider-groups", () => ({
  getProviderGroups: () => mockGetProviderGroups(),
  updateProviderGroup: (...args: unknown[]) => mockUpdateProviderGroup(...args),
  createProviderGroup: (...args: unknown[]) => mockCreateProviderGroup(...args),
  deleteProviderGroup: (...args: unknown[]) => mockDeleteProviderGroup(...args),
}));

vi.mock("@/actions/providers", () => ({
  editProvider: (...args: unknown[]) => mockEditProvider(...args),
}));

vi.mock("@/app/[locale]/settings/providers/_components/batch-edit", () => ({
  ProviderBatchToolbar: () => <div data-testid="member-batch-toolbar" />,
  ProviderBatchActions: () => null,
  ProviderBatchDialog: () => null,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function makeProvider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "Provider A",
    url: "https://api.example.com",
    maskedKey: "sk-***",
    isEnabled: true,
    weight: 1,
    priority: 1,
    costMultiplier: 1.5,
    groupTag: "premium",
    groupPriorities: { premium: 3 },
    providerType: "claude",
    providerVendorId: null,
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 1,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 1,
    circuitBreakerOpenDuration: 60,
    circuitBreakerHalfOpenSuccessThreshold: 1,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    requestTimeoutNonStreamingMs: 0,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  act(() => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

import { ProviderGroupTab } from "@/app/[locale]/settings/providers/_components/provider-group-tab";

beforeEach(async () => {
  vi.clearAllMocks();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }

  mockGetProviderGroups.mockResolvedValue({
    ok: true,
    data: [
      {
        id: 11,
        name: "premium",
        costMultiplier: 1.5,
        description: "Priority group",
        providerCount: 1,
      },
    ],
  });
  mockUpdateProviderGroup.mockResolvedValue({ ok: true });
  mockCreateProviderGroup.mockResolvedValue({ ok: true });
  mockDeleteProviderGroup.mockResolvedValue({ ok: true });
  mockEditProvider.mockResolvedValue({ ok: true });

  await Promise.resolve();
});

describe("ProviderGroupTab", () => {
  it("opens group members and forwards provider edit requests", async () => {
    const onRequestEditProvider = vi.fn();
    const { container, unmount } = render(
      <ProviderGroupTab
        providers={[makeProvider()]}
        isAdmin={true}
        onRequestEditProvider={onRequestEditProvider}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const expandButton = container.querySelector('button[aria-label="groupMembers"]');
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const memberButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Provider A")
    );
    expect(memberButton).toBeTruthy();

    act(() => {
      memberButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRequestEditProvider).toHaveBeenCalledWith(1);
    expect(container.textContent).toContain("providerType");

    unmount();
  });

  it("hides mutating controls for non-admin users", async () => {
    const onRequestEditProvider = vi.fn();
    const { container, unmount } = render(
      <ProviderGroupTab
        providers={[makeProvider()]}
        isAdmin={false}
        onRequestEditProvider={onRequestEditProvider}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("addGroup")
      )
    ).toBe(false);

    const expandButton = container.querySelector('button[aria-label="groupMembers"]');
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('button[aria-label="openProviderEditor"]')).toBeNull();
    expect(onRequestEditProvider).not.toHaveBeenCalled();

    unmount();
  });
});
