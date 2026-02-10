/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ProviderEndpointsTable,
  AddEndpointButton,
  ProviderEndpointsSection,
} from "@/app/[locale]/settings/providers/_components/provider-endpoints-table";
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

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const providerEndpointsActionMocks = vi.hoisted(() => ({
  addProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  editProviderEndpoint: vi.fn(async () => ({ ok: true, data: { endpoint: {} } })),
  getProviderEndpointProbeLogs: vi.fn(async () => ({ ok: true, data: { logs: [] } })),
  getProviderEndpoints: vi.fn(async () => [
    {
      id: 1,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.claude.example.com/v1",
      label: null as string | null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeLatencyMs: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]),
  getProviderEndpointsByVendor: vi.fn(async () => [
    {
      id: 1,
      vendorId: 1,
      providerType: "claude",
      url: "https://api.claude.example.com/v1",
      label: null as string | null,
      sortOrder: 0,
      isEnabled: true,
      lastProbedAt: null,
      lastProbeOk: null,
      lastProbeLatencyMs: null,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
    {
      id: 2,
      vendorId: 1,
      providerType: "openai-compatible",
      url: "https://api.openai.example.com/v1",
      label: null as string | null,
      sortOrder: 0,
      isEnabled: false,
      lastProbedAt: "2026-01-01T12:00:00Z",
      lastProbeOk: true,
      lastProbeLatencyMs: 150,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ]),
  getProviderVendors: vi.fn(async () => []),
  probeProviderEndpoint: vi.fn(async () => ({ ok: true, data: { result: { ok: true } } })),
  removeProviderEndpoint: vi.fn(async () => ({ ok: true })),
  removeProviderVendor: vi.fn(async () => ({ ok: true })),
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

describe("ProviderEndpointsTable", () => {
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

  test("renders endpoints from getProviderEndpointsByVendor when no providerType filter", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    expect(providerEndpointsActionMocks.getProviderEndpointsByVendor).toHaveBeenCalledWith({
      vendorId: 1,
    });
    expect(document.body.textContent || "").toContain("https://api.claude.example.com/v1");
    expect(document.body.textContent || "").toContain("https://api.openai.example.com/v1");

    unmount();
  });

  test("renders endpoints from getProviderEndpoints when providerType filter is set", async () => {
    const { unmount } = renderWithProviders(
      <ProviderEndpointsTable vendorId={1} providerType="claude" />
    );

    await flushTicks(6);

    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    unmount();
  });

  test("hides type column when hideTypeColumn is true", async () => {
    const { unmount } = renderWithProviders(
      <ProviderEndpointsTable vendorId={1} hideTypeColumn={true} />
    );

    await flushTicks(6);

    const headers = Array.from(document.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).not.toContain("Type");

    unmount();
  });

  test("shows type column by default", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("Type");

    unmount();
  });

  test("hides actions column in readOnly mode", async () => {
    const { unmount } = renderWithProviders(
      <ProviderEndpointsTable vendorId={1} readOnly={true} />
    );

    await flushTicks(6);

    const headers = Array.from(document.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).not.toContain("Actions");

    const switchElements = document.querySelectorAll("[data-slot='switch']");
    expect(switchElements.length).toBe(0);

    unmount();
  });

  test("shows actions column by default", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("Actions");

    unmount();
  });

  test("toggle switch calls editProviderEndpoint", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    const endpointRow = Array.from(document.querySelectorAll("tr")).find((row) =>
      row.textContent?.includes("https://api.claude.example.com/v1")
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

  test("probe button calls probeProviderEndpoint", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    const probeButtons = document.querySelectorAll("button");
    const probeButton = Array.from(probeButtons).find((btn) =>
      btn.querySelector("svg.lucide-play")
    );
    expect(probeButton).toBeDefined();

    probeButton?.click();
    await flushTicks(2);

    expect(providerEndpointsActionMocks.probeProviderEndpoint).toHaveBeenCalledWith({
      endpointId: 1,
    });

    unmount();
  });

  test("shows empty state when no endpoints", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValueOnce([]);

    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("No endpoints");

    unmount();
  });

  test("displays enabled/disabled badge correctly", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("enabled");
    expect(document.body.textContent || "").toContain("disabled");

    unmount();
  });

  test("edit dialog submits with label, sortOrder, and isEnabled", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValueOnce([
      {
        id: 10,
        vendorId: 1,
        providerType: "claude",
        url: "https://original.example.com/v1",
        label: "Original Label",
        sortOrder: 3,
        isEnabled: true,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeLatencyMs: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ]);

    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    const editButtons = document.querySelectorAll("button");
    const editButton = Array.from(editButtons).find((btn) => btn.querySelector("svg.lucide-pen"));
    expect(editButton).toBeDefined();

    act(() => {
      editButton?.click();
    });

    await flushTicks(4);

    const urlInput = document.querySelector<HTMLInputElement>('input[name="url"]');
    const labelInput = document.querySelector<HTMLInputElement>('input[name="label"]');
    const sortOrderInput = document.querySelector<HTMLInputElement>('input[name="sortOrder"]');

    expect(urlInput?.value).toBe("https://original.example.com/v1");
    expect(labelInput?.value).toBe("Original Label");
    expect(sortOrderInput?.value).toBe("3");

    act(() => {
      if (urlInput) {
        urlInput.value = "https://updated.example.com/v1";
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (labelInput) {
        labelInput.value = "Updated Label";
        labelInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (sortOrderInput) {
        sortOrderInput.value = "10";
        sortOrderInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(providerEndpointsActionMocks.editProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 10,
        url: "https://updated.example.com/v1",
        label: "Updated Label",
        sortOrder: 10,
        isEnabled: true,
      })
    );

    unmount();
  });

  test("edit dialog shows ONLY success toast on success", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValueOnce([
      {
        id: 11,
        vendorId: 1,
        providerType: "claude",
        url: "https://original.example.com/v1",
        label: null,
        sortOrder: 0,
        isEnabled: true,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeLatencyMs: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ]);

    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    const editButtons = document.querySelectorAll("button");
    const editButton = Array.from(editButtons).find((btn) => btn.querySelector("svg.lucide-pen"));
    expect(editButton).toBeDefined();

    act(() => {
      editButton?.click();
    });

    await flushTicks(4);

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(sonnerMocks.toast.success).toHaveBeenCalledTimes(1);
    expect(sonnerMocks.toast.error).toHaveBeenCalledTimes(0);

    unmount();
  });

  test("edit dialog shows ONLY error toast on failure", async () => {
    providerEndpointsActionMocks.getProviderEndpointsByVendor.mockResolvedValueOnce([
      {
        id: 12,
        vendorId: 1,
        providerType: "claude",
        url: "https://original.example.com/v1",
        label: null,
        sortOrder: 0,
        isEnabled: true,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeLatencyMs: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ]);

    providerEndpointsActionMocks.editProviderEndpoint.mockResolvedValueOnce({
      ok: false,
      error: "Update failed",
      errorCode: "UPDATE_FAILED",
    } as any);

    const { unmount } = renderWithProviders(<ProviderEndpointsTable vendorId={1} />);

    await flushTicks(6);

    const editButtons = document.querySelectorAll("button");
    const editButton = Array.from(editButtons).find((btn) => btn.querySelector("svg.lucide-pen"));
    expect(editButton).toBeDefined();

    act(() => {
      editButton?.click();
    });

    await flushTicks(4);

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(sonnerMocks.toast.success).toHaveBeenCalledTimes(0);
    expect(sonnerMocks.toast.error).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe("AddEndpointButton", () => {
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

  test("renders add button", async () => {
    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    expect(document.body.textContent || "").toContain("Add Endpoint");

    unmount();
  });

  test("opens dialog on click", async () => {
    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    const addButton = document.querySelector("button");
    addButton?.click();

    await flushTicks(2);

    expect(document.body.textContent || "").toContain("URL");

    unmount();
  });

  test("shows type selector when no fixed providerType", async () => {
    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    const addButton = document.querySelector("button");
    addButton?.click();

    await flushTicks(2);

    expect(document.body.textContent || "").toContain("Type");

    unmount();
  });

  test("hides type selector when providerType is fixed", async () => {
    const { unmount } = renderWithProviders(
      <AddEndpointButton vendorId={1} providerType="claude" />
    );

    await flushTicks(2);

    const addButton = document.querySelector("button");
    addButton?.click();

    await flushTicks(2);

    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    const hasTypeLabel = labels.some((l) => l === "Type");
    expect(hasTypeLabel).toBe(false);

    unmount();
  });

  test("submits with label, sortOrder, and isEnabled fields", async () => {
    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    const addButton = document.querySelector("button");
    act(() => {
      addButton?.click();
    });

    await flushTicks(2);

    const urlInput = document.querySelector<HTMLInputElement>('input[name="url"]');
    const labelInput = document.querySelector<HTMLInputElement>('input[name="label"]');
    const sortOrderInput = document.querySelector<HTMLInputElement>('input[name="sortOrder"]');

    act(() => {
      if (urlInput) {
        urlInput.value = "https://test.example.com/v1";
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (labelInput) {
        labelInput.value = "Test Label";
        labelInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (sortOrderInput) {
        sortOrderInput.value = "5";
        sortOrderInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(providerEndpointsActionMocks.addProviderEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 1,
        url: "https://test.example.com/v1",
        label: "Test Label",
        sortOrder: 5,
        isEnabled: true,
      })
    );

    unmount();
  });

  test("should show ONLY success toast on success", async () => {
    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    const addButton = document.querySelector("button");
    act(() => {
      addButton?.click();
    });

    await flushTicks(2);

    const urlInput = document.querySelector<HTMLInputElement>('input[name="url"]');
    act(() => {
      if (urlInput) {
        urlInput.value = "https://test.example.com/v1";
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(sonnerMocks.toast.success).toHaveBeenCalledTimes(1);
    expect(sonnerMocks.toast.error).toHaveBeenCalledTimes(0);

    unmount();
  });

  test("should show ONLY error toast on failure", async () => {
    providerEndpointsActionMocks.addProviderEndpoint.mockResolvedValueOnce({
      ok: false,
      error: "Some error",
      errorCode: "CREATE_FAILED",
    } as any);

    const { unmount } = renderWithProviders(<AddEndpointButton vendorId={1} />);

    await flushTicks(2);

    const addButton = document.querySelector("button");
    act(() => {
      addButton?.click();
    });

    await flushTicks(2);

    const urlInput = document.querySelector<HTMLInputElement>('input[name="url"]');
    act(() => {
      if (urlInput) {
        urlInput.value = "https://test.example.com/v1";
        urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const form = document.querySelector("form");
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    await flushTicks(4);

    expect(sonnerMocks.toast.success).toHaveBeenCalledTimes(0);
    expect(sonnerMocks.toast.error).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe("ProviderEndpointsSection", () => {
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

  test("renders section header with endpoints label", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsSection vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("Endpoints");

    unmount();
  });

  test("renders add button in section header", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsSection vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("Add Endpoint");

    unmount();
  });

  test("hides add button in readOnly mode", async () => {
    const { unmount } = renderWithProviders(
      <ProviderEndpointsSection vendorId={1} readOnly={true} />
    );

    await flushTicks(6);

    expect(document.body.textContent || "").not.toContain("Add Endpoint");

    unmount();
  });

  test("renders table with endpoints", async () => {
    const { unmount } = renderWithProviders(<ProviderEndpointsSection vendorId={1} />);

    await flushTicks(6);

    expect(document.body.textContent || "").toContain("https://api.claude.example.com/v1");

    unmount();
  });

  test("passes providerType filter to table", async () => {
    const { unmount } = renderWithProviders(
      <ProviderEndpointsSection vendorId={1} providerType="claude" />
    );

    await flushTicks(6);

    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    unmount();
  });
});
