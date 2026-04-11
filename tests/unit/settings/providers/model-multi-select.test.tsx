/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ModelMultiSelect } from "@/app/[locale]/settings/providers/_components/model-multi-select";
import commonMessages from "../../../../messages/en/common.json";
import errorsMessages from "../../../../messages/en/errors.json";
import formsMessages from "../../../../messages/en/forms.json";
import settingsMessages from "../../../../messages/en/settings";
import uiMessages from "../../../../messages/en/ui.json";

const modelPricesActionMocks = vi.hoisted(() => ({
  getAvailableModelCatalog: vi.fn(async () => [
    {
      modelName: "openai-new",
      litellmProvider: "openai",
      updatedAt: "2026-04-05T12:00:00.000Z",
    },
    {
      modelName: "anthropic-mid",
      litellmProvider: "anthropic",
      updatedAt: "2026-04-04T12:00:00.000Z",
    },
    {
      modelName: "openai-old",
      litellmProvider: "openai",
      updatedAt: "2026-04-01T12:00:00.000Z",
    },
  ]),
}));
vi.mock("@/actions/model-prices", () => modelPricesActionMocks);

const providerActionMocks = vi.hoisted(() => ({
  fetchUpstreamModels: vi.fn(async () => ({ ok: false, error: "upstream unavailable" })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: false })),
}));
vi.mock("@/actions/providers", () => providerActionMocks);

vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");

  const PopoverContext = React.createContext<{
    open: boolean;
    setOpen: (value: boolean) => void;
  } | null>(null);

  function Popover({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
  }) {
    const [internalOpen, setInternalOpen] = React.useState(Boolean(open));
    const setOpen = (value: boolean) => {
      setInternalOpen(value);
      onOpenChange?.(value);
    };

    return (
      <PopoverContext.Provider value={{ open: internalOpen, setOpen }}>
        {children}
      </PopoverContext.Provider>
    );
  }

  function PopoverTrigger({ children, asChild }: { children?: ReactNode; asChild?: boolean }) {
    const ctx = React.useContext(PopoverContext);
    if (!ctx) return null;
    if (!asChild || !React.isValidElement(children)) {
      return <button onClick={() => ctx.setOpen(!ctx.open)}>{children}</button>;
    }
    return React.cloneElement(children, {
      onClick: () => ctx.setOpen(!ctx.open),
    });
  }

  function PopoverContent({ children }: { children?: ReactNode }) {
    const ctx = React.useContext(PopoverContext);
    if (!ctx?.open) return null;
    return <div data-testid="mock-popover-content">{children}</div>;
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
  };
});

vi.mock("@/components/ui/select", () => {
  function NativeSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) {
    return (
      <select
        data-testid="provider-filter-select"
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    );
  }

  return {
    Select: NativeSelect,
    SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <option value={value}>{children}</option>
    ),
    SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectValue: () => null,
  };
});

function loadMessages() {
  return {
    common: commonMessages,
    errors: errorsMessages,
    ui: uiMessages,
    forms: formsMessages,
    settings: settingsMessages,
  };
}

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushTicks(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ModelMultiSelect", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  async function openPicker() {
    const trigger = document.querySelector(
      "[data-allowed-model-picker-trigger]"
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(5);
  }

  test("falls back to local catalog sorted by newest update first and filters by provider", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect providerType="claude" selectedModels={[]} onChange={onChange} />
      </NextIntlClientProvider>
    );

    expect(modelPricesActionMocks.getAvailableModelCatalog).not.toHaveBeenCalled();
    await openPicker();
    expect(modelPricesActionMocks.getAvailableModelCatalog).toHaveBeenCalledTimes(1);

    const initialItems = Array.from(
      document.querySelectorAll('[data-model-group="available"] [data-slot="command-item"]')
    ).map((element) => element.textContent?.trim() || "");
    expect(initialItems[0]).toContain("openai-new");
    expect(initialItems[1]).toContain("anthropic-mid");
    expect(initialItems[2]).toContain("openai-old");

    const providerFilter = document.querySelector(
      '[data-testid="provider-filter-select"]'
    ) as HTMLSelectElement | null;
    expect(providerFilter).toBeTruthy();

    await act(async () => {
      if (providerFilter) {
        providerFilter.value = "openai";
        providerFilter.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks(2);

    const filteredItems = Array.from(
      document.querySelectorAll('[data-model-group="available"] [data-slot="command-item"]')
    ).map((element) => element.textContent?.trim() || "");
    expect(filteredItems.some((text) => text.includes("anthropic-mid"))).toBe(false);
    expect(filteredItems.some((text) => text.includes("openai-new"))).toBe(true);
    expect(filteredItems.some((text) => text.includes("openai-old"))).toBe(true);

    unmount();
  });

  test("invert selection only toggles the currently filtered provider result set", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect
          providerType="claude"
          selectedModels={["anthropic-mid"]}
          onChange={onChange}
        />
      </NextIntlClientProvider>
    );

    await openPicker();

    const providerFilter = document.querySelector(
      '[data-testid="provider-filter-select"]'
    ) as HTMLSelectElement | null;
    expect(providerFilter).toBeTruthy();

    await act(async () => {
      if (providerFilter) {
        providerFilter.value = "openai";
        providerFilter.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await flushTicks(2);

    const invertButton = document.querySelector(
      "[data-allowed-model-invert]"
    ) as HTMLButtonElement | null;
    expect(invertButton).toBeTruthy();

    await act(async () => {
      invertButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(onChange).toHaveBeenLastCalledWith(["anthropic-mid", "openai-new", "openai-old"]);

    unmount();
  });

  test("prefers upstream models when available", async () => {
    const messages = loadMessages();
    providerActionMocks.fetchUpstreamModels.mockResolvedValueOnce({
      ok: true,
      data: {
        models: ["claude-opus-4-1", "claude-sonnet-4-1"],
        source: "upstream",
      },
    });

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect
          providerType="claude"
          providerUrl="https://api.example.com"
          apiKey="sk-test"
          selectedModels={[]}
          onChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    await openPicker();

    expect(providerActionMocks.fetchUpstreamModels).toHaveBeenCalledTimes(1);
    expect(modelPricesActionMocks.getAvailableModelCatalog).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="provider-filter-select"]')).toBeNull();

    const upstreamItems = Array.from(
      document.querySelectorAll('[data-model-group="available"] [data-slot="command-item"]')
    ).map((element) => element.textContent?.trim() || "");
    expect(upstreamItems.some((text) => text.includes("claude-opus-4-1"))).toBe(true);
    expect(upstreamItems.some((text) => text.includes("claude-sonnet-4-1"))).toBe(true);

    unmount();
  });

  test("取消一个 mixed-case exact 模型时不会连带移除另一个", async () => {
    const messages = loadMessages();
    const onChange = vi.fn();

    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ModelMultiSelect
          providerType="openai"
          selectedModels={["GLM-5", "glm-5"]}
          onChange={onChange}
        />
      </NextIntlClientProvider>
    );

    await openPicker();

    const selectedItems = Array.from(
      document.querySelectorAll('[data-model-group="selected"] [data-slot="command-item"]')
    );
    expect(selectedItems).toHaveLength(2);
    expect(selectedItems.map((item) => item.textContent || "")).toEqual(
      expect.arrayContaining(["GLM-5", "glm-5"])
    );

    const upperItem = selectedItems.find((item) => (item.textContent || "").includes("GLM-5"));
    expect(upperItem).toBeTruthy();

    await act(async () => {
      upperItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushTicks(2);

    expect(onChange).toHaveBeenLastCalledWith(["glm-5"]);

    unmount();
  });
});
