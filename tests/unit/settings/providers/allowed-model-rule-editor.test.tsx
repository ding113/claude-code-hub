/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AllowedModelRuleEditor } from "@/app/[locale]/settings/providers/_components/allowed-model-rule-editor";
import type { AllowedModelRule } from "@/types/provider";
import commonMessages from "../../../../messages/en/common.json";
import errorsMessages from "../../../../messages/en/errors.json";
import formsMessages from "../../../../messages/en/forms.json";
import settingsMessages from "../../../../messages/en/settings";
import uiMessages from "../../../../messages/en/ui.json";

const providerActionMocks = vi.hoisted(() => ({
  fetchUpstreamModels: vi.fn(),
  getUnmaskedProviderKey: vi.fn(),
}));

vi.mock("@/actions/providers", () => providerActionMocks);

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
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("AllowedModelRuleEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("adds a new exact allowlist rule", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AllowedModelRuleEditor value={[]} onChange={onChange} providerType="claude" />
      </NextIntlClientProvider>
    );

    const patternInput = document.querySelector(
      "#new-allowed-model-pattern"
    ) as HTMLInputElement | null;
    expect(patternInput).toBeTruthy();

    await act(async () => {
      if (patternInput) {
        patternInput.value = "claude-opus-4-1";
        patternInput.dispatchEvent(new Event("input", { bubbles: true }));
        patternInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks(2);

    const addButton = document.querySelector(
      "[data-allowed-model-add]"
    ) as HTMLButtonElement | null;
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(onChange).toHaveBeenCalledWith([{ matchType: "exact", pattern: "claude-opus-4-1" }]);

    unmount();
  });

  test("supports editing an existing rule", async () => {
    const messages = loadMessages();
    const initialRules: AllowedModelRule[] = [{ matchType: "exact", pattern: "claude-opus-4-1" }];

    function StatefulHarness() {
      const [rules, setRules] = useState(initialRules);

      return (
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <AllowedModelRuleEditor value={rules} onChange={setRules} providerType="claude" />
        </NextIntlClientProvider>
      );
    }

    const { unmount } = render(<StatefulHarness />);
    await flushTicks(2);

    const editButton = document.querySelector(
      '[data-allowed-model-edit="exact:claude-opus-4-1"]'
    ) as HTMLButtonElement | null;
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(2);

    const editInput = document.querySelector(
      '[data-allowed-model-edit-pattern="exact:claude-opus-4-1"]'
    ) as HTMLInputElement | null;
    expect(editInput).toBeTruthy();

    await act(async () => {
      if (editInput) {
        editInput.value = "claude-opus-4-2";
        editInput.dispatchEvent(new Event("input", { bubbles: true }));
        editInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks(2);

    const saveButton = document.querySelector(
      '[data-allowed-model-save="exact:claude-opus-4-1"]'
    ) as HTMLButtonElement | null;
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(4);

    expect(document.body.textContent || "").toContain("claude-opus-4-2");
    expect(document.body.textContent || "").not.toContain("claude-opus-4-1");

    unmount();
  });

  test("quick add imports upstream models as exact rules", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    providerActionMocks.fetchUpstreamModels.mockResolvedValue({
      ok: true,
      data: { models: ["claude-opus-4-1", "claude-sonnet-4-1"] },
    });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AllowedModelRuleEditor
          value={[]}
          onChange={onChange}
          providerType="claude"
          providerUrl="https://api.example.com"
          apiKey="sk-test"
        />
      </NextIntlClientProvider>
    );

    const quickAddButton = document.querySelector(
      "[data-allowed-model-quick-add]"
    ) as HTMLButtonElement | null;
    expect(quickAddButton).toBeTruthy();

    await act(async () => {
      quickAddButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushTicks(3);

    expect(providerActionMocks.fetchUpstreamModels).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith([
      { matchType: "exact", pattern: "claude-opus-4-1" },
      { matchType: "exact", pattern: "claude-sonnet-4-1" },
    ]);

    unmount();
  });
});
