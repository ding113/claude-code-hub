/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Dialog } from "@/components/ui/dialog";
import { ProviderForm } from "@/app/[locale]/settings/providers/_components/forms/provider-form";

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
}));
vi.mock("@/actions/providers", () => providersActionMocks);

const requestFiltersActionMocks = vi.hoisted(() => ({
  getDistinctProviderGroupsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/actions/request-filters", () => requestFiltersActionMocks);

function loadMessages() {
  const base = path.join(process.cwd(), "messages/en");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    common: read("common.json"),
    errors: read("errors.json"),
    ui: read("ui.json"),
    forms: read("forms.json"),
    settings: read("settings.json"),
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
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

describe("ProviderForm: 编辑时应支持提交总消费上限(limit_total_usd)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // happy-dom 在部分运行时可能不会提供完整的 Storage 实现，这里做最小 mock，避免组件读写报错
    // 仅用于本测试文件，避免污染全局行为
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

    storage.setItem("provider-form-sections", JSON.stringify({ rateLimit: true }));
  });

  test("填写总消费上限后提交应调用 editProvider 且 payload 携带 limit_total_usd", async () => {
    const messages = loadMessages();

    const provider = {
      id: 1,
      name: "p",
      url: "https://example.com",
      maskedKey: "xxxxxx",
      isEnabled: true,
      weight: 1,
      priority: 0,
      costMultiplier: 1,
      groupTag: null,
      providerType: "claude",
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
      limitConcurrentSessions: 0,
      maxRetryAttempts: null,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerOpenDuration: 1800000,
      circuitBreakerHalfOpenSuccessThreshold: 2,
      proxyUrl: null,
      proxyFallbackToDirect: false,
      firstByteTimeoutStreamingMs: 0,
      streamingIdleTimeoutMs: 0,
      requestTimeoutNonStreamingMs: 0,
      websiteUrl: null,
      faviconUrl: null,
      cacheTtlPreference: null,
      context1mPreference: null,
      tpm: null,
      rpm: null,
      rpd: null,
      cc: null,
      createdAt: "2026-01-04",
      updatedAt: "2026-01-04",
    } as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <ProviderForm mode="edit" provider={provider} enableMultiProviderTypes />
        </Dialog>
      </NextIntlClientProvider>
    );

    // 等待 useEffect 从 localStorage 打开折叠区域
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const totalInput = document.getElementById("edit-limit-total") as HTMLInputElement | null;
    expect(totalInput).toBeTruthy();

    await act(async () => {
      if (!totalInput) return;
      setNativeValue(totalInput, "10.5");
      totalInput.dispatchEvent(new Event("input", { bubbles: true }));
      totalInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.body.querySelector("form") as HTMLFormElement | null;
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // React 的 transition 可能会延后调度，这里给一个很小的等待窗口，避免测试偶发抢跑
    for (let i = 0; i < 5; i++) {
      if (providersActionMocks.editProvider.mock.calls.length > 0) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(providersActionMocks.editProvider).toHaveBeenCalledTimes(1);
    const [, payload] = providersActionMocks.editProvider.mock.calls[0] as [number, any];
    expect(Object.hasOwn(payload, "limit_total_usd")).toBe(true);
    expect(payload.limit_total_usd).toBe(10.5);

    unmount();
  });
});

describe("ProviderForm: 新增成功后应重置总消费上限输入", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

    storage.setItem("provider-form-sections", JSON.stringify({ rateLimit: true }));
  });

  test("提交新增后应清空 limit_total_usd，避免连续添加沿用上一次输入", async () => {
    const messages = loadMessages();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <Dialog open onOpenChange={() => {}}>
          <ProviderForm mode="create" enableMultiProviderTypes />
        </Dialog>
      </NextIntlClientProvider>
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const nameInput = document.getElementById("name") as HTMLInputElement | null;
    const urlInput = document.getElementById("url") as HTMLInputElement | null;
    const keyInput = document.getElementById("key") as HTMLInputElement | null;
    expect(nameInput).toBeTruthy();
    expect(urlInput).toBeTruthy();
    expect(keyInput).toBeTruthy();

    await act(async () => {
      if (!nameInput || !urlInput || !keyInput) return;
      setNativeValue(nameInput, "p2");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(urlInput, "https://example.com");
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
      urlInput.dispatchEvent(new Event("change", { bubbles: true }));

      setNativeValue(keyInput, "k");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
      keyInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const totalInput = document.getElementById("limit-total") as HTMLInputElement | null;
    expect(totalInput).toBeTruthy();

    await act(async () => {
      if (!totalInput) return;
      setNativeValue(totalInput, "10.5");
      totalInput.dispatchEvent(new Event("input", { bubbles: true }));
      totalInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = document.body.querySelector("form") as HTMLFormElement | null;
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    for (let i = 0; i < 5; i++) {
      if (providersActionMocks.addProvider.mock.calls.length > 0) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }

    expect(providersActionMocks.addProvider).toHaveBeenCalledTimes(1);
    const [payload] = providersActionMocks.addProvider.mock.calls[0] as [any];
    expect(payload.limit_total_usd).toBe(10.5);

    // 等待一次调度，让 React 处理新增成功后的 state 重置
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // 成功后应清空输入（state -> null -> input value 变为空字符串）
    expect((document.getElementById("limit-total") as HTMLInputElement | null)?.value ?? null).toBe(
      ""
    );

    unmount();
  });
});
