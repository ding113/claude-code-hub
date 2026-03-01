/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderBatchPreviewRow } from "@/actions/providers";
import { ProviderBatchPreviewStep } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-preview-step";

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

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onCheckedChange?.(!checked)}
      {...props}
    />
  ),
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

function makeRow(overrides: Partial<ProviderBatchPreviewRow> = {}): ProviderBatchPreviewRow {
  return {
    providerId: 1,
    providerName: "TestProvider",
    field: "priority",
    status: "changed",
    before: 0,
    after: 10,
    ...overrides,
  };
}

const defaultSummary = { providerCount: 2, fieldCount: 3, skipCount: 1 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProviderBatchPreviewStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders changed rows with before/after values", () => {
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({ providerId: 1, providerName: "Alpha", field: "priority", before: 0, after: 5 }),
      makeRow({ providerId: 1, providerName: "Alpha", field: "weight", before: 1, after: 10 }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={{ providerCount: 1, fieldCount: 2, skipCount: 0 }}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
      />
    );

    const changedRow1 = container.querySelector('[data-testid="preview-row-1-priority"]');
    expect(changedRow1).toBeTruthy();
    expect(changedRow1?.getAttribute("data-status")).toBe("changed");
    // Mock t() returns key with params substituted where {param} appears in key
    // "preview.fieldChanged" does not contain {field} etc, so text is key with params inserted
    expect(changedRow1?.textContent).toContain("preview.fieldChanged");

    const changedRow2 = container.querySelector('[data-testid="preview-row-1-weight"]');
    expect(changedRow2).toBeTruthy();
    expect(changedRow2?.getAttribute("data-status")).toBe("changed");

    unmount();
  });

  it("renders skipped rows with skip reason", () => {
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({
        providerId: 2,
        providerName: "Beta",
        field: "anthropic_thinking_budget_preference",
        status: "skipped",
        before: null,
        after: null,
        skipReason: "not_applicable",
      }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={{ providerCount: 1, fieldCount: 0, skipCount: 1 }}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
      />
    );

    const skippedRow = container.querySelector(
      '[data-testid="preview-row-2-anthropic_thinking_budget_preference"]'
    );
    expect(skippedRow).toBeTruthy();
    expect(skippedRow?.getAttribute("data-status")).toBe("skipped");
    expect(skippedRow?.textContent).toContain("preview.fieldSkipped");

    unmount();
  });

  it("groups rows by provider", () => {
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({ providerId: 1, providerName: "Alpha", field: "priority" }),
      makeRow({ providerId: 2, providerName: "Beta", field: "weight" }),
      makeRow({ providerId: 1, providerName: "Alpha", field: "is_enabled" }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={defaultSummary}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
      />
    );

    const provider1 = container.querySelector('[data-testid="preview-provider-1"]');
    const provider2 = container.querySelector('[data-testid="preview-provider-2"]');
    expect(provider1).toBeTruthy();
    expect(provider2).toBeTruthy();

    // Provider 1 should have 2 rows
    const p1Rows = provider1?.querySelectorAll("[data-status]");
    expect(p1Rows?.length).toBe(2);

    // Provider 2 should have 1 row
    const p2Rows = provider2?.querySelectorAll("[data-status]");
    expect(p2Rows?.length).toBe(1);

    unmount();
  });

  it("shows summary counts", () => {
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({ providerId: 1, providerName: "Alpha", field: "priority" }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={{ providerCount: 5, fieldCount: 8, skipCount: 2 }}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
      />
    );

    const summary = container.querySelector('[data-testid="preview-summary"]');
    expect(summary).toBeTruthy();
    // The mock t() substitutes {providerCount} -> 5, {fieldCount} -> 8, {skipCount} -> 2
    // into the key "preview.summary" which becomes "preview.summary" with params replaced
    const text = summary?.textContent ?? "";
    expect(text).toContain("preview.summary");

    unmount();
  });

  it("exclusion checkbox toggles provider", () => {
    const onToggle = vi.fn();
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({ providerId: 3, providerName: "Gamma", field: "priority" }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={defaultSummary}
        excludedProviderIds={new Set()}
        onExcludeToggle={onToggle}
      />
    );

    const checkbox = container.querySelector(
      '[data-testid="exclude-checkbox-3"]'
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true); // not excluded = checked

    act(() => {
      checkbox.click();
    });

    expect(onToggle).toHaveBeenCalledWith(3);

    unmount();
  });

  it("loading state shows spinner", () => {
    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={[]}
        summary={{ providerCount: 0, fieldCount: 0, skipCount: 0 }}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
        isLoading={true}
      />
    );

    const loading = container.querySelector('[data-testid="preview-loading"]');
    expect(loading).toBeTruthy();

    // Should not show the empty state
    const empty = container.querySelector('[data-testid="preview-empty"]');
    expect(empty).toBeNull();

    unmount();
  });

  it("shows empty state when no rows and not loading", () => {
    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={[]}
        summary={{ providerCount: 0, fieldCount: 0, skipCount: 0 }}
        excludedProviderIds={new Set()}
        onExcludeToggle={() => {}}
      />
    );

    const empty = container.querySelector('[data-testid="preview-empty"]');
    expect(empty).toBeTruthy();

    unmount();
  });

  it("excluded provider checkbox shows unchecked", () => {
    const rows: ProviderBatchPreviewRow[] = [
      makeRow({ providerId: 7, providerName: "Excluded", field: "weight" }),
    ];

    const { container, unmount } = render(
      <ProviderBatchPreviewStep
        rows={rows}
        summary={defaultSummary}
        excludedProviderIds={new Set([7])}
        onExcludeToggle={() => {}}
      />
    );

    const checkbox = container.querySelector(
      '[data-testid="exclude-checkbox-7"]'
    ) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(false); // excluded = unchecked

    unmount();
  });
});
