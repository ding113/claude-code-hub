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
const mockState = {
  ui: { activeTab: "basic" as const, isPending: false, showFailureThresholdConfirm: false },
  basic: { name: "", url: "", key: "", websiteUrl: "" },
  routing: {
    providerType: "claude" as const,
    groupTag: [],
    preserveClientIp: false,
    modelRedirects: {},
    allowedModels: [],
    priority: 5,
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

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

const mockPreview = vi.fn();
const mockApply = vi.fn();
const mockUndo = vi.fn();
vi.mock("@/actions/providers", () => ({
  previewProviderBatchPatch: (...args: unknown[]) => mockPreview(...args),
  applyProviderBatchPatch: (...args: unknown[]) => mockApply(...args),
  undoProviderPatch: (...args: unknown[]) => mockUndo(...args),
  batchDeleteProviders: vi.fn().mockResolvedValue({ ok: true, data: { deletedCount: 1 } }),
  batchResetProviderCircuits: vi.fn().mockResolvedValue({ ok: true, data: { resetCount: 1 } }),
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
    BasicInfoSection: () => <div data-testid="basic-info-section" />,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section",
  () => ({
    RoutingSection: () => <div data-testid="routing-section" />,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/limits-section",
  () => ({
    LimitsSection: () => <div data-testid="limits-section" />,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/network-section",
  () => ({
    NetworkSection: () => <div data-testid="network-section" />,
  })
);
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/sections/testing-section",
  () => ({
    TestingSection: () => <div data-testid="testing-section" />,
  })
);

// Mock FormTabNav
vi.mock(
  "@/app/[locale]/settings/providers/_components/forms/provider-form/components/form-tab-nav",
  () => ({
    FormTabNav: () => <div data-testid="form-tab-nav" />,
  })
);

// Mock ProviderBatchPreviewStep
vi.mock(
  "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-preview-step",
  () => ({
    ProviderBatchPreviewStep: () => <div data-testid="preview-step" />,
  })
);

// Mock buildPatchDraftFromFormState
vi.mock(
  "@/app/[locale]/settings/providers/_components/batch-edit/build-patch-draft",
  () => ({
    buildPatchDraftFromFormState: vi.fn().mockReturnValue({ priority: { set: 5 } }),
  })
);

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

function render(ui: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function createMockProvider(id: number, name: string): ProviderDisplay {
  return {
    id,
    name,
    url: "https://api.example.com",
    maskedKey: "xxxx****1234",
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

function defaultProps(overrides: Partial<React.ComponentProps<typeof ProviderBatchDialog>> = {}) {
  return {
    open: true,
    mode: "edit" as const,
    onOpenChange: vi.fn(),
    selectedProviderIds: new Set([1, 2]),
    providers: [createMockProvider(1, "Provider1"), createMockProvider(2, "Provider2")],
    onSuccess: vi.fn(),
    ...overrides,
  };
}

/**
 * Drives the dialog from "edit" step through "preview" step to "apply":
 *   1. Click "Next" (second button in edit-step footer)
 *   2. Wait for preview to resolve
 *   3. Click "Apply" (second button in preview-step footer)
 *   4. Wait for apply to resolve
 */
async function driveToApply(container: HTMLElement) {
  // Click Next (second button in footer)
  const footer = container.querySelector('[data-testid="dialog-footer"]');
  const buttons = footer?.querySelectorAll("button") ?? [];
  const nextButton = buttons[1] as HTMLButtonElement;

  await act(async () => {
    nextButton.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

  // Click Apply (second button in preview-step footer)
  const applyFooter = container.querySelector('[data-testid="dialog-footer"]');
  const applyButtons = applyFooter?.querySelectorAll("button") ?? [];
  const applyButton = applyButtons[1] as HTMLButtonElement;

  await act(async () => {
    applyButton.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Provider Undo Toast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make hasChanges true so the "Next" button is enabled
    mockDirtyFields = new Set(["routing.priority"]);
  });

  it("shows undo toast after successful apply", async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: {
        previewToken: "tok-1",
        previewRevision: "rev-1",
        previewExpiresAt: new Date(Date.now() + 60000).toISOString(),
        providerIds: [1, 2],
        changedFields: ["priority"],
        rows: [
          {
            providerId: 1,
            providerName: "Provider1",
            field: "priority",
            status: "changed",
            before: 0,
            after: 5,
          },
          {
            providerId: 2,
            providerName: "Provider2",
            field: "priority",
            status: "changed",
            before: 0,
            after: 5,
          },
        ],
        summary: { providerCount: 2, fieldCount: 2, skipCount: 0 },
      },
    });

    mockApply.mockResolvedValue({
      ok: true,
      data: {
        operationId: "op-1",
        appliedAt: new Date().toISOString(),
        updatedCount: 2,
        undoToken: "undo-tok-1",
        undoExpiresAt: new Date(Date.now() + 10000).toISOString(),
      },
    });

    const props = defaultProps();
    const { container, unmount } = render(<ProviderBatchDialog {...props} />);

    await driveToApply(container);

    expect(mockPreview).toHaveBeenCalledTimes(1);
    expect(mockApply).toHaveBeenCalledTimes(1);

    // Verify toast.success was called with undo action
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "toast.updated",
      expect.objectContaining({
        duration: 10000,
        action: expect.objectContaining({
          label: expect.any(String),
          onClick: expect.any(Function),
        }),
      })
    );

    unmount();
  });

  it("undo action calls undoProviderPatch on success", async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: {
        previewToken: "tok-2",
        previewRevision: "rev-2",
        previewExpiresAt: new Date(Date.now() + 60000).toISOString(),
        providerIds: [1],
        changedFields: ["priority"],
        rows: [
          {
            providerId: 1,
            providerName: "Provider1",
            field: "priority",
            status: "changed",
            before: 0,
            after: 5,
          },
        ],
        summary: { providerCount: 1, fieldCount: 1, skipCount: 0 },
      },
    });

    mockApply.mockResolvedValue({
      ok: true,
      data: {
        operationId: "op-2",
        appliedAt: new Date().toISOString(),
        updatedCount: 1,
        undoToken: "undo-tok-2",
        undoExpiresAt: new Date(Date.now() + 10000).toISOString(),
      },
    });

    mockUndo.mockResolvedValue({
      ok: true,
      data: {
        operationId: "op-2",
        revertedAt: new Date().toISOString(),
        revertedCount: 1,
      },
    });

    const props = defaultProps({ selectedProviderIds: new Set([1]) });
    const { container, unmount } = render(<ProviderBatchDialog {...props} />);

    await driveToApply(container);

    // Extract the undo onClick from the toast call
    const toastCall = mockToastSuccess.mock.calls[0];
    const toastOptions = toastCall[1] as { action: { onClick: () => Promise<void> } };

    // Call the undo action
    await act(async () => {
      await toastOptions.action.onClick();
    });

    expect(mockUndo).toHaveBeenCalledWith({
      undoToken: "undo-tok-2",
      operationId: "op-2",
    });

    // Should show success toast for undo
    expect(mockToastSuccess).toHaveBeenCalledTimes(2);
    expect(mockToastSuccess.mock.calls[1][0]).toBe("toast.undoSuccess");

    unmount();
  });

  it("undo failure shows error toast", async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: {
        previewToken: "tok-3",
        previewRevision: "rev-3",
        previewExpiresAt: new Date(Date.now() + 60000).toISOString(),
        providerIds: [1],
        changedFields: ["priority"],
        rows: [
          {
            providerId: 1,
            providerName: "Provider1",
            field: "priority",
            status: "changed",
            before: 0,
            after: 5,
          },
        ],
        summary: { providerCount: 1, fieldCount: 1, skipCount: 0 },
      },
    });

    mockApply.mockResolvedValue({
      ok: true,
      data: {
        operationId: "op-3",
        appliedAt: new Date().toISOString(),
        updatedCount: 1,
        undoToken: "undo-tok-3",
        undoExpiresAt: new Date(Date.now() + 10000).toISOString(),
      },
    });

    mockUndo.mockResolvedValue({
      ok: false,
      error: "Undo window expired",
      errorCode: "UNDO_EXPIRED",
    });

    const props = defaultProps({ selectedProviderIds: new Set([1]) });
    const { container, unmount } = render(<ProviderBatchDialog {...props} />);

    await driveToApply(container);

    // Extract undo onClick
    const toastCall = mockToastSuccess.mock.calls[0];
    const toastOptions = toastCall[1] as { action: { onClick: () => Promise<void> } };

    // Call undo - should fail
    await act(async () => {
      await toastOptions.action.onClick();
    });

    expect(mockUndo).toHaveBeenCalledTimes(1);
    // After undo failure, error toast is shown via toast.error
    expect(mockToastError).toHaveBeenCalled();

    unmount();
  });

  it("apply shows error toast on failure", async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      data: {
        previewToken: "tok-4",
        previewRevision: "rev-4",
        previewExpiresAt: new Date(Date.now() + 60000).toISOString(),
        providerIds: [1],
        changedFields: ["priority"],
        rows: [
          {
            providerId: 1,
            providerName: "Provider1",
            field: "priority",
            status: "changed",
            before: 0,
            after: 5,
          },
        ],
        summary: { providerCount: 1, fieldCount: 1, skipCount: 0 },
      },
    });

    mockApply.mockResolvedValue({
      ok: false,
      error: "Preview expired",
      errorCode: "PREVIEW_EXPIRED",
    });

    const props = defaultProps({ selectedProviderIds: new Set([1]) });
    const { container, unmount } = render(<ProviderBatchDialog {...props} />);

    await driveToApply(container);

    expect(mockApply).toHaveBeenCalledTimes(1);
    // After apply failure, error toast is shown via toast.error
    expect(mockToastError).toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();

    unmount();
  });
});
