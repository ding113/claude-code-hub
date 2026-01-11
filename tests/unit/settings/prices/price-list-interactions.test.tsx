/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PriceList } from "@/app/[locale]/settings/prices/_components/price-list";
import type { ModelPrice } from "@/types/model-price";
import { loadMessages } from "./test-messages";

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(async () => true),
  isClipboardSupported: vi.fn(() => true),
}));
vi.mock("@/lib/utils/clipboard", () => clipboardMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

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

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("PriceList: 交互与数据刷新", () => {
  const messages = loadMessages();
  const now = new Date("2026-01-01T00:00:00.000Z");

  const baseModel: ModelPrice = {
    id: 1,
    modelName: "base-model",
    priceData: {
      mode: "chat",
      display_name: "Base Model",
      litellm_provider: "openai",
      input_cost_per_token: 0.000001,
      output_cost_per_token: 0.000002,
      supports_prompt_caching: false,
    },
    source: "litellm",
    createdAt: now,
    updatedAt: now,
  };

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "http://localhost:3000/settings/prices");
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = originalFetch as any;
    vi.useRealTimers();
  });

  test("点击筛选按钮应触发拉取，并携带对应 query 参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [baseModel], total: 1, page: 1, pageSize: 50 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={1}
          initialPage={1}
          initialPageSize={20}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const openaiFilter = Array.from(document.querySelectorAll("button")).find((el) =>
      (el.textContent || "").includes("OpenAI")
    );
    expect(openaiFilter).toBeTruthy();

    await act(async () => {
      openaiFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();
    const firstUrl = fetchMock.mock.calls[0][0] as string;
    expect(firstUrl).toContain("litellmProvider=openai");

    await act(async () => {
      openaiFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).not.toContain("litellmProvider=openai");

    unmount();
  });

  test("点击 All 应清空筛选并触发拉取", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [baseModel], total: 1, page: 1, pageSize: 20 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={1}
          initialPage={1}
          initialPageSize={20}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter="openai"
        />
      </NextIntlClientProvider>
    );

    const allFilter = Array.from(document.querySelectorAll("button")).find((el) =>
      (el.textContent || "").trim().toLowerCase().startsWith("all")
    );
    expect(allFilter).toBeTruthy();

    await act(async () => {
      allFilter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).not.toContain("litellmProvider=openai");

    unmount();
  });

  test("分页：点击 Next 应请求下一页并更新页面数据", async () => {
    const page2Model: ModelPrice = { ...baseModel, id: 2, modelName: "page-2-model" };
    const page2 = {
      ok: true,
      data: { data: [page2Model], total: 60, page: 2, pageSize: 50 },
    };

    const fetchMock = vi.fn().mockResolvedValue({ json: async () => page2 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={60}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const nextButton = Array.from(document.querySelectorAll("button")).find((el) =>
      el.textContent?.includes("Next")
    ) as HTMLButtonElement | undefined;
    expect(nextButton).toBeTruthy();
    expect(nextButton?.disabled).toBe(false);

    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("page=2");

    expect(document.body.textContent).toContain("page-2-model");

    unmount();
  });

  test("页面大小：切换 pageSize 应重新计算页码并重新请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [baseModel], total: 60, page: 2, pageSize: 50 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={60}
          initialPage={3}
          initialPageSize={20}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const trigger = document.querySelector(
      "[data-slot='select-trigger']"
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    const option = Array.from(document.querySelectorAll("[data-slot='select-item']")).find(
      (el) => (el.textContent || "").trim() === "50"
    );
    expect(option).toBeTruthy();

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("pageSize=50");
    expect(url).toContain("page=2");

    unmount();
  });

  test("搜索：输入后防抖触发请求，且应重置到第一页", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [baseModel], total: 1, page: 1, pageSize: 50 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={1}
          initialPage={2}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const searchInput = Array.from(document.querySelectorAll("input")).find(
      (el) => (el as HTMLInputElement).placeholder === "Search model name..."
    ) as HTMLInputElement | undefined;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      setReactInputValue(searchInput!, "gpt");
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=gpt");
    expect(url).toContain("page=1");

    unmount();
  });

  test("price-data-updated 事件应触发刷新请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [baseModel], total: 1, page: 1, pageSize: 50 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={[baseModel]}
          initialTotal={1}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    await act(async () => {
      window.dispatchEvent(new Event("price-data-updated"));
      await flushPromises();
      await flushPromises();
    });

    expect(fetchMock).toHaveBeenCalled();

    unmount();
  });
});
