/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderEndpointHover } from "@/app/[locale]/settings/providers/_components/provider-endpoint-hover";
import type { ProviderEndpoint } from "@/types/provider";
import enMessages from "../../../../messages/en";

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children, open }: { children: ReactNode; open: boolean }) => (
    <div data-testid="tooltip" data-state={open ? "open" : "closed"}>
      {children}
    </div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-trigger">{children}</div>
  ),
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

const providerEndpointsActionMocks = vi.hoisted(() => ({
  getProviderEndpointsByVendor: vi.fn(),
  getEndpointCircuitInfo: vi.fn(),
}));

vi.mock("@/actions/provider-endpoints", () => providerEndpointsActionMocks);

function loadMessages() {
  const endpointStatus = {
    viewDetails: "View Details",
    activeEndpoints: "Active Endpoints",
    noEndpoints: "No Endpoints",
    healthy: "Healthy",
    unhealthy: "Unhealthy",
    unknown: "Unknown",
    circuitOpen: "Circuit Open",
    circuitHalfOpen: "Circuit Half-Open",
  };

  return {
    settings: {
      ...enMessages.settings,
      providers: {
        ...(enMessages.settings.providers || {}),
        endpointStatus,
      },
    },
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
    container,
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

describe("ProviderEndpointHover", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const mockEndpoints: ProviderEndpoint[] = [
    {
      id: 1,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.anthropic.com/v1",
      label: "Healthy Endpoint",
      sortOrder: 10,
      isEnabled: true,
      deletedAt: null,
      lastProbeOk: true,
      lastProbeLatencyMs: 100,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      lastProbedAt: null,
      lastOk: null,
      lastLatencyMs: null,
    },
    {
      id: 2,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.anthropic.com/v2",
      label: "Unhealthy Endpoint",
      sortOrder: 20,
      isEnabled: true,
      deletedAt: null,
      lastProbeOk: false,
      lastProbeLatencyMs: null,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      lastProbedAt: null,
      lastOk: null,
      lastLatencyMs: null,
    },
    {
      id: 3,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.anthropic.com/v3",
      label: "Unknown Endpoint",
      sortOrder: 5,
      isEnabled: true,
      deletedAt: null,
      lastProbeOk: null,
      lastProbeLatencyMs: null,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      lastProbedAt: null,
      lastOk: null,
      lastLatencyMs: null,
    },
    {
      id: 4,
      vendorId: 1,
      providerType: "openai-compatible",
      url: "https://api.openai.com",
      label: "Wrong Type",
      sortOrder: 0,
      isEnabled: true,
      deletedAt: null,
      lastProbeOk: true,
      lastProbeLatencyMs: 50,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      lastProbedAt: null,
      lastOk: null,
      lastLatencyMs: null,
    },
    {
      id: 5,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.anthropic.com/v4",
      label: "Disabled Endpoint",
      sortOrder: 0,
      isEnabled: false,
      deletedAt: null,
      lastProbeOk: true,
      lastProbeLatencyMs: 50,
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
      lastProbedAt: null,
      lastOk: null,
      lastLatencyMs: null,
    },
  ];

  test("renders trigger with correct count and filters correctly", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValue(mockEndpoints);

    const { unmount, container } = renderWithProviders(
      <ProviderEndpointHover vendorId={1} providerType="claude" />
    );

    await flushTicks();

    const triggerText = container.textContent;
    expect(triggerText).toContain("3");

    unmount();
  });

  test("sorts endpoints correctly: Healthy > Unknown > Unhealthy", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValue(mockEndpoints);

    const { unmount } = renderWithProviders(
      <ProviderEndpointHover vendorId={1} providerType="claude" />
    );

    await flushTicks();

    const tooltipContent = document.querySelector("[data-testid='tooltip-content']");
    expect(tooltipContent).not.toBeNull();

    const labels = Array.from(
      document.querySelectorAll("[data-testid='tooltip-content'] span.truncate")
    ).map((el) => el.textContent);

    expect(labels).toEqual(["Healthy Endpoint", "Unknown Endpoint", "Unhealthy Endpoint"]);

    unmount();
  });

  test("does not fetch circuit info initially (when closed)", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValue(mockEndpoints);

    const { unmount } = renderWithProviders(
      <ProviderEndpointHover vendorId={1} providerType="claude" />
    );

    await flushTicks();

    expect(providerEndpointsActionMocks.getEndpointCircuitInfo).not.toHaveBeenCalled();

    unmount();
  });
});
