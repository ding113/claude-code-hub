/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

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

const usersActionMocks = vi.hoisted(() => ({
  searchUsersForFilter: vi.fn(async () => ({
    ok: true,
    data: [] as Array<{ id: number; name: string }>,
  })),
}));

vi.mock("@/actions/usage-logs", () => ({
  exportUsageLogs: usageLogsActionMocks.exportUsageLogs,
  getUsageLogSessionIdSuggestions: usageLogsActionMocks.getUsageLogSessionIdSuggestions,
  getModelList: usageLogsActionMocks.getModelList,
  getStatusCodeList: usageLogsActionMocks.getStatusCodeList,
  getEndpointList: usageLogsActionMocks.getEndpointList,
}));

vi.mock("@/actions/users", () => ({
  searchUsersForFilter: usersActionMocks.searchUsersForFilter,
}));

vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");

  type PopoverCtx = { open: boolean; onOpenChange?: (open: boolean) => void };
  const PopoverContext = React.createContext<PopoverCtx>({ open: false });

  function Popover({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    return (
      <PopoverContext.Provider value={{ open: Boolean(open), onOpenChange }}>
        {children}
      </PopoverContext.Provider>
    );
  }

  function PopoverTrigger({ asChild, children }: { asChild?: boolean; children?: ReactNode }) {
    const { open, onOpenChange } = React.useContext(PopoverContext);
    const child = React.Children.only(children) as unknown as {
      props: { onClick?: (e: unknown) => void };
    };

    const handleClick = (e: unknown) => {
      child.props.onClick?.(e);
      onOpenChange?.(!open);
    };

    if (asChild) {
      return React.cloneElement(child as never, { onClick: handleClick });
    }

    return (
      <button type="button" onClick={handleClick}>
        {children}
      </button>
    );
  }

  function PopoverContent({ children }: { children?: ReactNode }) {
    const { open } = React.useContext(PopoverContext);
    if (!open) return null;
    return <div>{children}</div>;
  }

  function PopoverAnchor({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
    PopoverAnchor,
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// Mock Collapsible to always show content (bypass collapsed state)
vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// Mock Select components
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

// Mock Command components for provider/sessionId dropdowns
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CommandInput: ({ placeholder }: { placeholder?: string }) => <input placeholder={placeholder} />,
  CommandList: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    onSelect,
  }: {
    children?: ReactNode;
    value?: string;
    onSelect?: () => void;
  }) => (
    <div cmdk-item="" onClick={onSelect}>
      {children}
    </div>
  ),
}));

// Mock lazy filter hooks
vi.mock("@/app/[locale]/dashboard/logs/_hooks/use-lazy-filter-options", () => ({
  useLazyModels: () => ({
    data: [],
    isLoading: false,
    onOpenChange: vi.fn(),
  }),
  useLazyEndpoints: () => ({
    data: [],
    isLoading: false,
    onOpenChange: vi.fn(),
  }),
  useLazyStatusCodes: () => ({
    data: [],
    isLoading: false,
    onOpenChange: vi.fn(),
  }),
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function actClick(el: Element | null) {
  if (!el) throw new Error("element not found");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  test("should keep input focused when opening suggestions popover", async () => {
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
          filters={{ sessionId: "ab" }}
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
      input?.focus();
    });
    await flushMicrotasks();

    expect(document.activeElement).toBe(input);

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await flushMicrotasks();

    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  test("should reload suggestions when provider scope changes (term unchanged)", async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    document.body.innerHTML = "";

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <UsageLogsFilters
          isAdmin={true}
          providers={[
            { id: 1, name: "p1" },
            { id: 2, name: "p2" },
          ]}
          initialKeys={[]}
          filters={{ sessionId: "ab" }}
          onChange={() => {}}
          onReset={() => {}}
        />
      );
    });
    await flushMicrotasks();

    const input = container.querySelector(
      'input[placeholder="logs.filters.searchSessionId"]'
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();

    await act(async () => {
      input?.focus();
    });
    await flushMicrotasks();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await flushMicrotasks();

    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenCalledTimes(1);

    const providerBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("logs.filters.allProviders")
    );
    await actClick(providerBtn ?? null);
    await flushMicrotasks();

    const providerItem = Array.from(document.querySelectorAll("[cmdk-item]")).find((el) =>
      (el.textContent || "").includes("p1")
    );
    await actClick(providerItem ?? null);
    await flushMicrotasks();

    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenCalledTimes(2);
    expect(usageLogsActionMocks.getUsageLogSessionIdSuggestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ term: "ab", providerId: 1 })
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });
});
