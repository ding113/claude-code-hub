/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderBatchDialog } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog";
import type { ProviderDisplay } from "@/types/provider";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) => {
      if (params) {
        let result = key;
        for (const [k, v] of Object.entries(params)) {
          result = result.replace(`{${k}}`, String(v));
        }
        return result;
      }
      return key;
    };
    return t;
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/actions/providers", () => ({
  batchUpdateProviders: vi.fn().mockResolvedValue({ ok: true, data: { updatedCount: 2 } }),
  batchDeleteProviders: vi.fn().mockResolvedValue({ ok: true, data: { deletedCount: 2 } }),
  batchResetProviderCircuits: vi.fn().mockResolvedValue({ ok: true, data: { resetCount: 2 } }),
}));

// Dialog mock - respects `open` prop
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-description">{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-title">{children}</div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogAction: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr data-testid="separator" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (val: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="select-mock">
      <select
        data-testid="select-trigger"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// Mock ThinkingBudgetEditor
vi.mock("@/app/[locale]/settings/providers/_components/thinking-budget-editor", () => ({
  ThinkingBudgetEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="thinking-budget-editor" data-value={value} data-disabled={disabled}>
      <input
        data-testid="thinking-budget-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  ),
}));

// Mock AdaptiveThinkingEditor
vi.mock("@/app/[locale]/settings/providers/_components/adaptive-thinking-editor", () => ({
  AdaptiveThinkingEditor: ({
    enabled,
    onEnabledChange,
    disabled,
  }: {
    enabled: boolean;
    onEnabledChange: (v: boolean) => void;
    onConfigChange: (config: any) => void;
    config: any;
    disabled?: boolean;
  }) => (
    <div
      data-testid="adaptive-thinking-editor"
      data-enabled={String(enabled)}
      data-disabled={String(disabled ?? false)}
    >
      <button data-testid="adaptive-thinking-switch" onClick={() => onEnabledChange(!enabled)}>
        {enabled ? "On" : "Off"}
      </button>
    </div>
  ),
}));

vi.mock("lucide-react", () => ({
  Loader2: () => <div data-testid="loader-icon" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockProvider(id: number, name: string, maskedKey: string): ProviderDisplay {
  return {
    id,
    name,
    url: "https://api.example.com",
    maskedKey,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "claude",
    providerVendorId: null,
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 10,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 30000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 120000,
    requestTimeoutNonStreamingMs: 120000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };
}

function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const twoProviders = [
  createMockProvider(1, "Provider1", "aaaa****1111"),
  createMockProvider(2, "Provider2", "bbbb****2222"),
];

const eightProviders = Array.from({ length: 8 }, (_, i) =>
  createMockProvider(i + 1, `Provider${i + 1}`, `key${i + 1}****tail${i + 1}`)
);

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    mode: "edit" as const,
    onOpenChange: vi.fn(),
    selectedProviderIds: new Set([1, 2]),
    providers: twoProviders,
    onSuccess: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderBatchDialog - Step1 Edit Mode Refactor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders edit mode with three sections", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const text = container.textContent ?? "";

    expect(text).toContain("sections.basic");
    expect(text).toContain("sections.routing");
    expect(text).toContain("sections.anthropic");

    unmount();
  });

  it("isEnabled defaults to no_change - no change selected", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    // The isEnabled select is identified by data-field attribute
    const isEnabledSelect = container.querySelector(
      '[data-field="isEnabled"] select'
    ) as HTMLSelectElement;

    expect(isEnabledSelect).toBeTruthy();
    expect(isEnabledSelect.value).toBe("no_change");

    unmount();
  });

  it("changing isEnabled to true reflects in state", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const isEnabledSelect = container.querySelector(
      '[data-field="isEnabled"] select'
    ) as HTMLSelectElement;

    act(() => {
      isEnabledSelect.value = "true";
      isEnabledSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(isEnabledSelect.value).toBe("true");

    unmount();
  });

  it("empty numeric fields mean no change - hasChanges is false", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    // All fields are at default (empty/no_change), so Next button should be disabled
    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    // The second button in the footer is "Next" (first is "Cancel")
    const nextButton = buttons[1] as HTMLButtonElement;

    expect(nextButton).toBeTruthy();
    expect(nextButton.disabled).toBe(true);

    unmount();
  });

  it("setting a priority value makes hasChanges true", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    // Find the priority input by data-field
    const priorityInput = container.querySelector(
      '[data-field="priority"] input'
    ) as HTMLInputElement;
    expect(priorityInput).toBeTruthy();

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(priorityInput, "10");
      priorityInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Next button should now be enabled
    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    const nextButton = buttons[1] as HTMLButtonElement;

    expect(nextButton.disabled).toBe(false);

    unmount();
  });

  it("groupTag clear button sets value to __clear__", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    // Find the clear button for groupTag
    const clearButton = container.querySelector(
      '[data-field="groupTag"] button'
    ) as HTMLButtonElement;
    expect(clearButton).toBeTruthy();

    act(() => {
      clearButton.click();
    });

    // The groupTag input should now show "__clear__"
    const groupTagInput = container.querySelector(
      '[data-field="groupTag"] input'
    ) as HTMLInputElement;
    expect(groupTagInput.value).toBe("__clear__");

    unmount();
  });

  it("affected-provider summary shows correct count and masked keys", () => {
    const threeProviders = [
      createMockProvider(1, "AlphaProvider", "aaaa****1111"),
      createMockProvider(2, "BetaProvider", "bbbb****2222"),
      createMockProvider(3, "GammaProvider", "cccc****3333"),
    ];

    const { container, unmount } = render(
      <ProviderBatchDialog
        {...defaultProps({
          providers: threeProviders,
          selectedProviderIds: new Set([1, 3]),
        })}
      />
    );

    const text = container.textContent ?? "";

    // Should show count of 2 affected providers
    expect(text).toContain("affectedProviders.title");
    expect(text).toContain("2");

    // Should show masked keys for selected providers (id 1 and 3)
    expect(text).toContain("AlphaProvider");
    expect(text).toContain("aaaa****1111");
    expect(text).toContain("GammaProvider");
    expect(text).toContain("cccc****3333");

    // Should NOT show unselected provider
    expect(text).not.toContain("BetaProvider");

    unmount();
  });

  it("shows +N more when more than 5 providers are affected", () => {
    const allIds = new Set(eightProviders.map((p) => p.id));

    const { container, unmount } = render(
      <ProviderBatchDialog
        {...defaultProps({
          providers: eightProviders,
          selectedProviderIds: allIds,
        })}
      />
    );

    const text = container.textContent ?? "";

    // 8 providers selected, first 5 shown, so "+3 more"
    expect(text).toContain("affectedProviders.more");
    // The mock translation interpolates {count} => "3"
    expect(text).toContain("3");

    // First 5 providers should be shown
    expect(text).toContain("Provider1");
    expect(text).toContain("Provider5");

    // Provider 6-8 should NOT be listed individually
    expect(text).not.toContain("Provider6");

    unmount();
  });

  it("next button disabled when no changes", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    const nextButton = buttons[1] as HTMLButtonElement;

    expect(nextButton.disabled).toBe(true);

    unmount();
  });

  it("renders ThinkingBudgetEditor and AdaptiveThinkingEditor in anthropic section", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    // Find the anthropic section by its data-section attribute
    const anthropicSection = container.querySelector('[data-section="anthropic"]');
    expect(anthropicSection).toBeTruthy();

    // ThinkingBudgetEditor should be rendered within it
    const thinkingEditor = anthropicSection?.querySelector(
      '[data-testid="thinking-budget-editor"]'
    );
    expect(thinkingEditor).toBeTruthy();

    // AdaptiveThinkingEditor should be rendered within it
    const adaptiveEditor = anthropicSection?.querySelector(
      '[data-testid="adaptive-thinking-editor"]'
    );
    expect(adaptiveEditor).toBeTruthy();

    unmount();
  });
});
