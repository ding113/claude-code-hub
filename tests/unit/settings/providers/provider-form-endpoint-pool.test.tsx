/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ProviderForm } from "../../../../src/app/[locale]/settings/providers/_components/forms/provider-form";
import { Dialog } from "../../../../src/components/ui/dialog";
import enMessages from "../../../../messages/en";
import type { ProviderEndpoint, ProviderVendor } from "../../../../src/types/provider";

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const providersActionMocks = vi.hoisted(() => ({
  addProvider: vi.fn(async () => ({ ok: true })),
  editProvider: vi.fn(async () => ({ ok: true })),
  removeProvider: vi.fn(async () => ({ ok: true })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: true, data: { key: "test-key" } })),
  getProviderTestPresets: vi.fn(async () => ({ ok: true, data: [] })),
  getModelSuggestionsByProviderGroup: vi.fn(async () => []),
  fetchUpstreamModels: vi.fn(async () => ({ ok: true, data: { models: [] } })),
}));
vi.mock("@/actions/providers", () => providersActionMocks);

const requestFiltersActionMocks = vi.hoisted(() => ({
  getDistinctProviderGroupsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/actions/request-filters", () => requestFiltersActionMocks);

const modelPricesActionMocks = vi.hoisted(() => ({
  getAvailableModelsByProviderType: vi.fn(async () => []),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

const providerEndpointsActionMocks = vi.hoisted(() => ({
  getProviderVendors: vi.fn(async (): Promise<ProviderVendor[]> => []),
  getProviderEndpoints: vi.fn(async (): Promise<ProviderEndpoint[]> => []),
  getProviderEndpointsByVendor: vi.fn(async (): Promise<ProviderEndpoint[]> => []),
  addProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  editProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  probeProviderEndpoint: vi.fn(async () => ({
    ok: true,
    data: { endpoint: {}, result: { ok: true } },
  })),
  removeProviderEndpoint: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/actions/provider-endpoints", () => providerEndpointsActionMocks);

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
          <Dialog open onOpenChange={() => {}}>
            {node}
          </Dialog>
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

describe("ProviderForm: endpoint pool integration", () => {
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

  test("Website URL input should render before provider URL input", async () => {
    const { unmount } = renderWithProviders(
      <ProviderForm mode="create" enableMultiProviderTypes />
    );

    await flushTicks(2);

    const websiteUrlInput = document.getElementById("website-url") as HTMLInputElement | null;
    const urlInput = document.getElementById("url") as HTMLInputElement | null;

    expect(websiteUrlInput).toBeTruthy();
    expect(urlInput).toBeTruthy();

    const relative = websiteUrlInput?.compareDocumentPosition(urlInput as Node) ?? 0;
    expect((relative & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);

    unmount();
  });

  test("When vendor resolves and endpoints exist, should show endpoint pool and hide URL input", async () => {
    providerEndpointsActionMocks.getProviderVendors.mockResolvedValueOnce([
      {
        id: 1,
        websiteDomain: "example.com",
        displayName: "Example",
        websiteUrl: "https://example.com",
        faviconUrl: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      },
    ]);
    providerEndpointsActionMocks.getProviderEndpoints.mockResolvedValueOnce([
      {
        id: 10,
        vendorId: 1,
        providerType: "claude",
        url: "https://api.example.com/v1",
        label: null,
        sortOrder: 0,
        isEnabled: true,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeStatusCode: null,
        lastProbeLatencyMs: null,
        lastProbeErrorType: null,
        lastProbeErrorMessage: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        deletedAt: null,
      },
    ]);

    const { unmount } = renderWithProviders(
      <ProviderForm mode="create" enableMultiProviderTypes />
    );

    await flushTicks(2);

    const websiteUrlInput = document.getElementById("website-url") as HTMLInputElement | null;
    expect(websiteUrlInput).toBeTruthy();

    await act(async () => {
      if (!websiteUrlInput) return;
      setNativeValue(websiteUrlInput, "https://example.com");
      websiteUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      websiteUrlInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await flushTicks(6);

    expect(document.getElementById("url")).toBeNull();
    expect(document.body.textContent || "").toContain("Endpoints");
    expect(document.body.textContent || "").toContain("Add Endpoint");

    unmount();
  });

  test("When vendor cannot be resolved, should show URL input and block submit without valid URL", async () => {
    const { unmount } = renderWithProviders(
      <ProviderForm mode="create" enableMultiProviderTypes />
    );

    await flushTicks(2);

    const nameInput = document.getElementById("name") as HTMLInputElement | null;
    const keyInput = document.getElementById("key") as HTMLInputElement | null;
    const urlInput = document.getElementById("url") as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(keyInput).toBeTruthy();
    expect(urlInput).toBeTruthy();

    await act(async () => {
      if (!nameInput || !keyInput) return;
      setNativeValue(nameInput, "p1");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(keyInput, "k");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      keyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.body.querySelector("form") as HTMLFormElement | null;
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(3);

    expect(providersActionMocks.addProvider).toHaveBeenCalledTimes(0);
    expect(sonnerMocks.toast.error).toHaveBeenCalled();

    unmount();
  });

  test("When vendor cannot be resolved but URL provided, should call addProvider", async () => {
    providerEndpointsActionMocks.getProviderVendors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 99,
          websiteDomain: "example.com",
          displayName: "Example",
          websiteUrl: "https://example.com",
          faviconUrl: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
      ]);

    const { unmount } = renderWithProviders(
      <ProviderForm mode="create" enableMultiProviderTypes />
    );

    await flushTicks(2);

    const nameInput = document.getElementById("name") as HTMLInputElement | null;
    const websiteUrlInput = document.getElementById("website-url") as HTMLInputElement | null;
    const urlInput = document.getElementById("url") as HTMLInputElement | null;
    const keyInput = document.getElementById("key") as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(websiteUrlInput).toBeTruthy();
    expect(urlInput).toBeTruthy();
    expect(keyInput).toBeTruthy();

    await act(async () => {
      if (!nameInput || !websiteUrlInput || !urlInput || !keyInput) return;
      setNativeValue(nameInput, "p2");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(websiteUrlInput, "https://example.com");
      websiteUrlInput.dispatchEvent(new Event("input", { bubbles: true }));
      websiteUrlInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(urlInput, "https://api.example.com/v1");
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      urlInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(keyInput, "k");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      keyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.body.querySelector("form") as HTMLFormElement | null;
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    for (let i = 0; i < 8; i++) {
      if (providersActionMocks.addProvider.mock.calls.length > 0) break;
      await flushTicks(1);
    }

    expect(providersActionMocks.addProvider).toHaveBeenCalledTimes(1);

    await flushTicks(3);
    expect(providerEndpointsActionMocks.addProviderEndpoint).toHaveBeenCalledTimes(0);

    unmount();
  });
});
