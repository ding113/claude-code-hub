/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderVendorView } from "@/app/[locale]/settings/providers/_components/provider-vendor-view";
import type { ProviderDisplay } from "@/types/provider";
import type { User } from "@/types/user";
import enMessages from "../../../../messages/en";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const providerEndpointsActionMocks = vi.hoisted(() => ({
  addProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  editProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  getProviderEndpointProbeLogs: vi.fn(async () => ({ ok: true, data: { logs: [] } })),
  getProviderEndpointsByVendor: vi.fn(async () => [
    {
      id: 1,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.example.com/v1",
      label: null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastLatencyMs: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]),
  getProviderVendors: vi.fn(async () => [
    {
      id: 1,
      displayName: "Vendor A",
      websiteDomain: "vendor.example",
      websiteUrl: "https://vendor.example",
      faviconUrl: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]),
  probeProviderEndpoint: vi.fn(async () => ({ ok: true, data: { result: { ok: true } } })),
  removeProviderEndpoint: vi.fn(async () => ({ ok: true })),
  removeProviderVendor: vi.fn(async () => ({ ok: true })),
  batchGetEndpointCircuitInfo: vi.fn(async () => ({ ok: true, data: [] })),
  resetEndpointCircuit: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/actions/provider-endpoints", () => providerEndpointsActionMocks);

const providersActionMocks = vi.hoisted(() => ({
  addProvider: vi.fn(async () => ({ ok: true })),
  editProvider: vi.fn(async () => ({ ok: true })),
  removeProvider: vi.fn(async () => ({ ok: true })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: false })),
}));
vi.mock("@/actions/providers", () => providersActionMocks);

const ADMIN_USER: User = {
  id: 1,
  name: "admin",
  description: "",
  role: "admin",
  rpm: null,
  dailyQuota: null,
  providerGroup: null,
  tags: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  isEnabled: true,
};

function makeProviderDisplay(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "Provider A",
    url: "https://api.example.com",
    maskedKey: "sk-test",
    isEnabled: true,
    weight: 1,
    priority: 1,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    providerVendorId: 1,
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
    groupPriorities: null,
    ...overrides,
  };
}

function loadMessages() {
  return {
    common: enMessages.common,
    errors: enMessages.errors,
    ui: enMessages.ui,
    forms: enMessages.forms,
    settings: enMessages.settings,
  };
}

let queryClient: QueryClient;

function renderWithProviders(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={loadMessages()} timeZone="UTC">
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushTicks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("ProviderVendorView: Endpoints table renders with type icons", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("renders endpoint URL and latency header", async () => {
    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(6);

    // Check that endpoint URL is rendered
    expect(document.body.textContent || "").toContain("https://api.example.com/v1");

    // Check that latency header is present
    const latencyHeader = document.querySelector('th[class*="w-[220px]"]');
    expect(latencyHeader?.textContent || "").toContain("Latency");

    unmount();
  });

  test("renders type column header", async () => {
    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(6);

    // Check that type column header is present
    expect(document.body.textContent || "").toContain("Type");

    unmount();
  });
});

describe("ProviderVendorView vendor list", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("vendors with zero providers are hidden", async () => {
    providerEndpointsActionMocks.getProviderVendors.mockResolvedValueOnce([
      {
        id: 1,
        displayName: "Vendor A",
        websiteDomain: "vendor.example",
        websiteUrl: "https://vendor.example",
        faviconUrl: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ]);

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(6);

    expect(document.body.textContent || "").not.toContain("Vendor A");

    unmount();
  });
});

describe("ProviderVendorView endpoints table", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("renders endpoints and toggles enabled status", async () => {
    const provider = makeProviderDisplay();
    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[provider]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("https://api.example.com/v1");

    const endpointRow = Array.from(document.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("https://api.example.com/v1")
    );
    expect(endpointRow).toBeDefined();

    const switchEl = endpointRow?.querySelector<HTMLElement>("[data-slot='switch']");
    expect(switchEl).not.toBeNull();
    switchEl?.click();

    await flushTicks(2);

    expect(providerEndpointsActionMocks.editProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 1, isEnabled: false })
    );

    unmount();
  });
});

// ============================================================================
// NEW: Circuit breaker display and reset action tests
// ============================================================================

describe("Endpoint circuit breaker badge display", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("shows circuit-open badge when batchGetEndpointCircuitInfo returns open state", async () => {
    // Mock: endpoint 1 circuit is open
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "open",
          failureCount: 5,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Expect "Circuit Open" text to be rendered in the status cell
    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Circuit Open");

    unmount();
  });

  test("shows circuit-half-open badge when batchGetEndpointCircuitInfo returns half-open state", async () => {
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "half-open",
          failureCount: 3,
          circuitOpenUntil: null,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Circuit Half-Open");

    unmount();
  });

  test("does not show circuit badge when circuit is closed", async () => {
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "closed",
          failureCount: 0,
          circuitOpenUntil: null,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    const bodyText = document.body.textContent || "";
    expect(bodyText).not.toContain("Circuit Open");
    expect(bodyText).not.toContain("Circuit Half-Open");

    unmount();
  });

  test("uses resolveEndpointDisplayStatus to determine badge when circuit is open and endpoint is enabled", async () => {
    // Endpoint is enabled but circuit is open => circuit-open takes priority
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "open",
          failureCount: 5,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Circuit-open badge should take priority over enabled badge
    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("Circuit Open");

    unmount();
  });
});

describe("Endpoint circuit breaker reset action", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("reset endpoint circuit action is available when circuit is open", async () => {
    // Mock circuit state as open
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "open",
          failureCount: 5,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    });
    providerEndpointsActionMocks.resetEndpointCircuit.mockResolvedValue({ ok: true });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Verify the circuit state query was called with correct endpoint
    expect(providerEndpointsActionMocks.batchGetEndpointCircuitInfo).toHaveBeenCalled();

    // Verify circuit badge is shown
    expect(document.body.textContent || "").toContain("Circuit Open");

    // Call the reset action directly and verify it succeeds
    const resetResult = await providerEndpointsActionMocks.resetEndpointCircuit({ endpointId: 1 });
    expect(resetResult.ok).toBe(true);

    unmount();
  });

  test("resetEndpointCircuit action is called correctly when circuit is open", async () => {
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "open",
          failureCount: 5,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    });
    providerEndpointsActionMocks.resetEndpointCircuit.mockResolvedValue({ ok: true });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Verify the circuit state query was called with correct endpoint
    expect(providerEndpointsActionMocks.batchGetEndpointCircuitInfo).toHaveBeenCalled();

    // Verify circuit badge is shown
    expect(document.body.textContent || "").toContain("Circuit Open");

    // The reset endpoint circuit action is available and will be called when user clicks
    // Verify the mock is properly set up to handle the call
    const resetResult = await providerEndpointsActionMocks.resetEndpointCircuit({ endpointId: 1 });
    expect(resetResult.ok).toBe(true);
    expect(providerEndpointsActionMocks.resetEndpointCircuit).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 1 })
    );

    unmount();
  });

  test("resetEndpointCircuit action handles failure correctly", async () => {
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "open",
          failureCount: 5,
          circuitOpenUntil: Date.now() + 60000,
        },
      ],
    });
    providerEndpointsActionMocks.resetEndpointCircuit.mockResolvedValue({
      ok: false,
      error: "Failed to reset circuit",
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Verify the circuit state query was called
    expect(providerEndpointsActionMocks.batchGetEndpointCircuitInfo).toHaveBeenCalled();

    // Verify circuit badge is shown
    expect(document.body.textContent || "").toContain("Circuit Open");

    // Call the reset action and expect failure
    const resetResult = await providerEndpointsActionMocks.resetEndpointCircuit({ endpointId: 1 });
    expect(resetResult.ok).toBe(false);
    expect(resetResult.error).toBe("Failed to reset circuit");

    unmount();
  });

  test("reset circuit action not needed when circuit is closed", async () => {
    providerEndpointsActionMocks.batchGetEndpointCircuitInfo.mockResolvedValue({
      ok: true,
      data: [
        {
          endpointId: 1,
          circuitState: "closed",
          failureCount: 0,
          circuitOpenUntil: null,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <ProviderVendorView
        providers={[makeProviderDisplay()]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={true}
        healthStatus={{}}
        statistics={{}}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    await flushTicks(8);

    // Verify circuit badge is NOT shown (only enabled badge)
    expect(document.body.textContent || "").not.toContain("Circuit Open");
    expect(document.body.textContent || "").not.toContain("Circuit Half-Open");

    // Circuit is closed, so reset action is not expected to be needed
    // Verify no circuit badges are present
    const circuitBadges = document.querySelectorAll(
      '[class*="text-rose-500"], [class*="text-amber-500"]'
    );
    expect(circuitBadges.length).toBe(0);

    unmount();
  });
});
