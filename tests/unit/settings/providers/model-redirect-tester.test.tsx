/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { ModelRedirectTester } from "@/app/[locale]/settings/providers/_components/model-redirect-tester";
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

describe("ModelRedirectTester", () => {
  test("shows matched redirect rule details", async () => {
    const messages = loadMessages();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelRedirectTester
          rules={[{ matchType: "prefix", source: "claude-opus-", target: "glm-4.6" }]}
        />
      </NextIntlClientProvider>
    );

    const input = document.querySelector("input") as HTMLInputElement | null;
    expect(input).toBeTruthy();

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

    expect(document.body.textContent || "").toContain("Matched a redirect rule");
    expect(document.body.textContent || "").toContain("glm-4.6");

    unmount();
  });

  test("shows no-match state", async () => {
    const messages = loadMessages();
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelRedirectTester
          rules={[{ matchType: "exact", source: "claude-opus-4-1", target: "glm-4.6" }]}
        />
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

    expect(document.body.textContent || "").toContain("No redirect rule matched this model name");

    unmount();
  });
});
