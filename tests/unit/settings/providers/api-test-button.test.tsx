/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiTestButton } from "@/app/[locale]/settings/providers/_components/forms/api-test-button";
import apiTestMessages from "../../../../messages/en/settings/providers/form/apiTest.json";
import providerTypesMessages from "../../../../messages/en/settings/providers/form/providerTypes.json";

const { getProviderTestPresetsMock } = vi.hoisted(() => ({
  getProviderTestPresetsMock: vi.fn(),
}));

vi.mock("@/actions/providers", () => ({
  getProviderTestPresets: getProviderTestPresetsMock,
  testProviderGemini: vi.fn(),
  testProviderUnified: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushTicks(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buildMessages() {
  return {
    settings: {
      providers: {
        form: {
          apiTest: apiTestMessages,
          providerTypes: providerTypesMessages,
        },
      },
    },
  };
}

describe("ApiTestButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderTestPresetsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "cx_base",
          description: "legacy preset",
          defaultSuccessContains: "pong",
          defaultModel: "gpt-5.1-codex",
        },
      ],
    });
  });

  test("供应商检测 UI 不应再要求手动选择格式、模板、关键字或超时", async () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={buildMessages()}>
        <ApiTestButton
          providerUrl="https://api.example.com"
          apiKey="sk-test"
          providerType="openai-compatible"
          enableMultiProviderTypes
        />
      </NextIntlClientProvider>
    );

    await flushTicks(2);

    const text = document.body.textContent || "";

    expect(getProviderTestPresetsMock).not.toHaveBeenCalled();
    expect(text).toContain(apiTestMessages.model);
    expect(text).not.toContain(apiTestMessages.apiFormat);
    expect(text).not.toContain(apiTestMessages.requestConfig);
    expect(text).not.toContain(apiTestMessages.successContains);
    expect(text).not.toContain(apiTestMessages.timeout.label);

    unmount();
  });
});
