/**
 * @vitest-environment happy-dom
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelBreakdownItem,
  ModelBreakdownLabels,
} from "@/components/analytics/model-breakdown-column";
import {
  ModelBreakdownColumn,
  ModelBreakdownRow,
} from "@/components/analytics/model-breakdown-column";

// -- mocks --

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog">{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/lib/utils/currency", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/utils/currency")>("@/lib/utils/currency");
  return {
    ...actual,
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  };
});

// -- helpers --

function makeItem(overrides: Partial<ModelBreakdownItem> = {}): ModelBreakdownItem {
  return {
    model: "claude-opus-4",
    requests: 150,
    cost: 3.5,
    inputTokens: 10000,
    outputTokens: 5000,
    cacheCreationTokens: 2000,
    cacheReadTokens: 8000,
    ...overrides,
  };
}

const customLabels: ModelBreakdownLabels = {
  unknownModel: "Custom Unknown",
  modal: {
    requests: "Custom Requests",
    cost: "Custom Cost",
    inputTokens: "Custom Input",
    outputTokens: "Custom Output",
    cacheCreationTokens: "Custom Cache Write",
    cacheReadTokens: "Custom Cache Read",
    totalTokens: "Custom Total Tokens",
    costPercentage: "Custom Cost %",
    cacheHitRate: "Custom Cache Hit",
    cacheTokens: "Custom Cache Tokens",
    performanceHigh: "Custom High",
    performanceMedium: "Custom Medium",
    performanceLow: "Custom Low",
  },
};

function renderText(element: React.ReactElement): string {
  const markup = renderToStaticMarkup(element);
  const container = document.createElement("div");
  // Safe: content comes from our own renderToStaticMarkup, not user input
  container.textContent = "";
  const template = document.createElement("template");
  template.innerHTML = markup;
  container.appendChild(template.content.cloneNode(true));
  return container.textContent ?? "";
}

// -- tests --

describe("ModelBreakdownColumn", () => {
  it("renders model name for each page item", () => {
    const items = [makeItem({ model: "gpt-4.1" }), makeItem({ model: "claude-sonnet-4" })];

    const text = renderText(
      <ModelBreakdownColumn
        pageItems={items}
        currencyCode="USD"
        totalCost={10}
        keyPrefix="key"
        pageOffset={0}
      />
    );

    expect(text).toContain("gpt-4.1");
    expect(text).toContain("claude-sonnet-4");
  });

  it("renders unknownModel label for null model", () => {
    const items = [makeItem({ model: null })];

    const text = renderText(
      <ModelBreakdownColumn
        pageItems={items}
        currencyCode="USD"
        totalCost={10}
        keyPrefix="key"
        pageOffset={0}
      />
    );

    // Falls back to useTranslations which returns "t:unknownModel"
    expect(text).toContain("t:unknownModel");
  });

  it("renders request count and token amounts", () => {
    const items = [
      makeItem({
        requests: 42,
        inputTokens: 1500,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 300,
      }),
    ];

    const text = renderText(
      <ModelBreakdownColumn
        pageItems={items}
        currencyCode="USD"
        totalCost={10}
        keyPrefix="key"
        pageOffset={0}
      />
    );

    // Request count
    expect(text).toContain("42");
    // Total tokens = 1500 + 500 + 200 + 300 = 2500 -> "2.5K"
    expect(text).toContain("2.5K");
  });

  it("passes correct props to ModelBreakdownRow", () => {
    const item = makeItem({ model: "test-model", cost: 5.0, requests: 99 });

    const text = renderText(
      <ModelBreakdownColumn
        pageItems={[item]}
        currencyCode="USD"
        totalCost={10}
        keyPrefix="test"
        pageOffset={0}
      />
    );

    // Model name
    expect(text).toContain("test-model");
    // Request count
    expect(text).toContain("99");
    // Cost formatted
    expect(text).toContain("$5.00");
    // Cost percentage = (5/10)*100 = 50.0
    expect(text).toContain("50.0%");
  });

  it("uses custom labels when provided", () => {
    const items = [makeItem({ model: null })];

    const text = renderText(
      <ModelBreakdownColumn
        pageItems={items}
        currencyCode="USD"
        totalCost={10}
        keyPrefix="key"
        pageOffset={0}
        labels={customLabels}
      />
    );

    // Custom unknown model label instead of "t:unknownModel"
    expect(text).toContain("Custom Unknown");
    expect(text).not.toContain("t:unknownModel");
    // Custom modal labels appear in the dialog content
    expect(text).toContain("Custom Requests");
    expect(text).toContain("Custom Cost");
    expect(text).toContain("Custom Total Tokens");
    expect(text).toContain("Custom Cache Tokens");
    expect(text).toContain("Custom Cache Hit");
  });
});

describe("ModelBreakdownRow", () => {
  it("renders model name and metrics in the row", () => {
    const text = renderText(
      <ModelBreakdownRow
        model="claude-opus-4"
        requests={150}
        cost={3.5}
        inputTokens={10000}
        outputTokens={5000}
        cacheCreationTokens={2000}
        cacheReadTokens={8000}
        currencyCode="USD"
        totalCost={10}
      />
    );

    expect(text).toContain("claude-opus-4");
    expect(text).toContain("150");
    expect(text).toContain("$3.50");
  });

  it("computes cache hit rate correctly", () => {
    // totalInputTokens = 10000 + 2000 + 8000 = 20000
    // cacheHitRate = (8000 / 20000) * 100 = 40.0
    const text = renderText(
      <ModelBreakdownRow
        model="test"
        requests={1}
        cost={1}
        inputTokens={10000}
        outputTokens={5000}
        cacheCreationTokens={2000}
        cacheReadTokens={8000}
        currencyCode="USD"
        totalCost={10}
      />
    );

    expect(text).toContain("40.0%");
  });

  it("shows zero cache hit rate when no input tokens", () => {
    const text = renderText(
      <ModelBreakdownRow
        model="test"
        requests={1}
        cost={1}
        inputTokens={0}
        outputTokens={100}
        cacheCreationTokens={0}
        cacheReadTokens={0}
        currencyCode="USD"
        totalCost={10}
      />
    );

    expect(text).toContain("0.0%");
  });

  it("uses translation fallback when no labels provided", () => {
    const text = renderText(
      <ModelBreakdownRow
        model={null}
        requests={1}
        cost={1}
        inputTokens={100}
        outputTokens={50}
        cacheCreationTokens={0}
        cacheReadTokens={0}
        currencyCode="USD"
        totalCost={10}
      />
    );

    // unknownModel via translation mock
    expect(text).toContain("t:unknownModel");
    // modal labels via translation mock
    expect(text).toContain("t:modal.requests");
    expect(text).toContain("t:modal.cacheWrite");
    expect(text).toContain("t:modal.cacheRead");
  });

  it("uses custom labels when provided", () => {
    const text = renderText(
      <ModelBreakdownRow
        model={null}
        requests={1}
        cost={1}
        inputTokens={100}
        outputTokens={50}
        cacheCreationTokens={0}
        cacheReadTokens={0}
        currencyCode="USD"
        totalCost={10}
        labels={customLabels}
      />
    );

    expect(text).toContain("Custom Unknown");
    expect(text).toContain("Custom Requests");
    expect(text).toContain("Custom Cache Write");
    expect(text).toContain("Custom Cache Read");
    expect(text).toContain("Custom Cache Tokens");
    expect(text).not.toContain("t:unknownModel");
  });
});
