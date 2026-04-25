import fs from "node:fs";
import path from "node:path";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { locales } from "@/i18n/config";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SystemSettingsForm } from "@/app/[locale]/settings/config/_components/system-settings-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const systemConfigActionMocks = vi.hoisted(() => ({
  saveSystemSettings: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/actions/system-config", () => systemConfigActionMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

type InitialSettings = ComponentProps<typeof SystemSettingsForm>["initialSettings"];

const baseSettings = {
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "original",
  codexPriorityBillingSource: "requested",
  timezone: "UTC",
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: true,
  enableHttp2: true,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  allowNonConversationEndpointProviderFallback: true,
  responseFixerConfig: {
    fixEncoding: true,
    fixSseFormat: true,
    fixTruncatedJson: true,
    maxJsonDepth: 200,
    maxFixSize: 1024 * 1024,
  },
  quotaDbRefreshIntervalSeconds: 10,
  quotaLeasePercent5h: 0.05,
  quotaLeasePercentDaily: 0.05,
  quotaLeasePercentWeekly: 0.05,
  quotaLeasePercentMonthly: 0.05,
  quotaLeaseCapUsd: null,
  ipGeoLookupEnabled: true,
  ipExtractionConfig: null,
} satisfies InitialSettings;

function loadMessages(locale: string) {
  const base = path.join(process.cwd(), `messages/${locale}/settings`);
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    settings: {
      common: read("common.json"),
      config: read("config.json"),
    },
  };
}

function getWebSocketFormMessages(locale: string) {
  const form = loadMessages(locale).settings.config.form as Record<string, unknown>;
  return {
    label: form.enableOpenAIResponsesWebSocket,
    description: form.enableOpenAIResponsesWebSocketDesc,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages("en")} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function submitForm() {
  const form = document.body.querySelector("form");
  if (!form) throw new Error("未找到系统设置表单");

  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function clickWebSocketSwitch() {
  const trigger = document.getElementById(
    "enable-openai-responses-websocket"
  ) as HTMLButtonElement | null;
  if (!trigger) {
    throw new Error("未找到 OpenAI Responses WebSocket 开关");
  }

  act(() => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function createInitialSettings(overrides: Record<string, unknown> = {}) {
  return {
    ...baseSettings,
    enableOpenAIResponsesWebSocket: true,
    ...overrides,
  } as InitialSettings & Record<string, unknown>;
}

describe("SystemSettingsForm OpenAI Responses WebSocket setting", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("all locales define OpenAI Responses WebSocket label and help text", () => {
    for (const locale of locales) {
      const { label, description } = getWebSocketFormMessages(locale);

      expect(label).toEqual(expect.any(String));
      expect(description).toEqual(expect.any(String));
      expect(label).not.toBe("");
      expect(description).not.toBe("");
    }
  });

  test("settings form renders the translated toggle label and help text", () => {
    const { label, description } = getWebSocketFormMessages("en");
    expect(label).toEqual(expect.any(String));
    expect(description).toEqual(expect.any(String));

    const { unmount } = render(<SystemSettingsForm initialSettings={createInitialSettings()} />);

    expect(document.body.textContent).toContain(label as string);
    expect(document.body.textContent).toContain(description as string);
    expect(document.getElementById("enable-openai-responses-websocket")).toBeInstanceOf(
      HTMLButtonElement
    );

    unmount();
  });

  test("settings form payload includes the WebSocket toggle value", async () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={createInitialSettings()} />);

    clickWebSocketSwitch();
    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        enableOpenAIResponsesWebSocket: false,
      })
    );

    unmount();
  });
});
