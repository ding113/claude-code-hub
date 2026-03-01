/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderBatchDialog } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-dialog";
import type { ProviderDisplay } from "@/types/provider";

// ---------------------------------------------------------------------------
// Mutable mock state for useProviderForm
// ---------------------------------------------------------------------------

let mockDirtyFields = new Set<string>();
const mockDispatch = vi.fn();
let mockActiveTab = "basic";
const mockState = {
  ui: { activeTab: mockActiveTab, isPending: false, showFailureThresholdConfirm: false },
  basic: { name: "", url: "", key: "", websiteUrl: "" },
  routing: {
    providerType: "claude" as const,
    groupTag: [],
    preserveClientIp: false,
    modelRedirects: {},
    allowedModels: [],
    priority: 0,
    groupPriorities: {},
    weight: 1,
    costMultiplier: 1,
    cacheTtlPreference: "inherit" as const,
    swapCacheTtlBilling: false,
    context1mPreference: "inherit" as const,
    codexReasoningEffortPreference: "inherit",
    codexReasoningSummaryPreference: "inherit",
    codexTextVerbosityPreference: "inherit",
    codexParallelToolCallsPreference: "inherit",
    anthropicMaxTokensPreference: "inherit",
    anthropicThinkingBudgetPreference: "inherit",
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: "inherit",
  },
  rateLimit: {
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed" as const,
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: null,
  },
  circuitBreaker: {
    failureThreshold: undefined,
    openDurationMinutes: undefined,
    halfOpenSuccessThreshold: undefined,
    maxRetryAttempts: null,
  },
  network: {
    proxyUrl: "",
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingSeconds: undefined,
    streamingIdleTimeoutSeconds: undefined,
    requestTimeoutNonStreamingSeconds: undefined,
  },
  mcp: { mcpPassthroughType: "none" as const, mcpPassthroughUrl: "" },
  batch: { isEnabled: "no_change" as const },
};

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
  previewProviderBatchPatch: vi.fn().mockResolvedValue({
    ok: true,
    data: {
      previewToken: "tok-1",
      previewRevision: "rev-1",
      rows: [],
      summary: { providerCount: 0, fieldCount: 0, skipCount: 0 },
    },
  }),
  applyProviderBatchPatch: vi.fn().mockResolvedValue({ ok: true, data: { updatedCount: 2 } }),
  undoProviderPatch: vi.fn().mockResolvedValue({ ok: true, data: { revertedCount: 2 } }),
  batchDeleteProviders: vi.fn().mockResolvedValue({ ok: true, data: { deletedCount: 2 } }),
  batchResetProviderCircuits: vi.fn().mockResolvedValue({ ok: true, data: { resetCount: 2 } }),
}));

// Mock ProviderFormProvider + useProviderForm
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context",
  () => ({
    ProviderFormProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useProviderForm: () => ({
      state: mockState,
      dispatch: mockDispatch,
      dirtyFields: mockDirtyFields,
      mode: "batch",
    }),
  })
);

// Mock all form section components as stubs
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/basic-info-section",
  () => ({
    BasicInfoSection: () => <div data-testid="basic-info-section">BasicInfoSection</div>,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section",
  () => ({
    RoutingSection: () => <div data-testid="routing-section">RoutingSection</div>,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/limits-section",
  () => ({
    LimitsSection: () => <div data-testid="limits-section">LimitsSection</div>,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/network-section",
  () => ({
    NetworkSection: () => <div data-testid="network-section">NetworkSection</div>,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/testing-section",
  () => ({
    TestingSection: () => <div data-testid="testing-section">TestingSection</div>,
  })
);

// Mock FormTabNav
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/components/form-tab-nav",
  () => ({
    FormTabNav: ({ activeTab }: { activeTab: string }) => (
      <div data-testid="form-tab-nav" data-active-tab={activeTab}>
        FormTabNav
      </div>
    ),
  })
);

// Mock ProviderBatchPreviewStep
vi.mock(
  "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-preview-step",
  () => ({
    ProviderBatchPreviewStep: () => <div data-testid="preview-step">PreviewStep</div>,
  })
);

// Mock buildPatchDraftFromFormState
vi.mock("@/app/[locale]/settings/providers/_components/batch-edit/build-patch-draft", () => ({
  buildPatchDraftFromFormState: vi.fn().mockReturnValue({}),
}));

// UI component mocks
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
  let root: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(container);
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

describe("ProviderBatchDialog - Edit Mode Structure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDirtyFields = new Set<string>();
    mockActiveTab = "basic";
    mockState.ui.activeTab = "basic";
  });

  it("renders edit mode with FormTabNav and basic section", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    expect(container.querySelector('[data-testid="dialog"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="form-tab-nav"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="basic-info-section"]')).toBeTruthy();

    unmount();
  });

  it("renders dialog title and description in edit step", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const titleEl = container.querySelector('[data-testid="dialog-title"]');
    expect(titleEl?.textContent).toContain("dialog.editTitle");

    const descEl = container.querySelector('[data-testid="dialog-description"]');
    expect(descEl?.textContent).toContain("dialog.editDesc");

    unmount();
  });

  it("next button is disabled when no dirty fields", () => {
    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    // Second button in footer is "Next" (first is "Cancel")
    const nextButton = buttons[1] as HTMLButtonElement;

    expect(nextButton).toBeTruthy();
    expect(nextButton.disabled).toBe(true);

    unmount();
  });

  it("next button is enabled when dirty fields exist", () => {
    mockDirtyFields = new Set(["routing.priority"]);

    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    const nextButton = buttons[1] as HTMLButtonElement;

    expect(nextButton).toBeTruthy();
    expect(nextButton.disabled).toBe(false);

    unmount();
  });

  it("cancel button calls onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    const { container, unmount } = render(
      <ProviderBatchDialog {...defaultProps({ onOpenChange })} />
    );

    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const buttons = footer?.querySelectorAll("button") ?? [];
    const cancelButton = buttons[0] as HTMLButtonElement;

    act(() => {
      cancelButton.click();
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);

    unmount();
  });

  it("next button calls preview when dirty fields exist", async () => {
    mockDirtyFields = new Set(["routing.priority"]);
    const { previewProviderBatchPatch } = await import("@/actions/providers");

    const { container, unmount } = render(<ProviderBatchDialog {...defaultProps()} />);

    const footer = container.querySelector('[data-testid="dialog-footer"]');
    const nextButton = (footer?.querySelectorAll("button") ?? [])[1] as HTMLButtonElement;

    await act(async () => {
      nextButton.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(previewProviderBatchPatch).toHaveBeenCalledTimes(1);

    unmount();
  });
});

describe("ProviderBatchDialog - Delete Mode", () => {
  it("renders AlertDialog for delete mode", () => {
    const { container, unmount } = render(
      <ProviderBatchDialog {...defaultProps({ mode: "delete" })} />
    );

    expect(container.querySelector('[data-testid="alert-dialog"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dialog"]')).toBeFalsy();

    const text = container.textContent ?? "";
    expect(text).toContain("dialog.deleteTitle");

    unmount();
  });
});

describe("ProviderBatchDialog - Reset Circuit Mode", () => {
  it("renders AlertDialog for resetCircuit mode", () => {
    const { container, unmount } = render(
      <ProviderBatchDialog {...defaultProps({ mode: "resetCircuit" })} />
    );

    expect(container.querySelector('[data-testid="alert-dialog"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="dialog"]')).toBeFalsy();

    const text = container.textContent ?? "";
    expect(text).toContain("dialog.resetCircuitTitle");

    unmount();
  });
});

describe("ProviderBatchDialog - Closed State", () => {
  it("renders nothing when open is false", () => {
    const { container, unmount } = render(
      <ProviderBatchDialog {...defaultProps({ open: false })} />
    );

    expect(container.querySelector('[data-testid="dialog"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="alert-dialog"]')).toBeFalsy();

    unmount();
  });
});
