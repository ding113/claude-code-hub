import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AdaptiveThinkingEditor } from "@/app/[locale]/settings/providers/_components/adaptive-thinking-editor";
import type { AnthropicAdaptiveThinkingConfig } from "@/types/provider";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children, disabled }: any) => (
    <div data-testid="select" data-value={value} data-disabled={disabled}>
      <select value={value} onChange={(e) => onValueChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
    </div>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled }: any) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      disabled={disabled}
    >
      Toggle
    </button>
  ),
}));

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({ value, onChange, disabled }: any) => (
    <input
      data-testid="tag-input"
      value={value.join(",")}
      onChange={(e) => onChange(e.target.value.split(","))}
      disabled={disabled}
    />
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
}));

describe("AdaptiveThinkingEditor", () => {
  const defaultConfig: AnthropicAdaptiveThinkingConfig = {
    effort: "medium",
    modelMatchMode: "all",
    models: [],
  };

  it("renders only switch when disabled (enabled=false)", () => {
    render(
      <AdaptiveThinkingEditor
        enabled={false}
        config={defaultConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByRole("switch")).toBeInTheDocument();
    expect(
      screen.getByText("sections.routing.anthropicOverrides.adaptiveThinking.label")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("sections.routing.anthropicOverrides.adaptiveThinking.effort.label")
    ).not.toBeInTheDocument();
  });

  it("renders configuration fields when enabled", () => {
    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={vi.fn()}
      />
    );

    expect(
      screen.getByText("sections.routing.anthropicOverrides.adaptiveThinking.effort.label")
    ).toBeInTheDocument();
    expect(
      screen.getByText("sections.routing.anthropicOverrides.adaptiveThinking.modelMatchMode.label")
    ).toBeInTheDocument();
  });

  it("calls onEnabledChange when switch is clicked", () => {
    const onEnabledChange = vi.fn();
    render(
      <AdaptiveThinkingEditor
        enabled={false}
        config={defaultConfig}
        onEnabledChange={onEnabledChange}
        onConfigChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("switch"));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it("calls onConfigChange when effort is changed", () => {
    const onConfigChange = vi.fn();
    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={onConfigChange}
      />
    );

    const selects = screen.getAllByTestId("select");
    const effortSelect = selects[0].querySelector("select");
    fireEvent.change(effortSelect!, { target: { value: "high" } });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...defaultConfig,
      effort: "high",
    });
  });

  it("calls onConfigChange when model match mode is changed", () => {
    const onConfigChange = vi.fn();
    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={onConfigChange}
      />
    );

    const selects = screen.getAllByTestId("select");
    const modeSelect = selects[1].querySelector("select");
    fireEvent.change(modeSelect!, { target: { value: "specific" } });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...defaultConfig,
      modelMatchMode: "specific",
    });
  });

  it("renders models input only when mode is specific", () => {
    const specificConfig: AnthropicAdaptiveThinkingConfig = {
      ...defaultConfig,
      modelMatchMode: "specific",
    };

    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={specificConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("tag-input")).toBeInTheDocument();
  });

  it("calls onConfigChange when models are changed", () => {
    const onConfigChange = vi.fn();
    const specificConfig: AnthropicAdaptiveThinkingConfig = {
      ...defaultConfig,
      modelMatchMode: "specific",
    };

    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={specificConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={onConfigChange}
      />
    );

    const input = screen.getByTestId("tag-input");
    fireEvent.change(input, { target: { value: "claude-3-opus" } });

    expect(onConfigChange).toHaveBeenCalledWith({
      ...specificConfig,
      models: ["claude-3-opus"],
    });
  });

  it("disables all controls when disabled prop is true", () => {
    render(
      <AdaptiveThinkingEditor
        enabled={true}
        config={defaultConfig}
        onEnabledChange={vi.fn()}
        onConfigChange={vi.fn()}
        disabled={true}
      />
    );

    expect(screen.getByRole("switch")).toBeDisabled();

    const selects = screen.getAllByTestId("select");
    selects.forEach((select) => {
      expect(select).toHaveAttribute("data-disabled", "");
    });
  });
});
