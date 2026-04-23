import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SystemSettingsForm } from "@/app/[locale]/settings/config/_components/system-settings-form";
import type { SystemSettings } from "@/types/system-config";

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

type FormSettings = Pick<
  SystemSettings,
  | "siteTitle"
  | "allowGlobalUsageView"
  | "currencyDisplay"
  | "billingModelSource"
  | "codexPriorityBillingSource"
  | "timezone"
  | "verboseProviderError"
  | "passThroughUpstreamErrorMessage"
  | "enableHttp2"
  | "enableHighConcurrencyMode"
  | "interceptAnthropicWarmupRequests"
  | "enableThinkingSignatureRectifier"
  | "enableBillingHeaderRectifier"
  | "enableResponseInputRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "responseFixerConfig"
  | "quotaDbRefreshIntervalSeconds"
  | "quotaLeasePercent5h"
  | "quotaLeasePercentDaily"
  | "quotaLeasePercentWeekly"
  | "quotaLeasePercentMonthly"
  | "quotaLeaseCapUsd"
  | "ipGeoLookupEnabled"
  | "ipExtractionConfig"
>;

function loadMessages() {
  const base = path.join(process.cwd(), "messages/en/settings");
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    settings: {
      common: read("common.json"),
      config: read("config.json"),
    },
  };
}

const baseSettings: FormSettings = {
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "redirected",
  codexPriorityBillingSource: "requested",
  timezone: "UTC",
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: true,
  enableHttp2: true,
  enableHighConcurrencyMode: false,
  interceptAnthropicWarmupRequests: true,
  enableThinkingSignatureRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  responseFixerConfig: {
    fixEncoding: true,
    fixSseFormat: true,
    fixTruncatedJson: true,
  },
  quotaDbRefreshIntervalSeconds: 10,
  quotaLeasePercent5h: 0.05,
  quotaLeasePercentDaily: 0.05,
  quotaLeasePercentWeekly: 0.05,
  quotaLeasePercentMonthly: 0.05,
  quotaLeaseCapUsd: null,
  ipGeoLookupEnabled: true,
  ipExtractionConfig: null,
};

function buildSettings(overrides: Partial<FormSettings> = {}): FormSettings {
  return {
    ...baseSettings,
    ...overrides,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages()} timeZone="UTC">
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function renderForm(settings: FormSettings = baseSettings) {
  return render(<SystemSettingsForm initialSettings={settings} />);
}

function getSwitch(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`未找到开关: ${id}`);
  }
  return element;
}

function clickSwitch(id: string) {
  act(() => {
    getSwitch(id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

describe("SystemSettingsForm upstream error message toggles", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("新开关默认值从 initialSettings 读取", () => {
    const { unmount } = renderForm(buildSettings({ passThroughUpstreamErrorMessage: true }));

    expect(getSwitch("pass-through-upstream-error-message").getAttribute("aria-checked")).toBe(
      "true"
    );

    unmount();
  });

  test("切换新开关后提交 payload，并在成功后按返回值回填 state", async () => {
    systemConfigActionMocks.saveSystemSettings.mockResolvedValueOnce({
      ok: true,
      data: buildSettings({
        passThroughUpstreamErrorMessage: true,
      }),
    });

    const { unmount } = renderForm(buildSettings({ passThroughUpstreamErrorMessage: false }));

    clickSwitch("pass-through-upstream-error-message");
    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        passThroughUpstreamErrorMessage: true,
        verboseProviderError: false,
      })
    );
    expect(getSwitch("pass-through-upstream-error-message").getAttribute("aria-checked")).toBe(
      "true"
    );

    unmount();
  });

  test("旧开关仍可独立提交，不会连带修改新开关", async () => {
    systemConfigActionMocks.saveSystemSettings.mockResolvedValueOnce({
      ok: true,
      data: buildSettings({
        verboseProviderError: true,
        passThroughUpstreamErrorMessage: true,
      }),
    });

    const { unmount } = renderForm(buildSettings());

    clickSwitch("verbose-provider-error");
    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        verboseProviderError: true,
        passThroughUpstreamErrorMessage: true,
      })
    );
    expect(getSwitch("verbose-provider-error").getAttribute("aria-checked")).toBe("true");
    expect(getSwitch("pass-through-upstream-error-message").getAttribute("aria-checked")).toBe(
      "true"
    );

    unmount();
  });
});
