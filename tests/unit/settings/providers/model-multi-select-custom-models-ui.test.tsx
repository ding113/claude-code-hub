/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act, useState } from "react";
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

  test("无需展开下拉框也应显示完整已选白名单，并支持直接删除与编辑", async () => {
    const messages = loadMessages();

    function StatefulHarness() {
      const [selectedModels, setSelectedModels] = useState([
        "custom-model-x",
        "claude-opus-4-5-20251001",
      ]);

      return (
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ModelMultiSelect
            providerType="claude"
            selectedModels={selectedModels}
            onChange={setSelectedModels}
          />
        </NextIntlClientProvider>
      );
    }

    const { unmount } = render(<StatefulHarness />);

    await flushTicks(5);

    expect(document.body.textContent || "").toContain("custom-model-x");
    expect(document.body.textContent || "").toContain("claude-opus-4-5-20251001");

    const removeButton = document.querySelector(
      '[data-model-remove="custom-model-x"]'
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();

    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(2);
    expect(document.body.textContent || "").not.toContain("custom-model-x");
    expect(document.body.textContent || "").toContain("claude-opus-4-5-20251001");

    const editButton = document.querySelector(
      '[data-model-edit="claude-opus-4-5-20251001"]'
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const editInput = document.querySelector(
      '[data-model-edit-input="claude-opus-4-5-20251001"]'
    ) as HTMLInputElement | null;
    expect(editInput).toBeTruthy();

    await act(async () => {
      if (editInput) {
        editInput.value = "claude-opus-4-6-latest";
        editInput.dispatchEvent(new Event("input", { bubbles: true }));
        editInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const saveButton = document.querySelector(
      '[data-model-edit-save="claude-opus-4-5-20251001"]'
    ) as HTMLButtonElement | null;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(2);
    expect(document.body.textContent || "").toContain("claude-opus-4-6-latest");
    expect(document.body.textContent || "").not.toContain("claude-opus-4-5-20251001");

    unmount();
  });

  test("下拉框应把已选模型单独置顶显示", async () => {
    const messages = loadMessages();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect
          providerType="claude"
          selectedModels={["custom-model-x"]}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    await flushTicks(5);

    const trigger = document.querySelector("button[role='combobox']") as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(5);

    expect(document.body.textContent || "").toContain("Selected Models");
    expect(document.querySelector('[data-model-group="selected"]')).toBeTruthy();
    expect(document.querySelector('[data-model-group="available"]')).toBeTruthy();

    unmount();
  });
});
