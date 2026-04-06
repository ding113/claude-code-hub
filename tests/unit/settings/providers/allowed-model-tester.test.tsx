/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { AllowedModelTester } from "@/app/[locale]/settings/providers/_components/allowed-model-tester";
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
  act(() => root.render(node));
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushTicks(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("AllowedModelTester", () => {
  test("shows allowed state with matched rule", async () => {
    const messages = loadMessages();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AllowedModelTester rules={[{ matchType: "prefix", pattern: "claude-opus-" }]} />
      </NextIntlClientProvider>
    );

    const input = document.querySelector("input") as HTMLInputElement | null;
    await act(async () => {
      if (input) {
        input.value = "claude-opus-4-1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks();

    const button = document.querySelector("button") as HTMLButtonElement | null;
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks();

    expect(document.body.textContent || "").toContain("This model is allowed");
    expect(document.body.textContent || "").toContain("claude-opus-");

    unmount();
  });

  test("shows blocked state when no rule matches", async () => {
    const messages = loadMessages();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AllowedModelTester rules={[{ matchType: "exact", pattern: "claude-opus-4-1" }]} />
      </NextIntlClientProvider>
    );

    const input = document.querySelector("input") as HTMLInputElement | null;
    await act(async () => {
      if (input) {
        input.value = "claude-sonnet-4-1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks();

    const button = document.querySelector("button") as HTMLButtonElement | null;
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks();

    expect(document.body.textContent || "").toContain("This model is blocked by the allowlist");

    unmount();
  });
});
