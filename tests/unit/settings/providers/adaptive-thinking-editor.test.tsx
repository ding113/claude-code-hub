/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AdaptiveThinkingEditor } from "@/app/[locale]/settings/providers/_components/adaptive-thinking-editor";
import type { AnthropicAdaptiveThinkingConfig } from "@/types/provider";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock UI components
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

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <button
      data-testid="switch"
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
      aria-checked={checked}
    >
      {checked ? "On" : "Off"}
    </button>
  ),
}));

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({
    value,
    onChange,
    disabled,
    placeholder,
  }: {
    value: string[];
    onChange: (tags: string[]) => void;
    disabled?: boolean;
    placeholder?: string;
  }) => (
    <input
      data-testid="tag-input"
      value={value.join(",")}
      onChange={(e) => onChange(e.target.value.split(",").filter(Boolean))}
      disabled={disabled}
      placeholder={placeholder}
    />
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./forms/provider-form/components/section-card", () => ({
  SmartInputWrapper: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div data-testid="smart-input-wrapper">
      <label>{label}</label>
      {children}
    </div>
  ),
  ToggleRow: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div data-testid="toggle-row">
      <label>{label}</label>
      {children}
    </div>
  ),
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

describe("AdaptiveThinkingEditor", () => {
  const defaultConfig: AnthropicAdaptiveThinkingConfig = {
    effort: "medium",
    modelMatchMode: "all",
    models: [],
  };

  const mockOnEnabledChange = vi.fn();
  const mockOnConfigChange = vi.fn();

  it("renders correctly in disabled state (switch off)", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={false}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const switchBtn = container.querySelector('[data-testid="switch"]');
    expect(switchBtn).toBeTruthy();
    expect(switchBtn?.textContent).toBe("Off");
    expect(container.querySelector('[data-testid="select-trigger"]')).toBeNull();

    unmount();
  });

  it("calls onEnabledChange when switch is clicked", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={false}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const switchBtn = container.querySelector('[data-testid="switch"]') as HTMLButtonElement;
    act(() => {
      switchBtn.click();
    });

    expect(mockOnEnabledChange).toHaveBeenCalledWith(true);

    unmount();
  });

  it("renders configuration options when enabled", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const switchBtn = container.querySelector('[data-testid="switch"]');
    expect(switchBtn?.textContent).toBe("On");

    // Should have 2 selects: effort and mode (since mode is 'all')
    const selects = container.querySelectorAll('[data-testid="select-trigger"]');
    expect(selects.length).toBe(2);

    unmount();
  });

  it("calls onConfigChange when effort is changed", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const selects = container.querySelectorAll("select");
    // First select is effort
    const effortSelect = selects[0];

    act(() => {
      effortSelect.value = "high";
      effortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockOnConfigChange).toHaveBeenCalledWith({
      ...defaultConfig,
      effort: "high",
    });

    unmount();
  });

  it("calls onConfigChange when model match mode is changed", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const selects = container.querySelectorAll("select");
    // Second select is model match mode
    const modeSelect = selects[1];

    act(() => {
      modeSelect.value = "specific";
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockOnConfigChange).toHaveBeenCalledWith({
      ...defaultConfig,
      modelMatchMode: "specific",
    });

    unmount();
  });

  it("renders model input when mode is specific", () => {
    const specificConfig: AnthropicAdaptiveThinkingConfig = {
      ...defaultConfig,
      modelMatchMode: "specific",
    };

    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={specificConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    expect(container.querySelector('[data-testid="tag-input"]')).toBeTruthy();

    unmount();
  });

  it("calls onConfigChange when models are changed", () => {
    const specificConfig: AnthropicAdaptiveThinkingConfig = {
      ...defaultConfig,
      modelMatchMode: "specific",
    };

    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={specificConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
      />
    );

    const input = container.querySelector('[data-testid="tag-input"]') as HTMLInputElement;

    act(() => {
      // Simulate typing a tag
      // For standard HTML inputs, simply setting value and dispatching event works
      // The Object.getOwnPropertyDescriptor trick is needed for React controlled inputs
      // but here we are using a mocked input which might just need the event
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      nativeInputValueSetter?.call(input, "claude-3-5-sonnet");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mockOnConfigChange).toHaveBeenCalledWith({
      ...specificConfig,
      models: ["claude-3-5-sonnet"],
    });

    unmount();
  });

  it("passes disabled prop to children", () => {
    const { container, unmount } = render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={mockOnEnabledChange}
        onConfigChange={mockOnConfigChange}
        disabled={true}
      />
    );

    const switchBtn = container.querySelector('[data-testid="switch"]') as HTMLButtonElement;
    expect(switchBtn.disabled).toBe(true);

    const selects = container.querySelectorAll("select");
    selects.forEach((select) => {
      expect(select.disabled).toBe(true);
    });

    unmount();
  });
});
