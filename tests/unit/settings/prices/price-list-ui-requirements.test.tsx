/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
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

describe("PriceList: UI 需求覆盖", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  test("应移除提供商列，并新增合并价格列与缓存列", () => {
    const messages = loadMessages();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 1,
        modelName: "model-id-001",
        priceData: {
          mode: "completion",
          display_name: "Model Display",
          litellm_provider: "openai",
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
          supports_prompt_caching: true,
          cache_read_input_token_cost: 0.0000001,
          cache_creation_input_token_cost: 0.00000125,
          cache_creation_input_token_cost_above_1hr: 0.000002,
        },
        source: "litellm",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={prices}
          initialTotal={prices.length}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const headers = Array.from(document.querySelectorAll("thead th")).map((el) =>
      (el.textContent || "").trim()
    );

    expect(headers).toContain("Model Name");
    expect(headers).toContain("Capabilities");
    expect(headers).toContain("Price");
    expect(headers).toContain("Cache Read ($/M)");
    expect(headers).toContain("Cache Create ($/M)");
    expect(headers).toContain("Updated At");
    expect(headers).toContain("Actions");

    expect(headers).not.toContain("Provider");
    expect(headers).not.toContain("Input Price ($/M)");
    expect(headers).not.toContain("Output Price ($/M)");

    unmount();
  });

  test("提供商应作为 badge 显示在模型名称列，且不再显示模型类型 badge", () => {
    const messages = loadMessages();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 2,
        modelName: "gpt-custom-1",
        priceData: {
          mode: "completion",
          display_name: "My GPT",
          litellm_provider: "openai",
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
        },
        source: "litellm",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={prices}
          initialTotal={prices.length}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const badges = Array.from(document.querySelectorAll('[data-slot="badge"]')).map((el) =>
      (el.textContent || "").trim()
    );
    expect(badges).toContain("openai");

    expect(badges).not.toContain("Completion");
    expect(badges).not.toContain("Image");
    expect(badges).not.toContain("Unknown");

    unmount();
  });

  test("模型 ID 点击应复制到剪贴板并提示成功", async () => {
    const messages = loadMessages();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 3,
        modelName: "model-id-to-copy",
        priceData: {
          mode: "chat",
          display_name: "Display Name",
          litellm_provider: "openai",
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
        },
        source: "litellm",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={prices}
          initialTotal={prices.length}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const copyButton = document.querySelector(
      'button[aria-label="Copy model ID"]'
    ) as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("model-id-to-copy");
    expect(sonnerMocks.toast.success).toHaveBeenCalled();
    expect(sonnerMocks.toast.error).not.toHaveBeenCalled();

    unmount();
  });

  test("复制失败时应提示错误", async () => {
    clipboardMocks.copyToClipboard.mockResolvedValueOnce(false);

    const messages = loadMessages();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const prices: ModelPrice[] = [
      {
        id: 4,
        modelName: "model-id-copy-fail",
        priceData: {
          mode: "chat",
          display_name: "Display Name",
          litellm_provider: "openai",
          input_cost_per_token: 0.000001,
          output_cost_per_token: 0.000002,
        },
        source: "litellm",
        createdAt: now,
        updatedAt: now,
      },
    ];

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PriceList
          initialPrices={prices}
          initialTotal={prices.length}
          initialPage={1}
          initialPageSize={50}
          initialSearchTerm=""
          initialSourceFilter=""
          initialLitellmProviderFilter=""
        />
      </NextIntlClientProvider>
    );

    const copyButton = document.querySelector(
      'button[aria-label="Copy model ID"]'
    ) as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("model-id-copy-fail");
    expect(sonnerMocks.toast.error).toHaveBeenCalled();

    unmount();
  });
});
