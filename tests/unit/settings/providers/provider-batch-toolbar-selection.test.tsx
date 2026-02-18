/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProviderDisplay, ProviderType } from "@/types/provider";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e: any) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  ),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown-menu">{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => (
    <div data-testid="dropdown-menu-trigger">{children}</div>
  ),
  DropdownMenuContent: ({ children }: any) => (
    <div data-testid="dropdown-menu-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onClick, ...props }: any) => (
    <div data-testid="dropdown-menu-item" role="menuitem" onClick={onClick} {...props}>
      {children}
    </div>
  ),
}));

// Mock lucide-react
vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

function createProvider(
  id: number,
  providerType: ProviderType,
  groupTag: string | null = null
): ProviderDisplay {
  return { id, providerType, groupTag } as ProviderDisplay;
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

// Import after mocks
import { ProviderBatchToolbar } from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-toolbar";

const defaultProps = {
  isMultiSelectMode: false,
  allSelected: false,
  selectedCount: 0,
  totalCount: 5,
  onEnterMode: vi.fn(),
  onExitMode: vi.fn(),
  onSelectAll: vi.fn(),
  onInvertSelection: vi.fn(),
  onOpenBatchEdit: vi.fn(),
  providers: [] as ProviderDisplay[],
  onSelectByType: vi.fn(),
  onSelectByGroup: vi.fn(),
};

describe("ProviderBatchToolbar - Selection enhancements", () => {
  it("does NOT render type/group dropdowns when NOT in multi-select mode", () => {
    const providers = [createProvider(1, "claude"), createProvider(2, "openai-compatible")];

    const { container, unmount } = render(
      <ProviderBatchToolbar {...defaultProps} providers={providers} />
    );

    const dropdowns = container.querySelectorAll('[data-testid="dropdown-menu"]');
    expect(dropdowns.length).toBe(0);

    unmount();
  });

  it("renders Select by Type dropdown in multi-select mode when providers have multiple types", () => {
    const providers = [
      createProvider(1, "claude"),
      createProvider(2, "claude"),
      createProvider(3, "openai-compatible"),
    ];

    const { container, unmount } = render(
      <ProviderBatchToolbar {...defaultProps} isMultiSelectMode={true} providers={providers} />
    );

    const buttons = container.querySelectorAll("button");
    const typeButton = Array.from(buttons).find((b) => b.textContent?.includes("selectByType"));
    expect(typeButton).toBeTruthy();

    const items = container.querySelectorAll('[data-testid="dropdown-menu-item"]');
    const typeItems = Array.from(items).filter(
      (item) =>
        item.getAttribute("data-value") === "claude" ||
        item.getAttribute("data-value") === "openai-compatible"
    );
    expect(typeItems.length).toBe(2);

    unmount();
  });

  it("calls onSelectByType with correct type when clicking a type option", () => {
    const onSelectByType = vi.fn();
    const providers = [createProvider(1, "claude"), createProvider(2, "openai-compatible")];

    const { container, unmount } = render(
      <ProviderBatchToolbar
        {...defaultProps}
        isMultiSelectMode={true}
        providers={providers}
        onSelectByType={onSelectByType}
      />
    );

    const claudeItem = container.querySelector('[data-value="claude"]');
    expect(claudeItem).toBeTruthy();

    act(() => {
      claudeItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectByType).toHaveBeenCalledWith("claude");

    unmount();
  });

  it("renders Select by Group dropdown when providers have groups", () => {
    const providers = [
      createProvider(1, "claude", "production"),
      createProvider(2, "claude", "staging"),
      createProvider(3, "claude", "production"),
    ];

    const { container, unmount } = render(
      <ProviderBatchToolbar {...defaultProps} isMultiSelectMode={true} providers={providers} />
    );

    const buttons = container.querySelectorAll("button");
    const groupButton = Array.from(buttons).find((b) => b.textContent?.includes("selectByGroup"));
    expect(groupButton).toBeTruthy();

    const items = container.querySelectorAll('[data-testid="dropdown-menu-item"]');
    const groupItems = Array.from(items).filter(
      (item) =>
        item.getAttribute("data-value") === "production" ||
        item.getAttribute("data-value") === "staging"
    );
    expect(groupItems.length).toBe(2);

    unmount();
  });

  it("calls onSelectByGroup with correct group when clicking a group option", () => {
    const onSelectByGroup = vi.fn();
    const providers = [
      createProvider(1, "claude", "production"),
      createProvider(2, "claude", "staging"),
    ];

    const { container, unmount } = render(
      <ProviderBatchToolbar
        {...defaultProps}
        isMultiSelectMode={true}
        providers={providers}
        onSelectByGroup={onSelectByGroup}
      />
    );

    const productionItem = container.querySelector('[data-value="production"]');
    expect(productionItem).toBeTruthy();

    act(() => {
      productionItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectByGroup).toHaveBeenCalledWith("production");

    unmount();
  });

  it("does NOT render type dropdown when all filtered providers have same type", () => {
    const providers = [createProvider(1, "claude"), createProvider(2, "claude")];

    const { container, unmount } = render(
      <ProviderBatchToolbar {...defaultProps} isMultiSelectMode={true} providers={providers} />
    );

    const buttons = container.querySelectorAll("button");
    const typeButton = Array.from(buttons).find((b) => b.textContent?.includes("selectByType"));
    expect(typeButton).toBeFalsy();

    unmount();
  });

  it("does NOT render group dropdown when no groups exist", () => {
    const providers = [
      createProvider(1, "claude", null),
      createProvider(2, "openai-compatible", null),
    ];

    const { container, unmount } = render(
      <ProviderBatchToolbar {...defaultProps} isMultiSelectMode={true} providers={providers} />
    );

    const buttons = container.querySelectorAll("button");
    const groupButton = Array.from(buttons).find((b) => b.textContent?.includes("selectByGroup"));
    expect(groupButton).toBeFalsy();

    unmount();
  });
});
