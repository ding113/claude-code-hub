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

const requestFiltersActionMocks = vi.hoisted(() => ({
  getDistinctProviderGroupsAction: vi.fn(async () => ({ ok: true, data: ["group-a", "group-b"] })),
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
  fakeStreamingWhitelist: [
    { model: "gpt-image-2", groupTags: [] },
    { model: "gemini-3.1-flash-image-preview", groupTags: [] },
  ],
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
  | "passThroughUpstreamErrorMessage"
  | "enableHttp2"
  | "enableHighConcurrencyMode"
  | "interceptAnthropicWarmupRequests"
  | "enableThinkingSignatureRectifier"
  | "enableThinkingBudgetRectifier"
  | "enableBillingHeaderRectifier"
  | "enableResponseInputRectifier"
  | "enableCodexSessionIdCompletion"
  | "enableClaudeMetadataUserIdInjection"
  | "enableResponseFixer"
  | "allowNonConversationEndpointProviderFallback"
  | "fakeStreamingWhitelist"
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

function findRemoveButtons(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[data-testid^="fake-streaming-remove-"]')
  );
}

function findAddButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[data-testid="fake-streaming-add"]');
}

function findModelInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-testid^="fake-streaming-model-"]')
  );
}

describe("SystemSettingsForm fake streaming whitelist", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("submits initial whitelist on save", async () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={baseSettings} />);

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingWhitelist: [
          { model: "gpt-image-2", groupTags: [] },
          { model: "gemini-3.1-flash-image-preview", groupTags: [] },
        ],
      })
    );

    unmount();
  });

  test("user can add a new model entry and saves it for all groups", async () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={baseSettings} />);

    const addBtn = findAddButton();
    if (!addBtn) throw new Error("未找到 fake-streaming 添加按钮");

    act(() => {
      addBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inputs = findModelInputs();
    expect(inputs.length).toBe(3);
    const newRow = inputs[2];

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(newRow, "custom-model-x");
      newRow.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingWhitelist: [
          { model: "gpt-image-2", groupTags: [] },
          { model: "gemini-3.1-flash-image-preview", groupTags: [] },
          { model: "custom-model-x", groupTags: [] },
        ],
      })
    );

    unmount();
  });

  test("user can remove a model entry and the empty whitelist is preserved as opt-out", async () => {
    const singleEntry = {
      ...baseSettings,
      fakeStreamingWhitelist: [{ model: "gpt-image-2", groupTags: [] }],
    } satisfies typeof baseSettings;

    const { unmount } = render(<SystemSettingsForm initialSettings={singleEntry} />);

    const removeBtns = findRemoveButtons();
    expect(removeBtns.length).toBe(1);

    act(() => {
      removeBtns[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingWhitelist: [],
      })
    );

    unmount();
  });

  test("trims whitespace and drops empty model entries before submitting", async () => {
    const { unmount } = render(<SystemSettingsForm initialSettings={baseSettings} />);

    const inputs = findModelInputs();
    expect(inputs.length).toBe(2);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    act(() => {
      setter?.call(inputs[0], "  custom-image-model  ");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(inputs[1], "   ");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });

    await submitForm();

    expect(systemConfigActionMocks.saveSystemSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        fakeStreamingWhitelist: [{ model: "custom-image-model", groupTags: [] }],
      })
    );

    unmount();
  });

  test("all locales define fake streaming labels", () => {
    const locales = ["zh-CN", "zh-TW", "en", "ja", "ru"] as const;

    for (const locale of locales) {
      const config = loadMessages(locale).settings.config;
      const section = config.form.fakeStreaming;
      expect(section, `missing fakeStreaming section in ${locale}`).toBeTruthy();
      expect(section.title).toBeTruthy();
      expect(section.description).toBeTruthy();
      expect(section.modelLabel).toBeTruthy();
      expect(section.groupsLabel).toBeTruthy();
      expect(section.allGroupsHint).toBeTruthy();
      expect(section.addModel).toBeTruthy();
      expect(section.remove).toBeTruthy();
      expect(section.modelPlaceholder).toBeTruthy();
      expect(section.emptyState).toBeTruthy();
    }
  });
});
