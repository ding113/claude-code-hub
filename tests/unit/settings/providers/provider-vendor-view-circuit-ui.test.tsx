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
import type { User } from "@/types/user";
import enMessages from "../../../../messages/en";

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
  getProviderEndpoints: vi.fn(async () => [
    {
      id: 1,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.example.com/v1",
      label: null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastOk: null,
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
  getVendorTypeCircuitInfo: vi.fn(async () => ({
    ok: true,
    data: {
      vendorId: 1,
      providerType: "claude",
      circuitState: "open",
      circuitOpenUntil: null,
      lastFailureTime: null,
      manualOpen: false,
    },
  })),
  probeProviderEndpoint: vi.fn(async () => ({ ok: true, data: { result: { ok: true } } })),
  removeProviderEndpoint: vi.fn(async () => ({ ok: true })),
  removeProviderVendor: vi.fn(async () => ({ ok: true })),
  resetVendorTypeCircuit: vi.fn(async () => ({ ok: true })),
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

describe("ProviderVendorView: VendorTypeCircuitControl 仅在熔断时展示关闭按钮", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("circuitState=open 时显示 Close Circuit，且不显示 Manually Open Circuit", async () => {
    providerEndpointsActionMocks.getVendorTypeCircuitInfo.mockResolvedValueOnce({
      ok: true,
      data: {
        vendorId: 1,
        providerType: "claude",
        circuitState: "open",
        circuitOpenUntil: null,
        lastFailureTime: null,
        manualOpen: false,
      },
    });

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

    expect(document.body.textContent || "").toContain("Close Circuit");
    expect(document.body.textContent || "").not.toContain("Manually Open Circuit");
    // Check that provider type tabs are rendered
    expect(document.body.textContent || "").toContain("Gemini");
    expect(document.body.textContent || "").toContain("Claude");

    const latencyHeader = document.querySelector('th[class*="w-[220px]"]');
    expect(latencyHeader?.textContent || "").toContain("Latency");

    unmount();
  });

  test("circuitState=closed 时不显示 Close Circuit，也不显示 Manually Open Circuit", async () => {
    providerEndpointsActionMocks.getVendorTypeCircuitInfo.mockResolvedValueOnce({
      ok: true,
      data: {
        vendorId: 1,
        providerType: "claude",
        circuitState: "closed",
        circuitOpenUntil: null,
        lastFailureTime: null,
        manualOpen: false,
      },
    });

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

    expect(document.body.textContent || "").not.toContain("Close Circuit");
    expect(document.body.textContent || "").not.toContain("Manually Open Circuit");
    // Check that provider type tabs are rendered
    expect(document.body.textContent || "").toContain("Gemini");
    expect(document.body.textContent || "").toContain("Claude");

    const latencyHeader = document.querySelector('th[class*="w-[220px]"]');
    expect(latencyHeader?.textContent || "").toContain("Latency");

    unmount();
  });
});
