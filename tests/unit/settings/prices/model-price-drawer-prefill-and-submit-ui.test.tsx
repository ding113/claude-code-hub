/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ModelPriceDrawer } from "@/app/[locale]/settings/prices/_components/model-price-drawer";
import type { ModelPrice } from "@/types/model-price";
import { loadMessages } from "./test-messages";

const modelPricesActionMocks = vi.hoisted(() => ({
  upsertSingleModelPrice: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ModelPriceDrawer: 预填充与提交", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("create 模式应支持搜索现有模型并预填充字段", async () => {
    vi.useFakeTimers();
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;

    const now = new Date("2026-01-01T00:00:00.000Z");
    const prefillModel: ModelPrice = {
      id: 100,
      modelName: "openai/gpt-test",
      priceData: {
        mode: "chat",
        display_name: "GPT Test",
        litellm_provider: "openai",
        supports_prompt_caching: true,
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
        input_cost_per_request: 0.005,
        cache_read_input_token_cost: 0.0000001,
        cache_creation_input_token_cost: 0.00000125,
        cache_creation_input_token_cost_above_1hr: 0.000002,
      },
      source: "litellm",
      createdAt: now,
      updatedAt: now,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [prefillModel], total: 1, page: 1, pageSize: 10, totalPages: 1 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ModelPriceDrawer mode="create" defaultOpen />
      </NextIntlClientProvider>
    );

    const searchInput = document.getElementById("prefill-search") as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      setReactInputValue(searchInput!, "gpt");
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(document.body.textContent).toContain("openai/gpt-test");

    const resultItem = Array.from(document.querySelectorAll('[data-slot="command-item"]')).find(
      (el) => el.textContent?.includes("openai/gpt-test")
    );
    expect(resultItem).toBeTruthy();

    await act(async () => {
      resultItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushMicrotasks();
    });

    const modelIdInput = document.getElementById("modelName") as HTMLInputElement | null;
    const displayNameInput = document.getElementById("displayName") as HTMLInputElement | null;
    const providerInput = document.getElementById("provider") as HTMLInputElement | null;

    expect(modelIdInput?.value).toBe("openai/gpt-test");
    expect(displayNameInput?.value).toBe("GPT Test");
    expect(providerInput?.value).toBe("openai");

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("预填充搜索应防抖：快速输入只触发一次请求", async () => {
    vi.useFakeTimers();
    const messages = loadMessages();
    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: { data: [], total: 0, page: 1, pageSize: 10, totalPages: 0 },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = fetchMock as any;

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ModelPriceDrawer mode="create" defaultOpen />
      </NextIntlClientProvider>
    );

    const searchInput = document.getElementById("prefill-search") as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();

    await act(async () => {
      setReactInputValue(searchInput!, "g");
      setReactInputValue(searchInput!, "gp");
      setReactInputValue(searchInput!, "gpt");
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("search=gpt");

    globalThis.fetch = originalFetch;
    unmount();
  });

  test("提交时应正确换算 $/M 到每 token，并透传按次与缓存价格字段", async () => {
    const messages = loadMessages();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ModelPriceDrawer mode="create" defaultOpen />
      </NextIntlClientProvider>
    );

    await act(async () => {
      await flushPromises();
    });

    const modelIdInput = document.getElementById("modelName") as HTMLInputElement | null;
    const displayNameInput = document.getElementById("displayName") as HTMLInputElement | null;
    const providerInput = document.getElementById("provider") as HTMLInputElement | null;
    const requestPriceInput = document.getElementById(
      "inputPricePerRequest"
    ) as HTMLInputElement | null;
    const inputPrice = document.getElementById("inputPrice") as HTMLInputElement | null;
    const outputPrice = document.getElementById("outputPrice") as HTMLInputElement | null;

    expect(modelIdInput).toBeTruthy();
    expect(displayNameInput).toBeTruthy();
    expect(providerInput).toBeTruthy();
    expect(requestPriceInput).toBeTruthy();
    expect(inputPrice).toBeTruthy();
    expect(outputPrice).toBeTruthy();

    await act(async () => {
      setReactInputValue(modelIdInput!, "custom/model-1");
      setReactInputValue(displayNameInput!, "Custom Model 1");
      setReactInputValue(providerInput!, "openai");

      setReactInputValue(requestPriceInput!, "0.005");

      setReactInputValue(inputPrice!, "2");

      setReactInputValue(outputPrice!, "4");
    });

    const cachingSwitch = document.querySelector(
      'button[aria-label="Prompt caching"]'
    ) as HTMLButtonElement | null;
    expect(cachingSwitch).toBeTruthy();

    await act(async () => {
      cachingSwitch?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    const cacheRead = document.getElementById("cacheReadPrice") as HTMLInputElement | null;
    const cacheCreate5m = document.getElementById(
      "cacheCreation5mPrice"
    ) as HTMLInputElement | null;
    const cacheCreate1h = document.getElementById(
      "cacheCreation1hPrice"
    ) as HTMLInputElement | null;

    expect(cacheRead).toBeTruthy();
    expect(cacheCreate5m).toBeTruthy();
    expect(cacheCreate1h).toBeTruthy();

    await act(async () => {
      setReactInputValue(cacheRead!, "0.2");
      setReactInputValue(cacheCreate5m!, "2.5");
      setReactInputValue(cacheCreate1h!, "4");
    });

    const submit = Array.from(document.querySelectorAll("button")).find(
      (el) => el.textContent?.trim() === "Confirm"
    );
    expect(submit).toBeTruthy();

    await act(async () => {
      await flushPromises();
      submit?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      await flushPromises();
    });

    expect(modelPricesActionMocks.upsertSingleModelPrice).toHaveBeenCalled();
    const payload = modelPricesActionMocks.upsertSingleModelPrice.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    expect(payload.modelName).toBe("custom/model-1");
    expect(payload.displayName).toBe("Custom Model 1");
    expect(payload.litellmProvider).toBe("openai");
    expect(payload.mode).toBe("chat");

    // $/M -> 每 token
    expect(payload.inputCostPerToken).toBeCloseTo(0.000002);
    expect(payload.outputCostPerToken).toBeCloseTo(0.000004);

    // 按次价格不换算
    expect(payload.inputCostPerRequest).toBeCloseTo(0.005);

    // 缓存价格 $/M -> 每 token
    expect(payload.cacheReadInputTokenCost).toBeCloseTo(0.0000002);
    expect(payload.cacheCreationInputTokenCost).toBeCloseTo(0.0000025);
    expect(payload.cacheCreationInputTokenCostAbove1hr).toBeCloseTo(0.000004);

    unmount();
  });
});
