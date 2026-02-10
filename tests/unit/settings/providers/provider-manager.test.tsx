/**
 * @vitest-environment happy-dom
 */

import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderDisplay } from "@/types/provider";
import enMessages from "../../../../messages/en";

// ---------------------------------------------------------------------------
// Mocks -- keep them minimal, only stub what provider-manager.tsx touches
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: (value: string, _delay: number) => value,
}));

// Batch-edit subcomponents (heavy, irrelevant to this test scope)
vi.mock("@/app/[locale]/settings/providers/_components/batch-edit", () => ({
  ProviderBatchActions: () => null,
  ProviderBatchDialog: () => null,
  ProviderBatchToolbar: () => null,
}));

// ProviderList -- render a simple list so we can inspect filtered output
vi.mock("@/app/[locale]/settings/providers/_components/provider-list", () => ({
  ProviderList: ({ providers }: { providers: ProviderDisplay[] }) => (
    <ul data-testid="provider-list">
      {providers.map((p) => (
        <li key={p.id} data-testid={`provider-${p.id}`}>
          {p.name}
        </li>
      ))}
    </ul>
  ),
}));

// ProviderVendorView -- not under test
vi.mock("@/app/[locale]/settings/providers/_components/provider-vendor-view", () => ({
  ProviderVendorView: () => null,
}));

// ProviderTypeFilter
vi.mock("@/app/[locale]/settings/providers/_components/provider-type-filter", () => ({
  ProviderTypeFilter: () => null,
}));

// ProviderSortDropdown
vi.mock("@/app/[locale]/settings/providers/_components/provider-sort-dropdown", () => ({
  ProviderSortDropdown: () => null,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "Provider A",
    url: "https://api.example.com",
    maskedKey: "sk-***",
    isEnabled: true,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    groupTag: null,
    groupPriorities: null,
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

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
    container,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Lazy-import after mocks are established
let ProviderManager: typeof import("@/app/[locale]/settings/providers/_components/provider-manager").ProviderManager;

beforeEach(async () => {
  vi.clearAllMocks();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // Dynamic import to ensure mocks take effect
  const mod = await import("@/app/[locale]/settings/providers/_components/provider-manager");
  ProviderManager = mod.ProviderManager;
});

describe("ProviderManager circuitBrokenCount with endpoint circuits", () => {
  const providers = [
    makeProvider({ id: 1, name: "Provider A" }),
    makeProvider({ id: 2, name: "Provider B" }),
    makeProvider({ id: 3, name: "Provider C" }),
  ];

  test("counts only key-level circuit breaker when no endpointCircuitInfo", () => {
    const healthStatus = {
      1: {
        circuitState: "open" as const,
        failureCount: 5,
        lastFailureTime: Date.now(),
        circuitOpenUntil: Date.now() + 60000,
        recoveryMinutes: 1,
      },
    };

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        enableMultiProviderTypes={true}
      />
    );

    // The circuit broken count should show 1 (only Provider A has key-level open)
    const text = container.textContent || "";
    expect(text).toContain("(1)");

    unmount();
  });

  test("counts providers with endpoint-level circuit open in addition to key-level", () => {
    // Provider 1: key-level circuit open
    // Provider 2: healthy key, but has an endpoint circuit open
    // Provider 3: all healthy
    const healthStatus = {
      1: {
        circuitState: "open" as const,
        failureCount: 5,
        lastFailureTime: Date.now(),
        circuitOpenUntil: Date.now() + 60000,
        recoveryMinutes: 1,
      },
    };

    const endpointCircuitInfo: Record<
      number,
      Array<{
        endpointId: number;
        circuitState: "closed" | "open" | "half-open";
        failureCount: number;
        circuitOpenUntil: number | null;
      }>
    > = {
      2: [
        {
          endpointId: 10,
          circuitState: "open",
          failureCount: 3,
          circuitOpenUntil: Date.now() + 60000,
        },
        {
          endpointId: 11,
          circuitState: "closed",
          failureCount: 0,
          circuitOpenUntil: null,
        },
      ],
    };

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        endpointCircuitInfo={endpointCircuitInfo}
        enableMultiProviderTypes={true}
      />
    );

    // Count should be 2: Provider A (key open) + Provider B (endpoint open)
    const text = container.textContent || "";
    expect(text).toContain("(2)");

    unmount();
  });

  test("does not double-count provider with both key and endpoint circuits open", () => {
    const healthStatus = {
      1: {
        circuitState: "open" as const,
        failureCount: 5,
        lastFailureTime: Date.now(),
        circuitOpenUntil: Date.now() + 60000,
        recoveryMinutes: 1,
      },
    };

    const endpointCircuitInfo: Record<
      number,
      Array<{
        endpointId: number;
        circuitState: "closed" | "open" | "half-open";
        failureCount: number;
        circuitOpenUntil: number | null;
      }>
    > = {
      1: [
        {
          endpointId: 10,
          circuitState: "open",
          failureCount: 3,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    };

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        endpointCircuitInfo={endpointCircuitInfo}
        enableMultiProviderTypes={true}
      />
    );

    // Should still be 1 -- provider 1 has both, but count is deduplicated
    const text = container.textContent || "";
    expect(text).toContain("(1)");

    unmount();
  });

  test("circuit broken filter includes providers with endpoint circuits open", () => {
    // Use a state-based approach:
    // We'll set circuitBrokenFilter active programmatically by clicking the toggle.
    // Provider 2 only has an endpoint circuit open (no key circuit).

    const healthStatus = {};
    const endpointCircuitInfo: Record<
      number,
      Array<{
        endpointId: number;
        circuitState: "closed" | "open" | "half-open";
        failureCount: number;
        circuitOpenUntil: number | null;
      }>
    > = {
      2: [
        {
          endpointId: 10,
          circuitState: "open",
          failureCount: 3,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    };

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        endpointCircuitInfo={endpointCircuitInfo}
        enableMultiProviderTypes={true}
      />
    );

    // Circuit broken count should be 1 (Provider B has endpoint open)
    const text = container.textContent || "";
    expect(text).toContain("(1)");

    // Find and click the circuit broken toggle
    const toggle = container.querySelector("#circuit-broken-filter");
    expect(toggle).not.toBeNull();

    act(() => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // After activating the filter, only Provider B should be shown
    const listItems = container.querySelectorAll("[data-testid^='provider-']");
    const providerNames = Array.from(listItems).map((el) => el.textContent);
    expect(providerNames).toContain("Provider B");
    expect(providerNames).not.toContain("Provider A");
    expect(providerNames).not.toContain("Provider C");

    unmount();
  });

  test("shows zero circuit broken count when no circuits are open", () => {
    const healthStatus = {};

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        enableMultiProviderTypes={true}
      />
    );

    // When count is 0, the circuit broken section should NOT be rendered
    const toggleDesktop = container.querySelector("#circuit-broken-filter");
    expect(toggleDesktop).toBeNull();

    unmount();
  });

  test("endpointCircuitInfo defaults to empty when not provided", () => {
    const healthStatus = {};

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        enableMultiProviderTypes={true}
      />
    );

    // No circuit broken UI should appear
    const toggleDesktop = container.querySelector("#circuit-broken-filter");
    expect(toggleDesktop).toBeNull();

    unmount();
  });
});

describe("ProviderManager layered circuit labels", () => {
  const providers = [
    makeProvider({ id: 1, name: "Provider Key Broken" }),
    makeProvider({ id: 2, name: "Provider Endpoint Broken" }),
    makeProvider({ id: 3, name: "Provider Both Broken" }),
  ];

  test("passes endpointCircuitInfo to ProviderList for rendering", () => {
    const healthStatus = {
      1: {
        circuitState: "open" as const,
        failureCount: 5,
        lastFailureTime: Date.now(),
        circuitOpenUntil: Date.now() + 60000,
        recoveryMinutes: 1,
      },
      3: {
        circuitState: "open" as const,
        failureCount: 3,
        lastFailureTime: Date.now(),
        circuitOpenUntil: Date.now() + 30000,
        recoveryMinutes: 0.5,
      },
    };

    const endpointCircuitInfo = {
      2: [
        {
          endpointId: 20,
          circuitState: "open" as const,
          failureCount: 2,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
      3: [
        {
          endpointId: 30,
          circuitState: "open" as const,
          failureCount: 4,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    };

    const { unmount, container } = renderWithProviders(
      <ProviderManager
        providers={providers}
        healthStatus={healthStatus}
        endpointCircuitInfo={endpointCircuitInfo}
        enableMultiProviderTypes={true}
      />
    );

    // The circuit broken count should be 3 (all three providers have some form of circuit open)
    const text = container.textContent || "";
    expect(text).toContain("(3)");

    unmount();
  });
});
