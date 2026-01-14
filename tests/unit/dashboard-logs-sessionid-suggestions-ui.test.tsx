/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";
import { UsageLogsFilters } from "@/app/[locale]/dashboard/logs/_components/usage-logs-filters";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

const usageLogsActionMocks = vi.hoisted(() => ({
  exportUsageLogs: vi.fn(async () => ({ ok: true, data: "" })),
  getUsageLogSessionIdSuggestions: vi.fn(async () => ({ ok: true, data: ["session_1"] })),
  getModelList: vi.fn(async () => ({ ok: true, data: [] })),
  getStatusCodeList: vi.fn(async () => ({ ok: true, data: [] })),
  getEndpointList: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/actions/usage-logs", () => ({
  exportUsageLogs: usageLogsActionMocks.exportUsageLogs,
  getUsageLogSessionIdSuggestions: usageLogsActionMocks.getUsageLogSessionIdSuggestions,
  getModelList: usageLogsActionMocks.getModelList,
  getStatusCodeList: usageLogsActionMocks.getStatusCodeList,
  getEndpointList: usageLogsActionMocks.getEndpointList,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("UsageLogsFilters sessionId suggestions", () => {
  test("should debounce and require min length (>=2)", async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = "";

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <UsageLogsFilters
          isAdmin={false}
          providers={[]}
          initialKeys={[]}
          filters={{}}
          onChange={() => {}}
          onReset={() => {}}
        />
      );
    });

    const input = container.querySelector(
      'input[placeholder="logs.filters.searchSessionId"]'
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();

    await act(async () => {
      setReactInputValue(input!, "a");
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await flushMicrotasks();

    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).not.toHaveBeenCalled();

    await act(async () => {
      setReactInputValue(input!, "ab");
    });

    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    await flushMicrotasks();
    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flushMicrotasks();

    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenCalledTimes(1);
    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ term: "ab" })
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });
});
