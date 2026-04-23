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

const {
  getProviderTestPresetsMock,
  getUnmaskedProviderKeyMock,
  testProviderGeminiMock,
  testProviderUnifiedMock,
} = vi.hoisted(() => ({
  getProviderTestPresetsMock: vi.fn(),
  getUnmaskedProviderKeyMock: vi.fn(),
  testProviderGeminiMock: vi.fn(),
  testProviderUnifiedMock: vi.fn(),
}));

vi.mock("@/actions/providers", () => ({
  getProviderTestPresets: getProviderTestPresetsMock,
  getUnmaskedProviderKey: getUnmaskedProviderKeyMock,
  testProviderGemini: testProviderGeminiMock,
  testProviderUnified: testProviderUnifiedMock,
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
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
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

  test("renders request url for failed codex provider test", async () => {
    testProviderUnifiedMock.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        status: "red",
        subStatus: "client_error",
        message: "Provider unavailable: client error",
        latencyMs: 321,
        httpStatusCode: 400,
        httpStatusText: "Bad Request",
        requestUrl: "https://api.gptclubapi.xyz/openai/responses",
        rawResponse: '{"error":"Invalid URL (POST /v1/v1/responses)"}',
        errorMessage: "Invalid URL (POST /v1/v1/responses)",
        errorType: "invalid_request_error",
        testedAt: "2026-04-23T08:56:30.000Z",
        validationDetails: {
          httpPassed: false,
          httpStatusCode: 400,
          latencyPassed: false,
          latencyMs: 321,
          contentPassed: false,
          contentTarget: "pong",
        },
      },
    });

    const { container, unmount } = render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={buildMessages()}>
        <ApiTestButton
          providerUrl="https://api.gptclubapi.xyz/openai"
          apiKey="sk-test"
          providerType="codex"
          enableMultiProviderTypes
        />
      </NextIntlClientProvider>
    );

    await flushTicks(2);

    const button = container.querySelector("button");
    expect(button).not.toBeNull();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(testProviderUnifiedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUrl: "https://api.gptclubapi.xyz/openai",
        providerType: "codex",
      })
    );
    expect(getProviderTestPresetsMock).not.toHaveBeenCalled();

    const text = document.body.textContent || "";
    expect(text).toContain("Invalid URL (POST /v1/v1/responses)");
    expect(text).toContain("https://api.gptclubapi.xyz/openai/responses");
    expect(text).not.toContain(apiTestMessages.apiFormat);
    expect(text).not.toContain(apiTestMessages.requestConfig);
    expect(text).not.toContain(apiTestMessages.successContains);
    expect(text).not.toContain(apiTestMessages.timeout.label);

    unmount();
  });

  test("copies request url from the result details dialog", async () => {
    testProviderUnifiedMock.mockResolvedValue({
      ok: true,
      data: {
        success: false,
        status: "red",
        subStatus: "client_error",
        message: "Provider unavailable: client error",
        latencyMs: 321,
        httpStatusCode: 400,
        httpStatusText: "Bad Request",
        requestUrl: "https://api.gptclubapi.xyz/openai/responses",
        rawResponse: '{"error":"Invalid URL (POST /v1/v1/responses)"}',
        errorMessage: "Invalid URL (POST /v1/v1/responses)",
        errorType: "invalid_request_error",
        testedAt: "2026-04-23T08:56:30.000Z",
        validationDetails: {
          httpPassed: false,
          httpStatusCode: 400,
          latencyPassed: false,
          latencyMs: 321,
          contentPassed: false,
          contentTarget: "pong",
        },
      },
    });

    const { container, unmount } = render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={buildMessages()}>
        <ApiTestButton
          providerUrl="https://api.gptclubapi.xyz/openai"
          apiKey="sk-test"
          providerType="codex"
          enableMultiProviderTypes
        />
      </NextIntlClientProvider>
    );

    await flushTicks(2);

    const testButton = container.querySelector("button");
    expect(testButton).not.toBeNull();

    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    const detailsButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(apiTestMessages.viewDetails)
    );
    expect(detailsButton).toBeTruthy();

    await act(async () => {
      detailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(document.body.textContent || "").toContain("Actual Request URL");
    expect(document.body.textContent || "").toContain(
      "https://api.gptclubapi.xyz/openai/responses"
    );

    const copyButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(apiTestMessages.copyResult)
    );
    expect(copyButton).toBeTruthy();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("https://api.gptclubapi.xyz/openai/responses")
    );

    unmount();
  });
});
