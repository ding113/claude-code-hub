/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProviderDisplay, ProviderType } from "@/types/provider";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      let result = key;
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
      return result;
    }
    return key;
  },
}));

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
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <div role="menuitem" onClick={onClick}>
      {children}
    </div>
  ),
}));

vi.mock("lucide-react", () => ({
  ChevronDown: () => <span />,
  Pencil: () => <span />,
  X: () => <span />,
}));

import {
  ProviderBatchToolbar,
  type ProviderBatchToolbarProps,
} from "@/app/[locale]/settings/providers/_components/batch-edit/provider-batch-toolbar";

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

function defaultProps(
  overrides: Partial<ProviderBatchToolbarProps> = {}
): ProviderBatchToolbarProps {
  return {
    isMultiSelectMode: false,
    allSelected: false,
    selectedCount: 0,
    totalCount: 3,
    onEnterMode: vi.fn(),
    onExitMode: vi.fn(),
    onSelectAll: vi.fn(),
    onInvertSelection: vi.fn(),
    onOpenBatchEdit: vi.fn(),
    providers: [
      createProvider(1, "claude"),
      createProvider(2, "openai"),
      createProvider(3, "claude"),
    ],
    onSelectByType: vi.fn(),
    onSelectByGroup: vi.fn(),
    ...overrides,
  };
}

describe("ProviderBatchToolbar - discoverability hint", () => {
  describe("not in multi-select mode", () => {
    it("shows enter-mode button and hint text when totalCount > 1", () => {
      const props = defaultProps({ totalCount: 3 });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const buttons = container.querySelectorAll("button");
      const enterBtn = Array.from(buttons).find((b) => b.textContent?.includes("enterMode"));
      expect(enterBtn).toBeTruthy();

      const hint = container.querySelector("span.text-xs");
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toBe("selectionHint");

      unmount();
    });

    it("shows hint when totalCount is exactly 1 (totalCount > 0 condition)", () => {
      const props = defaultProps({
        totalCount: 1,
        providers: [createProvider(1, "claude")],
      });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const hint = container.querySelector("span.text-xs");
      expect(hint).toBeTruthy();

      unmount();
    });

    it("does NOT show hint when totalCount is 0", () => {
      const props = defaultProps({ totalCount: 0, providers: [] });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const hint = container.querySelector("span.text-xs");
      expect(hint).toBeNull();

      unmount();
    });

    it("hint uses i18n key selectionHint", () => {
      const props = defaultProps({ totalCount: 5 });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const hint = container.querySelector("span.text-xs");
      expect(hint).toBeTruthy();
      expect(hint!.textContent).toBe("selectionHint");

      unmount();
    });

    it("enter-mode button is disabled when totalCount is 0", () => {
      const props = defaultProps({ totalCount: 0, providers: [] });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const buttons = container.querySelectorAll("button");
      const enterBtn = Array.from(buttons).find((b) => b.textContent?.includes("enterMode"));
      expect(enterBtn).toBeTruthy();
      expect(enterBtn!.disabled).toBe(true);

      unmount();
    });
  });

  describe("in multi-select mode", () => {
    it("does NOT show hint text", () => {
      const props = defaultProps({ isMultiSelectMode: true, selectedCount: 1 });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const allSpans = container.querySelectorAll("span");
      const hintSpan = Array.from(allSpans).find((s) => s.textContent === "selectionHint");
      expect(hintSpan).toBeFalsy();

      unmount();
    });

    it("renders select-all checkbox and selected count", () => {
      const props = defaultProps({ isMultiSelectMode: true, selectedCount: 2 });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeTruthy();

      const countText = Array.from(container.querySelectorAll("span")).find((s) =>
        s.textContent?.includes("selectedCount")
      );
      expect(countText).toBeTruthy();

      unmount();
    });

    it("renders invert, edit, and exit buttons", () => {
      const props = defaultProps({ isMultiSelectMode: true, selectedCount: 1 });
      const { container, unmount } = render(<ProviderBatchToolbar {...props} />);

      const buttons = container.querySelectorAll("button");
      const texts = Array.from(buttons).map((b) => b.textContent);

      expect(texts.some((t) => t?.includes("invertSelection"))).toBe(true);
      expect(texts.some((t) => t?.includes("editSelected"))).toBe(true);
      expect(texts.some((t) => t?.includes("exitMode"))).toBe(true);

      unmount();
    });
  });
});
