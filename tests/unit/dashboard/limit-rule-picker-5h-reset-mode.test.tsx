/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LimitRulePicker } from "@/app/[locale]/dashboard/_components/user/forms/limit-rule-picker";
import type { LimitRuleDisplayItem } from "@/app/[locale]/dashboard/_components/user/forms/limit-rules-display";
import { LimitRulesDisplay } from "@/app/[locale]/dashboard/_components/user/forms/limit-rules-display";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
    value,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

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

function setInputValue(element: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  descriptor?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

const translations = {
  title: "Add limit rule",
  description: "Select limit type and set value",
  cancel: "Cancel",
  confirm: "Save",
  fields: {
    type: { label: "Limit type", placeholder: "Select" },
    value: { label: "Value", placeholder: "Enter value" },
  },
  limitTypes: {
    limitRpm: "RPM Limit",
    limit5h: "5-Hour Limit",
    limitDaily: "Daily Limit",
    limitWeekly: "Weekly Limit",
    limitMonthly: "Monthly Limit",
    limitTotal: "Total Limit",
    limitSessions: "Concurrent Sessions",
  },
  quickValues: {
    unlimited: "Unlimited",
  },
  limit5h: {
    mode: {
      label: "5h reset mode",
      fixed: "Fixed window",
      rolling: "Rolling window (5h)",
      helperFixed: "Use natural 5-hour buckets.",
      helperRolling: "Use a rolling 5-hour window from the latest usage.",
    },
  },
  daily: {
    mode: {
      label: "Daily reset mode",
      fixed: "Fixed time reset",
      rolling: "Rolling window (24h)",
      helperFixed: "Reset quota at a specific time each day.",
      helperRolling: "Use a rolling 24-hour window from the latest usage.",
    },
    time: {
      label: "Reset time",
      placeholder: "HH:mm",
    },
  },
  actions: {
    remove: "Remove",
  },
  overwriteHint: "Will overwrite existing rule",
};

describe("LimitRulePicker 5h reset mode", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("shows 5h reset mode controls and submits the selected mode", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    const { unmount } = render(
      <LimitRulePicker
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        existingTypes={[]}
        translations={translations}
      />
    );

    const selects = Array.from(document.querySelectorAll("select"));
    expect(selects).toHaveLength(1);
    const typeSelect = selects[0] as HTMLSelectElement | undefined;
    expect(typeSelect).toBeTruthy();

    await act(async () => {
      if (!typeSelect) return;
      typeSelect.value = "limit5h";
      typeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const updatedSelects = Array.from(document.querySelectorAll("select"));
    expect(updatedSelects).toHaveLength(2);
    expect(document.body.textContent).toContain(
      "Use a rolling 5-hour window from the latest usage."
    );
    const modeSelect = updatedSelects[1] as HTMLSelectElement | undefined;
    expect(modeSelect).toBeTruthy();

    await act(async () => {
      if (!modeSelect) return;
      modeSelect.value = "fixed";
      modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Use natural 5-hour buckets.");
    expect(document.querySelector('input[type="time"]')).toBeNull();

    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement | null;
    expect(numberInput).toBeTruthy();

    await act(async () => {
      if (numberInput) {
        setInputValue(numberInput, "12.5");
      }
    });

    const form = document.querySelector("form");
    expect(form).toBeTruthy();

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith("limit5h", 12.5, "fixed", undefined);

    unmount();
  });
});

describe("LimitRulesDisplay 5h reset mode", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("renders 5h reset mode details without falling back to daily copy", () => {
    const onRemove = vi.fn();
    const rules: LimitRuleDisplayItem[] = [
      { type: "limit5h", value: 20, mode: "rolling" },
      { type: "limitDaily", value: 30, mode: "fixed", time: "08:00" },
    ];

    const { unmount } = render(
      <LimitRulesDisplay rules={rules} onRemove={onRemove} translations={translations} />
    );

    expect(document.body.textContent).toContain("Rolling window (5h)");
    expect(document.body.textContent).toContain("Fixed time reset 08:00");

    unmount();
  });
});
