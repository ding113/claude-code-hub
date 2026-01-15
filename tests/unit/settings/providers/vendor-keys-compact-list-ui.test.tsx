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
import enMessages from "../../../../messages/en";

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

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
  });

  test("新增密钥对话框不显示 URL 输入与 URL 预览", async () => {
    const provider = {
      id: 10,
      name: "p",
      providerType: "claude",
      maskedKey: "sk-***",
      isEnabled: true,
    } as any;

    const { unmount } = renderWithProviders(
      <VendorKeysCompactList
        vendorId={1}
        vendorWebsiteDomain="vendor.example"
        vendorWebsiteUrl="https://vendor.example"
        providers={[provider]}
        currentUser={{ role: "admin" } as any}
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

    await flushTicks(5);

    const keyInput = document.getElementById("vendor-key-api-key") as HTMLInputElement | null;
    expect(keyInput).toBeTruthy();

    // 回归点：不再要求填写 API 地址
    expect(document.querySelector("input[name='url']")).toBeNull();

    // 回归点：不显示 UrlPreview 的拼接预览
    expect(document.body.textContent || "").not.toContain("URL Concatenation Preview");

    unmount();
  });

  test("提交新增密钥应调用 addProvider，且 url 来自端点列表", async () => {
    const provider = {
      id: 10,
      name: "p",
      providerType: "claude",
      maskedKey: "sk-***",
      isEnabled: true,
    } as any;

    const { unmount } = renderWithProviders(
      <VendorKeysCompactList
        vendorId={1}
        vendorWebsiteDomain="vendor.example"
        vendorWebsiteUrl="https://vendor.example"
        providers={[provider]}
        currentUser={{ role: "admin" } as any}
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

    await flushTicks(5);

    // 打开后应拉取端点列表，用于自动填充 url
    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalledTimes(1);
    expect(providerEndpointsActionMocks.getProviderEndpoints).toHaveBeenCalledWith({
      vendorId: 1,
      providerType: "claude",
    });

    const keyInput = document.getElementById("vendor-key-api-key") as HTMLInputElement | null;
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
    const [payload] = providersActionMocks.addProvider.mock.calls[0] as [any];
    expect(payload.url).toBe("https://api.example.com/v1");
    expect(payload.key).toBe("sk-test-1234");
    expect(payload.provider_type).toBe("claude");
    expect(payload.website_url).toBe("https://vendor.example");
    expect(payload.name).toBe("vendor.example-claude-1234");

    expect(sonnerMocks.toast.success).toHaveBeenCalledWith("API key added");

    unmount();
  });
});
