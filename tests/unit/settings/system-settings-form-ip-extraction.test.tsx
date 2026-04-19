import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SystemSettingsForm } from "@/app/[locale]/settings/config/_components/system-settings-form";
import { DEFAULT_IP_EXTRACTION_CONFIG } from "@/types/ip-extraction";
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
  },
}));
vi.mock("sonner", () => sonnerMocks);

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

function buildSettings(
  overrides: Partial<Pick<SystemSettings, keyof typeof baseSettings>> = {}
): Pick<SystemSettings, keyof typeof baseSettings> {
  return {
    ...baseSettings,
    ...overrides,
  };
}

const baseSettings = {
  siteTitle: "Claude Code Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "redirected",
  codexPriorityBillingSource: "requested",
  timezone: "UTC",
  verboseProviderError: false,
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
} satisfies Pick<
  SystemSettings,
  | "siteTitle"
  | "allowGlobalUsageView"
  | "currencyDisplay"
  | "billingModelSource"
  | "codexPriorityBillingSource"
  | "timezone"
  | "verboseProviderError"
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

function renderForm(settings: Pick<SystemSettings, keyof typeof baseSettings> = baseSettings) {
  return render(<SystemSettingsForm initialSettings={settings} />);
}

function getIpExtractionTextarea() {
  const textarea = document.getElementById("ip-extraction-config") as HTMLTextAreaElement | null;
  if (!textarea) throw new Error("未找到 IP 提取配置输入框");
  return textarea;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButtonByText(text: string) {
  const button = Array.from(document.body.querySelectorAll("button")).find((element) =>
    (element.textContent || "").includes(text)
  );
  if (!button) throw new Error(`未找到按钮: ${text}`);

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

describe("SystemSettingsForm IP 提取配置 JSON 输入框", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("未配置自定义链时直接显示格式化后的内置默认 JSON", () => {
    const { unmount } = renderForm(buildSettings({ ipExtractionConfig: null }));

    const textarea = getIpExtractionTextarea();
    const formattedDefault = JSON.stringify(DEFAULT_IP_EXTRACTION_CONFIG, null, 2);

    expect(textarea.value).toBe(formattedDefault);
    expect(textarea.placeholder).toBe(formattedDefault);

    unmount();
  });

  test("恢复默认只把默认 JSON 插入输入框，不会立即保存", () => {
    const { unmount } = renderForm(
      buildSettings({
        ipExtractionConfig: {
          headers: [{ name: "cf-connecting-ip" }],
        },
      })
    );

    const textarea = getIpExtractionTextarea();
    setTextareaValue(textarea, '{"headers":[]}');
    clickButtonByText("Reset to default");

    expect(textarea.value).toBe(JSON.stringify(DEFAULT_IP_EXTRACTION_CONFIG, null, 2));
    expect(systemConfigActionMocks.saveSystemSettings).not.toHaveBeenCalled();

    unmount();
  });

  test("直接保存默认 JSON 时提交默认对象", async () => {
    const { unmount } = renderForm(buildSettings({ ipExtractionConfig: null }));

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ipExtractionConfig: DEFAULT_IP_EXTRACTION_CONFIG,
      })
    );

    unmount();
  });

  test("用户显式清空输入框后保存仍提交 null", async () => {
    const { unmount } = renderForm(buildSettings({ ipExtractionConfig: null }));

    setTextareaValue(getIpExtractionTextarea(), "");
    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ipExtractionConfig: null,
      })
    );

    unmount();
  });
});
