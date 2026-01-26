/**
 * @vitest-environment happy-dom
 *
 * BatchKeySection: canLoginWebUi toggle semantics alignment test
 * Verifies that the toggle uses inverted logic to match add/edit forms:
 * - Switch ON => canLoginWebUi=false (independent personal usage page)
 * - Switch OFF => canLoginWebUi=true (restricted Web UI)
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  BatchKeySection,
  type BatchKeySectionState,
} from "@/app/[locale]/dashboard/_components/user/batch-edit/batch-key-section";

function render(node: ReactNode) {
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

const createInitialState = (): BatchKeySectionState => ({
  providerGroupEnabled: false,
  providerGroup: "",
  limit5hUsdEnabled: false,
  limit5hUsd: "",
  limitDailyUsdEnabled: false,
  limitDailyUsd: "",
  limitWeeklyUsdEnabled: false,
  limitWeeklyUsd: "",
  limitMonthlyUsdEnabled: false,
  limitMonthlyUsd: "",
  canLoginWebUiEnabled: true, // Enable the field for testing
  canLoginWebUi: false, // Default: independent page enabled (switch ON)
  isEnabledEnabled: false,
  isEnabled: true,
});

const createTranslations = () => ({
  title: "Key Settings",
  affected: "Will affect {count} keys",
  enableFieldAria: "Enable {title} field",
  fields: {
    providerGroup: "Group (providerGroup)",
    limit5h: "5h Limit (USD)",
    limitDaily: "Daily Limit (USD)",
    limitWeekly: "Weekly Limit (USD)",
    limitMonthly: "Monthly Limit (USD)",
    canLoginWebUi: "Independent Personal Usage Page", // Updated label
    keyEnabled: "Key Enabled Status",
  },
  placeholders: {
    groupPlaceholder: "Leave empty to clear",
    emptyNoLimit: "Leave empty for no limit",
  },
  targetValue: "Target Value",
});

// Helper to find the inner value switch (not the enable/disable switch)
// The inner switch has aria-label starting with "Target Value:"
function findCanLoginWebUiValueSwitch(): HTMLButtonElement | null {
  const switches = document.body.querySelectorAll('button[role="switch"]');
  return Array.from(switches).find((el) =>
    el.getAttribute("aria-label")?.startsWith("Target Value: Independent Personal Usage Page")
  ) as HTMLButtonElement | null;
}

describe("BatchKeySection: canLoginWebUi toggle semantics alignment", () => {
  beforeEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  test("should use 'Independent Personal Usage Page' label for canLoginWebUi field", () => {
    const state = createInitialState();
    const translations = createTranslations();
    const onChange = vi.fn();

    const { unmount } = render(
      <BatchKeySection
        affectedKeysCount={5}
        state={state}
        onChange={onChange}
        translations={translations}
      />
    );

    // Find the field card title for canLoginWebUi
    const fieldCards = document.body.querySelectorAll(".text-sm.font-medium");
    const canLoginWebUiCard = Array.from(fieldCards).find(
      (el) => el.textContent === "Independent Personal Usage Page"
    );

    expect(canLoginWebUiCard).toBeTruthy();

    unmount();
  });

  test("switch should be ON (checked) when canLoginWebUi=false (inverted logic)", () => {
    const state = createInitialState();
    state.canLoginWebUi = false; // Independent page enabled
    const translations = createTranslations();
    const onChange = vi.fn();

    const { unmount } = render(
      <BatchKeySection
        affectedKeysCount={5}
        state={state}
        onChange={onChange}
        translations={translations}
      />
    );

    const canLoginWebUiSwitch = findCanLoginWebUiValueSwitch();
    expect(canLoginWebUiSwitch).toBeTruthy();
    // With inverted logic: canLoginWebUi=false should show switch as ON (checked)
    expect(canLoginWebUiSwitch?.getAttribute("data-state")).toBe("checked");

    unmount();
  });

  test("switch should be OFF (unchecked) when canLoginWebUi=true (inverted logic)", () => {
    const state = createInitialState();
    state.canLoginWebUi = true; // Restricted Web UI
    const translations = createTranslations();
    const onChange = vi.fn();

    const { unmount } = render(
      <BatchKeySection
        affectedKeysCount={5}
        state={state}
        onChange={onChange}
        translations={translations}
      />
    );

    const canLoginWebUiSwitch = findCanLoginWebUiValueSwitch();
    expect(canLoginWebUiSwitch).toBeTruthy();
    // With inverted logic: canLoginWebUi=true should show switch as OFF (unchecked)
    expect(canLoginWebUiSwitch?.getAttribute("data-state")).toBe("unchecked");

    unmount();
  });

  test("toggling switch ON should set canLoginWebUi=false (inverted logic)", async () => {
    const state = createInitialState();
    state.canLoginWebUi = true; // Start with restricted Web UI (switch OFF)
    const translations = createTranslations();
    const onChange = vi.fn();

    const { unmount } = render(
      <BatchKeySection
        affectedKeysCount={5}
        state={state}
        onChange={onChange}
        translations={translations}
      />
    );

    const canLoginWebUiSwitch = findCanLoginWebUiValueSwitch();
    expect(canLoginWebUiSwitch).toBeTruthy();

    // Click to toggle ON
    await act(async () => {
      canLoginWebUiSwitch?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // With inverted logic: clicking switch ON should set canLoginWebUi=false
    expect(onChange).toHaveBeenCalledWith({ canLoginWebUi: false });

    unmount();
  });

  test("toggling switch OFF should set canLoginWebUi=true (inverted logic)", async () => {
    const state = createInitialState();
    state.canLoginWebUi = false; // Start with independent page (switch ON)
    const translations = createTranslations();
    const onChange = vi.fn();

    const { unmount } = render(
      <BatchKeySection
        affectedKeysCount={5}
        state={state}
        onChange={onChange}
        translations={translations}
      />
    );

    const canLoginWebUiSwitch = findCanLoginWebUiValueSwitch();
    expect(canLoginWebUiSwitch).toBeTruthy();

    // Click to toggle OFF
    await act(async () => {
      canLoginWebUiSwitch?.click();
      await new Promise((r) => setTimeout(r, 50));
    });

    // With inverted logic: clicking switch OFF should set canLoginWebUi=true
    expect(onChange).toHaveBeenCalledWith({ canLoginWebUi: true });

    unmount();
  });
});
