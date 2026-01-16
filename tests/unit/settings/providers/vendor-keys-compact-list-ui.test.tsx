/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { VendorKeysCompactList } from "@/app/[locale]/settings/providers/_components/vendor-keys-compact-list";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import enMessages from "../../../../messages/en";

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const nextNavigationMocks = vi.hoisted(() => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => nextNavigationMocks);

const providerEndpointsActionMocks = vi.hoisted(() => ({
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
}));
vi.mock("@/actions/provider-endpoints", () => providerEndpointsActionMocks);

const providersActionMocks = vi.hoisted(() => ({
  addProvider: vi.fn(async () => ({ ok: true })),
  editProvider: vi.fn(async () => ({ ok: true })),
  removeProvider: vi.fn(async () => ({ ok: true })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: true, data: { key: "sk-test" } })),
}));
vi.mock("@/actions/providers", () => providersActionMocks);

const requestFiltersActionMocks = vi.hoisted(() => ({
  getDistinctProviderGroupsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/actions/request-filters", () => requestFiltersActionMocks);

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
    name: "p",
    url: "https://api.example.com",
    maskedKey: "sk-***",
    isEnabled: true,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    providerVendorId: 1,
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    joinClaudePool: false,
    codexInstructionsStrategy: "auto",
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
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 30_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 15_000,
    streamingIdleTimeoutMs: 30_000,
    requestTimeoutNonStreamingMs: 60_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
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

function setNativeValue(element: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as unknown as { value?: unknown };
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
    return;
  }
  element.value = value;
}

describe("VendorKeysCompactList: 新增密钥不要求填写 API 地址", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    vi.clearAllMocks();
    document.body.innerHTML = "";

    const storage = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => (Object.hasOwn(store, key) ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
        key: (index: number) => Object.keys(store)[index] ?? null,
        get length() {
          return Object.keys(store).length;
        },
      };
    })();

    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
  });

  test("新增密钥对话框不显示 URL 输入与 URL 预览", async () => {
    const provider = makeProviderDisplay({
      id: 10,
      providerType: "claude",
    });

    const { unmount } = renderWithProviders(
      <VendorKeysCompactList
        vendorId={1}
        vendorWebsiteDomain="vendor.example"
        vendorWebsiteUrl="https://vendor.example"
        providers={[provider]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={false}
      />
    );

    const addButton = Array.from(document.querySelectorAll("button")).find((btn) =>
      (btn.textContent || "").includes("Add API Key")
    ) as HTMLButtonElement | undefined;
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(8);

    const nameInput = document.getElementById("name") as HTMLInputElement | null;
    const keyInput = document.getElementById("key") as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(keyInput).toBeTruthy();

    // 不显示 URL 输入
    expect(document.getElementById("url")).toBeNull();

    // 不显示官网输入
    expect(document.getElementById("website-url")).toBeNull();

    // 不显示 UrlPreview 的拼接预览
    expect(document.body.textContent || "").not.toContain("URL Concatenation Preview");

    unmount();
  });

  test("提交新增密钥应调用 addProvider，且 url 来自端点列表", async () => {
    const provider = makeProviderDisplay({
      id: 10,
      providerType: "claude",
    });

    const { unmount } = renderWithProviders(
      <VendorKeysCompactList
        vendorId={1}
        vendorWebsiteDomain="vendor.example"
        vendorWebsiteUrl="https://vendor.example"
        providers={[provider]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={false}
      />
    );

    const addButton = Array.from(document.querySelectorAll("button")).find((btn) =>
      (btn.textContent || "").includes("Add API Key")
    ) as HTMLButtonElement | undefined;
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(10);

    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalled();
    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    const keyInput = document.getElementById("key") as HTMLInputElement | null;
    expect(keyInput).toBeTruthy();

    await act(async () => {
      if (!keyInput) return;
      setNativeValue(keyInput, "sk-test-1234");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      keyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.body.querySelector("form") as HTMLFormElement | null;
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    for (let i = 0; i < 10; i++) {
      if (providersActionMocks.addProvider.mock.calls.length > 0) break;
      await flushTicks(1);
    }

    expect(providersActionMocks.addProvider).toHaveBeenCalledTimes(1);
    expect(providersActionMocks.addProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.example.com/v1",
        key: "sk-test-1234",
        provider_type: "claude",
        website_url: "https://vendor.example",
        name: "vendor.example-claude",
      })
    );

    unmount();
  });

  test("列表应显示名称/指标列，并提供编辑按钮", async () => {
    const provider = makeProviderDisplay({
      id: 10,
      name: "VendorKey-1",
      providerType: "claude",
      priority: 3,
      weight: 10,
      costMultiplier: 1.5,
      todayCallCount: 2,
      todayTotalCostUsd: "0.12",
    });

    const statistics: ProviderStatisticsMap = {
      10: {
        todayCalls: 2,
        todayCost: "0.12",
        lastCallTime: null,
        lastCallModel: null,
      },
    };

    const { unmount } = renderWithProviders(
      <VendorKeysCompactList
        vendorId={1}
        vendorWebsiteDomain="vendor.example"
        vendorWebsiteUrl="https://vendor.example"
        providers={[provider]}
        currentUser={ADMIN_USER}
        enableMultiProviderTypes={false}
        statistics={statistics}
        statisticsLoading={false}
        currencyCode="USD"
      />
    );

    expect(document.body.textContent || "").toContain("VendorKey-1");
    expect(document.body.textContent || "").toContain("Priority");
    expect(document.body.textContent || "").toContain("Weight");

    const editButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit Provider"]')
    );
    expect(editButtons.length).toBeGreaterThan(0);

    unmount();
  });
});
