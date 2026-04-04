/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ModelRedirectEditor } from "@/app/[locale]/settings/providers/_components/model-redirect-editor";
import type { ProviderModelRedirectRule } from "@/types/provider";
import commonMessages from "../../../../messages/en/common.json";
import errorsMessages from "../../../../messages/en/errors.json";
import formsMessages from "../../../../messages/en/forms.json";
import settingsMessages from "../../../../messages/en/settings";
import uiMessages from "../../../../messages/en/ui.json";

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

describe("ModelRedirectEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("编辑中的规则在前一条被删除后仍应保存到原规则，而不是错位到其他行", async () => {
    const messages = loadMessages();

    const initialRules: ProviderModelRedirectRule[] = [
      { matchType: "exact", source: "model-a", target: "target-a" },
      { matchType: "prefix", source: "model-b", target: "target-b" },
    ];

    function StatefulHarness() {
      const [rules, setRules] = useState(initialRules);

      return (
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ModelRedirectEditor value={rules} onChange={setRules} />
        </NextIntlClientProvider>
      );
    }

    const { unmount } = render(<StatefulHarness />);

    await flushTicks(3);

    const editButton = document.querySelector(
      '[data-redirect-edit="prefix:model-b"]'
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const editSourceInput = document.querySelector(
      '[data-redirect-edit-source="prefix:model-b"]'
    ) as HTMLInputElement | null;
    expect(editSourceInput).toBeTruthy();

    await act(async () => {
      if (editSourceInput) {
        editSourceInput.value = "model-b-updated";
        editSourceInput.dispatchEvent(new Event("input", { bubbles: true }));
        editSourceInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const removeFirstButton = document.querySelector(
      '[data-redirect-remove="exact:model-a"]'
    ) as HTMLButtonElement | null;
    expect(removeFirstButton).toBeTruthy();

    await act(async () => {
      removeFirstButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = document.querySelector(
      '[data-redirect-save="prefix:model-b"]'
    ) as HTMLButtonElement | null;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(2);

    expect(document.body.textContent || "").toContain("model-b-updated");
    expect(document.body.textContent || "").not.toContain("target-a");

    unmount();
  });

  test("新增规则时应在本地拦截超长 source，避免直到提交 provider 才失败", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelRedirectEditor value={[]} onChange={onChange} />
      </NextIntlClientProvider>
    );

    const sourceInput = document.querySelector("#new-source") as HTMLInputElement | null;
    const targetInput = document.querySelector("#new-target") as HTMLInputElement | null;
    expect(sourceInput).toBeTruthy();
    expect(targetInput).toBeTruthy();

    await act(async () => {
      if (sourceInput) {
        sourceInput.value = "a".repeat(256);
        sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
        sourceInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (targetInput) {
        targetInput.value = "glm-4.6";
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
        targetInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const addButton = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").includes("Add")
    );
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.textContent || "").toContain("Source model name is too long");

    unmount();
  });
});
