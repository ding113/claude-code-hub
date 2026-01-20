/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ModelMultiSelect } from "@/app/[locale]/settings/providers/_components/model-multi-select";
import commonMessages from "../../../../messages/en/common.json";
import errorsMessages from "../../../../messages/en/errors.json";
import formsMessages from "../../../../messages/en/forms.json";
import settingsMessages from "../../../../messages/en/settings";
import uiMessages from "../../../../messages/en/ui.json";

const modelPricesActionMocks = vi.hoisted(() => ({
  getAvailableModelsByProviderType: vi.fn(async () => ["remote-model-1"]),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

const providersActionMocks = vi.hoisted(() => ({
  fetchUpstreamModels: vi.fn(async () => ({ ok: false })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: false })),
}));
vi.mock("@/actions/providers", () => providersActionMocks);

function loadMessages() {
  return {
    common: commonMessages,
    errors: errorsMessages,
    ui: uiMessages,
    forms: formsMessages,
    settings: settingsMessages,
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

async function flushTicks(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("ModelMultiSelect: 自定义白名单模型应可在列表中取消选中", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("已选中但不在 availableModels 的模型应出现在列表中，并可取消选中删除", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect
          providerType="claude"
          selectedModels={["custom-model-x"]}
          onChange={onChange}
        />
      </NextIntlClientProvider>
    );

    await flushTicks(5);
    expect(modelPricesActionMocks.getAvailableModelsByProviderType).toHaveBeenCalledTimes(1);

    const trigger = document.querySelector("button[role='combobox']") as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(5);

    // 回归点：custom-model-x 不在 availableModels 时仍应可见，否则用户无法单个删除
    expect(document.body.textContent || "").toContain("custom-model-x");

    const items = Array.from(document.querySelectorAll("[data-slot='command-item']"));
    const customItem =
      items.find((el) => (el.textContent || "").includes("custom-model-x")) ?? null;
    expect(customItem).toBeTruthy();

    await act(async () => {
      customItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith([]);

    unmount();
  });
});
