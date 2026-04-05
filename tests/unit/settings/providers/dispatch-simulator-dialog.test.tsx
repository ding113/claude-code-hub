/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DispatchSimulatorDialog } from "@/app/[locale]/settings/providers/_components/dispatch-simulator-dialog";
import type { ProviderDisplay } from "@/types/provider";
import commonMessages from "../../../../messages/en/common.json";
import errorsMessages from "../../../../messages/en/errors.json";
import formsMessages from "../../../../messages/en/forms.json";
import settingsMessages from "../../../../messages/en/settings";
import uiMessages from "../../../../messages/en/ui.json";

const dispatchActionMocks = vi.hoisted(() => ({
  simulateDispatchAction: vi.fn(),
}));

vi.mock("@/actions/dispatch-simulator", () => dispatchActionMocks);

function loadMessages() {
  return {
    common: commonMessages,
    errors: errorsMessages,
    ui: uiMessages,
    forms: formsMessages,
    settings: settingsMessages,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushTicks(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function makeProvider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "Provider A",
    url: "https://api.example.com",
    maskedKey: "sk-***",
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: "alpha",
    providerType: "claude",
    providerVendorId: 1,
    preserveClientIp: false,
    disableSessionReuse: false,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 3,
    circuitBreakerOpenDuration: 60_000,
    circuitBreakerHalfOpenSuccessThreshold: 1,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 60_000,
    requestTimeoutNonStreamingMs: 120_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexServiceTierPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  } as ProviderDisplay;
}

describe("DispatchSimulatorDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("submits simulation input and renders the result", async () => {
    const messages = loadMessages();
    dispatchActionMocks.simulateDispatchAction.mockResolvedValue({
      ok: true,
      data: {
        steps: [
          {
            stepName: "groupFilter",
            stepIndex: 1,
            inputCount: 1,
            outputCount: 1,
            filteredOut: [],
            surviving: [
              {
                id: 1,
                name: "Provider A",
                providerType: "claude",
                groupTag: "alpha",
                priority: 0,
                effectivePriority: 0,
                weight: 1,
              },
            ],
          },
          {
            stepName: "priorityTiers",
            stepIndex: 7,
            inputCount: 1,
            outputCount: 1,
            filteredOut: [],
            surviving: [
              {
                id: 1,
                name: "Provider A",
                providerType: "claude",
                groupTag: "alpha",
                priority: 0,
                effectivePriority: 0,
                weight: 1,
              },
            ],
          },
        ],
        priorityTiers: [
          {
            priority: 0,
            isSelected: true,
            providers: [
              {
                id: 1,
                name: "Provider A",
                providerType: "claude",
                groupTag: "alpha",
                priority: 0,
                effectivePriority: 0,
                weight: 1,
                weightPercent: 100,
                redirectedModel: "glm-4.6",
                endpointStats: { total: 2, enabled: 2, circuitOpen: 0, available: 2 },
              },
            ],
          },
        ],
        totalProviders: 1,
        finalCandidateCount: 1,
        selectedPriority: 0,
      },
    });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <DispatchSimulatorDialog providers={[makeProvider()]} />
      </NextIntlClientProvider>
    );

    const trigger = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Dispatch Test")
    ) as HTMLButtonElement | undefined;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks();

    const input = [...document.querySelectorAll("input")].find(
      (element) => (element as HTMLInputElement).placeholder === "e.g. claude-opus-4-1"
    ) as HTMLInputElement | undefined;
    expect(input).toBeTruthy();

    await act(async () => {
      if (input) {
        input.value = "claude-opus-4-1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks();

    const simulateButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Simulate")
    ) as HTMLButtonElement | undefined;
    expect(simulateButton).toBeTruthy();

    await act(async () => {
      simulateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(4);

    expect(dispatchActionMocks.simulateDispatchAction).toHaveBeenCalledWith({
      clientFormat: "claude",
      modelName: "claude-opus-4-1",
      groupTags: [],
    });
    expect(document.body.textContent || "").toContain("Priority Tiers");
    expect(document.body.textContent || "").toContain("Provider A");
    expect(document.body.textContent || "").toContain("glm-4.6");

    unmount();
  });
});
