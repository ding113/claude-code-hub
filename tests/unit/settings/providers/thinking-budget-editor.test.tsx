/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ThinkingBudgetEditor } from "@/app/[locale]/settings/providers/_components/thinking-budget-editor";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock Select as native <select> (same pattern as adaptive-thinking-editor)
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (val: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="select-mock">
      <select
        data-testid="select-trigger"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
      >
        {children}
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

// Mock Tooltip as passthrough
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock lucide-react
vi.mock("lucide-react", () => ({
  Info: () => <div data-testid="info-icon" />,
}));

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

describe("ThinkingBudgetEditor", () => {
  const defaultProps = {
    value: "inherit",
    onChange: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with inherit value - no numeric input or max button", () => {
    const { container, unmount } = render(<ThinkingBudgetEditor {...defaultProps} />);

    const select = container.querySelector('[data-testid="select-trigger"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("inherit");

    // No number input when inherit
    expect(container.querySelector('input[type="number"]')).toBeNull();
    // No max-out button when inherit
    expect(container.querySelector("button")).toBeNull();

    unmount();
  });

  it("renders with numeric value - shows custom select, input, and max button", () => {
    const { container, unmount } = render(<ThinkingBudgetEditor {...defaultProps} value="15000" />);

    const select = container.querySelector('[data-testid="select-trigger"]') as HTMLSelectElement;
    expect(select.value).toBe("custom");

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("15000");

    const maxButton = container.querySelector("button");
    expect(maxButton).toBeTruthy();
    expect(maxButton?.textContent).toContain("maxOutButton");

    unmount();
  });

  it("switches from inherit to custom - calls onChange with 10240", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} onChange={onChange} />
    );

    const select = container.querySelector('[data-testid="select-trigger"]') as HTMLSelectElement;

    act(() => {
      select.value = "custom";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("10240");

    unmount();
  });

  it("switches from custom to inherit - calls onChange with inherit", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} value="20000" onChange={onChange} />
    );

    const select = container.querySelector('[data-testid="select-trigger"]') as HTMLSelectElement;

    act(() => {
      select.value = "inherit";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("inherit");

    unmount();
  });

  it("clicking max-out button calls onChange with 32000", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} value="10000" onChange={onChange} />
    );

    const maxButton = container.querySelector("button") as HTMLButtonElement;

    act(() => {
      maxButton.click();
    });

    expect(onChange).toHaveBeenCalledWith("32000");

    unmount();
  });

  it("typing a number calls onChange with that value", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} value="10000" onChange={onChange} />
    );

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(input, "12345");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("12345");

    unmount();
  });

  it("clearing input calls onChange with inherit", () => {
    const onChange = vi.fn();
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} value="10000" onChange={onChange} />
    );

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(input, "");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("inherit");

    unmount();
  });

  it("disabled prop disables all controls", () => {
    const { container, unmount } = render(
      <ThinkingBudgetEditor {...defaultProps} disabled={true} value="10000" />
    );

    const select = container.querySelector('[data-testid="select-trigger"]') as HTMLSelectElement;
    expect(select.disabled).toBe(true);

    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    const maxButton = container.querySelector("button") as HTMLButtonElement;
    expect(maxButton.disabled).toBe(true);

    unmount();
  });
});
