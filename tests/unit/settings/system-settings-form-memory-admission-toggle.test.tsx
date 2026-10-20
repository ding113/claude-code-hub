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
  saveSystemSettings: vi.fn(async (): Promise<unknown> => ({ ok: true })),
}));
vi.mock("@/actions/system-config", () => systemConfigActionMocks);

const requestFiltersActionMocks = vi.hoisted(() => ({
  getDistinctProviderGroupsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("@/actions/request-filters", () => requestFiltersActionMocks);

const sonnerMocks = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("sonner", () => sonnerMocks);

const baseSettings = {
  siteTitle: "CC Hub",
  allowGlobalUsageView: true,
  currencyDisplay: "USD",
  billingModelSource: "original",
  codexPriorityBillingSource: "requested",
  timezone: "UTC",
  verboseProviderError: false,
  passThroughUpstreamErrorMessage: true,
  enableHttp2: true,
  enableHighConcurrencyMode: false,
  enableMemoryAdmission: false,
  interceptAnthropicWarmupRequests: false,
  enableThinkingSignatureRectifier: true,
  enableThinkingBudgetRectifier: true,
  enableBillingHeaderRectifier: true,
  enableResponseInputRectifier: true,
  enableCodexSessionIdCompletion: true,
  enableClaudeMetadataUserIdInjection: true,
  enableResponseFixer: true,
  allowNonConversationEndpointProviderFallback: true,
  fakeStreamingWhitelist: [],
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
  replayEnabled: null,
  replayCacheTtlMinutes: 30,
  cacheEffectivenessEnabled: null,
} satisfies Partial<SystemSettings>;

function loadMessages(locale: string) {
  const base = path.join(process.cwd(), `messages/${locale}/settings`);
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(base, name), "utf8"));

  return {
    settings: {
      common: read("common.json"),
      config: read("config.json"),
      requestFilters: read("requestFilters.json"),
    },
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

function memoryAdmissionSwitch(): HTMLElement {
  const label = loadMessages("en").settings.config.form.enableMemoryAdmission as string;
  const element = document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!element) throw new Error("未找到内存准入开关");
  return element;
}

describe("SystemSettingsForm 内存准入开关", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("默认关闭，未切换时保存为 false", async () => {
    const { unmount } = render(
      <SystemSettingsForm initialSettings={baseSettings} replayDefaultEnabled={true} />
    );

    const toggle = memoryAdmissionSwitch();
    expect(toggle.id).toBe("enable-memory-admission");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.body.textContent).toContain(
      loadMessages("en").settings.config.form.enableMemoryAdmissionDesc
    );

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enableMemoryAdmission: false })
    );

    unmount();
  });

  test("开启后保存为 true，并按服务端返回值刷新开关", async () => {
    systemConfigActionMocks.saveSystemSettings.mockResolvedValueOnce({
      ok: true,
      data: { ...baseSettings, enableMemoryAdmission: false },
    });
    const { unmount } = render(
      <SystemSettingsForm initialSettings={baseSettings} replayDefaultEnabled={true} />
    );

    await act(async () => {
      memoryAdmissionSwitch().click();
      await Promise.resolve();
    });
    expect(memoryAdmissionSwitch().getAttribute("aria-checked")).toBe("true");

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enableMemoryAdmission: true })
    );
    expect(memoryAdmissionSwitch().getAttribute("aria-checked")).toBe("false");

    unmount();
  });

  test("初始值为开启时显示为开启", () => {
    const { unmount } = render(
      <SystemSettingsForm
        initialSettings={{ ...baseSettings, enableMemoryAdmission: true }}
        replayDefaultEnabled={true}
      />
    );

    expect(memoryAdmissionSwitch().getAttribute("aria-checked")).toBe("true");

    unmount();
  });
});
