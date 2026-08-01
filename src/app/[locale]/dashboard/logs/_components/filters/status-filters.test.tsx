import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { UsageLogFilters } from "./types";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("../../_hooks/use-lazy-filter-options", () => ({
  useLazyStatusCodes: () => ({
    data: [],
    isLoading: false,
    onOpenChange: vi.fn(),
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

import { StatusFilters } from "./status-filters";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("StatusFilters Replay filter", () => {
  test("preserves existing filters when selecting non-Replay requests", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onFiltersChange = vi.fn<(filters: UsageLogFilters) => void>();

    act(() => {
      root.render(
        <StatusFilters
          filters={{ statusCode: 200, replayFilter: "replay" }}
          onFiltersChange={onFiltersChange}
        />
      );
    });

    const replaySelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "non-replay")
    );
    expect(replaySelect).toBeDefined();

    act(() => {
      if (!replaySelect) return;
      replaySelect.value = "non-replay";
      replaySelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onFiltersChange).toHaveBeenCalledWith({
      statusCode: 200,
      replayFilter: "non-replay",
    });

    act(() => root.unmount());
  });
});
