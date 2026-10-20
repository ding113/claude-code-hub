/**
 * @vitest-environment happy-dom
 */

import { format } from "date-fns";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { UsageLogsFilters } from "@/app/[locale]/dashboard/logs/_components/usage-logs-filters";
import commonMessages from "../../messages/en/common.json";
import dashboardMessages from "../../messages/en/dashboard.json";

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ dashboard: dashboardMessages, common: commonMessages }}
        timeZone="UTC"
      >
        {node}
      </NextIntlClientProvider>
    );
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function actClick(el: Element | null) {
  if (!el) throw new Error("element not found");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * The quick filters bar and the date range picker both render a "Today" button.
 * They are told apart by the icon: quick filter buttons carry a lucide icon,
 * picker quick-period buttons are text-only.
 */
function findButton(
  container: Element,
  text: string,
  options?: { withIcon?: boolean }
): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => {
    if ((button.textContent || "").trim() !== text) return false;
    if (options?.withIcon === undefined) return true;
    const hasIcon = button.querySelector("svg") !== null;
    return hasIcon === options.withIcon;
  });
}

function isPressed(button: HTMLButtonElement | undefined): boolean {
  return button?.getAttribute("aria-pressed") === "true";
}

function getTimeInputs(container: Element): HTMLInputElement[] {
  return Array.from(container.querySelectorAll("input[type='time']"));
}

async function changeInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("missing native input value setter");
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function renderFilters() {
  return renderWithIntl(
    <UsageLogsFilters
      isAdmin={false}
      providers={[]}
      initialKeys={[]}
      filters={{}}
      onChange={() => {}}
      onReset={() => {}}
    />
  );
}

describe("UsageLogsFilters - quick filter linkage", () => {
  test("quick bar Today lights up the picker Today and fills the date/time display", async () => {
    const { container, unmount } = renderFilters();

    const quickToday = findButton(container, "Today", { withIcon: true });
    const pickerToday = findButton(container, "Today", { withIcon: false });
    expect(quickToday).toBeDefined();
    expect(pickerToday).toBeDefined();
    expect(isPressed(quickToday)).toBe(false);
    expect(isPressed(pickerToday)).toBe(false);

    await actClick(quickToday ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);
    expect(isPressed(findButton(container, "Today", { withIcon: false }))).toBe(true);

    const today = format(new Date(), "yyyy-MM-dd");
    const rangeTrigger = findButton(container, today);
    expect(rangeTrigger).toBeDefined();

    const [startInput, endInput] = getTimeInputs(container);
    expect(startInput?.value).toBe("00:00");
    expect(endInput?.value).toBe("23:59:59");

    unmount();
  });

  test("selecting Today in the date range picker lights up the quick bar Today", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Today", { withIcon: false }) ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: false }))).toBe(true);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);

    const [startInput, endInput] = getTimeInputs(container);
    expect(startInput?.value).toBe("00:00");
    expect(endInput?.value).toBe("23:59:59");

    unmount();
  });

  test("selecting Yesterday in the picker does not light up the quick bar Today", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Yesterday", { withIcon: false }) ?? null);

    expect(isPressed(findButton(container, "Yesterday", { withIcon: false }))).toBe(true);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(false);
    expect(isPressed(findButton(container, "Today", { withIcon: false }))).toBe(false);

    unmount();
  });

  test("clicking the active quick bar preset again clears the time range", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Today", { withIcon: true }) ?? null);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);

    await actClick(findButton(container, "Today", { withIcon: true }) ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(false);
    expect(isPressed(findButton(container, "Today", { withIcon: false }))).toBe(false);

    const [startInput, endInput] = getTimeInputs(container);
    expect(startInput?.value).toBe("");
    expect(endInput?.value).toBe("");

    unmount();
  });

  test("clicking the active picker period again clears the range and the quick bar highlight", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Today", { withIcon: false }) ?? null);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);

    await actClick(findButton(container, "Today", { withIcon: false }) ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: false }))).toBe(false);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(false);

    const [startInput, endInput] = getTimeInputs(container);
    expect(startInput?.value).toBe("");
    expect(endInput?.value).toBe("");

    unmount();
  });

  test("time presets and status presets can stay highlighted at the same time", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Today", { withIcon: true }) ?? null);
    await actClick(findButton(container, "Errors Only") ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);
    expect(isPressed(findButton(container, "Errors Only"))).toBe(true);

    await actClick(findButton(container, "With Retries") ?? null);

    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);
    expect(isPressed(findButton(container, "Errors Only"))).toBe(true);
    expect(isPressed(findButton(container, "With Retries"))).toBe(true);

    unmount();
  });

  test("changing the start clock breaks the exact Today preset highlight", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "Today", { withIcon: true }) ?? null);
    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(true);

    const [startInput] = getTimeInputs(container);
    if (!startInput) throw new Error("start time input not found");
    await changeInputValue(startInput, "08:00:00");

    expect(isPressed(findButton(container, "Today", { withIcon: true }))).toBe(false);

    unmount();
  });

  test("quick bar This Week fills a Monday-Sunday range and toggles off", async () => {
    const { container, unmount } = renderFilters();

    await actClick(findButton(container, "This Week", { withIcon: true }) ?? null);

    expect(isPressed(findButton(container, "This Week", { withIcon: true }))).toBe(true);

    const [startInput, endInput] = getTimeInputs(container);
    expect(startInput?.value).toBe("00:00");
    expect(endInput?.value).toBe("23:59:59");

    await actClick(findButton(container, "This Week", { withIcon: true }) ?? null);

    expect(isPressed(findButton(container, "This Week", { withIcon: true }))).toBe(false);
    expect(getTimeInputs(container)[0]?.value).toBe("");

    unmount();
  });
});
