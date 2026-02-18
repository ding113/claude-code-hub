/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ThinkingBudgetEditor } from "@/app/[locale]/settings/providers/_components/thinking-budget-editor";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("lucide-react", () => ({
  Info: () => <div data-testid="info-icon" />,
  ChevronDown: () => <div />,
  Check: () => <div />,
}));

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();

describe("ThinkingBudgetEditor", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container?.remove();
    container = null;
  });

  function render(component: React.ReactNode) {
    act(() => {
      root.render(component);
    });
  }

  async function flushTicks() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const defaultProps = {
    value: "inherit",
    onChange: vi.fn(),
    disabled: false,
  };

  it("renders with inherit value", async () => {
    render(<ThinkingBudgetEditor {...defaultProps} />);
    await flushTicks();
    
    expect(document.body.textContent).toContain("sections.routing.anthropicOverrides.thinkingBudget.options.inherit");
    
    expect(document.querySelector('input[type="number"]')).toBeNull();
    expect(document.body.textContent).not.toContain("sections.routing.anthropicOverrides.thinkingBudget.maxOutButton");
  });

  it("renders with numeric value (custom)", async () => {
    render(<ThinkingBudgetEditor {...defaultProps} value="15000" />);
    await flushTicks();
    
    expect(document.body.textContent).toContain("sections.routing.anthropicOverrides.thinkingBudget.options.custom");
    
    const input = document.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("15000");
    
    expect(document.body.textContent).toContain("sections.routing.anthropicOverrides.thinkingBudget.maxOutButton");
  });

  it("switches from inherit to custom", async () => {
    const onChange = vi.fn();
    render(<ThinkingBudgetEditor {...defaultProps} onChange={onChange} />);
    await flushTicks();
    
    const trigger = document.querySelector('[role="combobox"]') as HTMLElement;
    act(() => {
      trigger.click();
    });
    await flushTicks();
    
    // In Radix UI, options are usually in a portal, but since we are not mocking Select fully, 
    // we rely on how it renders in JSDOM/HappyDOM.
    // If Select is NOT mocked, it uses Radix. 
    // Radix Portals might be outside container. 
    // But document.body should contain it.
    
    // We need to find the option. 
    // Radix items have role="option" usually, or just text.
    // Let's look for the text.
    const customOption = Array.from(document.querySelectorAll('div')).find(div => 
      div.textContent === "sections.routing.anthropicOverrides.thinkingBudget.options.custom"
    );
    
    if (customOption) {
        act(() => {
            customOption.click();
        });
    } else {
        // Fallback: try to find by text content in all elements
        const all = document.querySelectorAll('*');
        const el = Array.from(all).find(e => e.textContent === "sections.routing.anthropicOverrides.thinkingBudget.options.custom");
        if (el) act(() => { (el as HTMLElement).click() });
    }
    
    // Depending on Radix implementation in test env, this might require more specific targeting.
    // But let's see if this works.
    // If Radix is tricky, we might need to mock Select component too.
    
    // Check if onChange was called
    // If it fails, I will mock Select.
    // expect(onChange).toHaveBeenCalledWith("10240");
  });

  // Re-writing tests assuming I might need to mock Select if interaction fails.
  // Actually, let's mock Select to be safe and simple.
});


  it("renders with numeric value (custom)", () => {
    render(<ThinkingBudgetEditor {...defaultProps} value="15000" />);

    expect(
      screen.getByText("sections.routing.anthropicOverrides.thinkingBudget.options.custom")
    ).toBeTruthy();

    const input = screen.getByPlaceholderText(
      "sections.routing.anthropicOverrides.thinkingBudget.placeholder"
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("15000");

    expect(
      screen.getByText("sections.routing.anthropicOverrides.thinkingBudget.maxOutButton")
    ).toBeTruthy();
  });

  it("switches from inherit to custom", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThinkingBudgetEditor {...defaultProps} onChange={onChange} />);

    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    const customOption = screen.getByText(
      "sections.routing.anthropicOverrides.thinkingBudget.options.custom"
    );
    await user.click(customOption);

    expect(onChange).toHaveBeenCalledWith("10240");
  });

  it("switches from custom to inherit", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThinkingBudgetEditor {...defaultProps} value="20000" onChange={onChange} />);

    const trigger = screen.getByRole("combobox");
    await user.click(trigger);

    const inheritOption = screen.getByText(
      "sections.routing.anthropicOverrides.thinkingBudget.options.inherit"
    );
    await user.click(inheritOption);

    expect(onChange).toHaveBeenCalledWith("inherit");
  });

  it("calls max out button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThinkingBudgetEditor {...defaultProps} value="10000" onChange={onChange} />);

    const maxButton = screen.getByText(
      "sections.routing.anthropicOverrides.thinkingBudget.maxOutButton"
    );
    await user.click(maxButton);

    expect(onChange).toHaveBeenCalledWith("32000");
  });

  it("handles input change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThinkingBudgetEditor {...defaultProps} value="10000" onChange={onChange} />);

    const input = screen.getByPlaceholderText(
      "sections.routing.anthropicOverrides.thinkingBudget.placeholder"
    );

    await user.clear(input);
    expect(onChange).toHaveBeenCalledWith("inherit");

    await user.type(input, "12345");
    expect(onChange).toHaveBeenCalledWith("12345");
  });

  it("respects disabled prop", () => {
    render(<ThinkingBudgetEditor {...defaultProps} disabled={true} value="10000" />);

    const trigger = screen.getByRole("combobox");
    expect(trigger.hasAttribute("disabled") || (trigger as HTMLButtonElement).disabled).toBe(true);

    const input = screen.getByPlaceholderText(
      "sections.routing.anthropicOverrides.thinkingBudget.placeholder"
    ) as HTMLInputElement;
    expect(input.disabled).toBe(true);

    const maxButton = screen.getByText(
      "sections.routing.anthropicOverrides.thinkingBudget.maxOutButton"
    ) as HTMLButtonElement;
    expect(maxButton.disabled).toBe(true);
  });
});
