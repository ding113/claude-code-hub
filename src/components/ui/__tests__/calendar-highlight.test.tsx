/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, afterEach } from "vitest";
import { Calendar } from "@/components/ui/calendar";

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

afterEach(() => {
  // Clean up any portaled content
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe("Calendar highlight classes", () => {
  test("Calendar today className should use primary-based highlight", () => {
    const { container, unmount } = render(<Calendar />);

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar).not.toBeNull();

    // The Calendar component passes classNames to DayPicker
    // We need to verify the today className is set correctly
    // Since we can't easily access the internal classNames prop,
    // we'll verify by checking the rendered output for today's date

    // Find today's button by looking for the today class pattern
    // The Calendar uses DayPicker which applies the today className
    const todayCell = container.querySelector(".rdp-today");

    // Today should always be visible in the default month view
    expect(todayCell).not.toBeNull();

    const className = todayCell?.getAttribute("class") ?? "";
    // The today className should include primary-based colors
    expect(className).toContain("bg-primary");
    expect(className).toContain("text-primary-foreground");
    // Should NOT use accent-based colors
    expect(className).not.toContain("bg-accent");
    expect(className).not.toContain("text-accent-foreground");

    unmount();
  });

  test("Calendar range_start className should use primary-based highlight", () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);

    const { container, unmount } = render(
      <Calendar mode="range" selected={{ from: startDate, to: endDate }} />
    );

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar).not.toBeNull();

    // Find range start button - should exist since we selected a range starting today
    const rangeStartButton = container.querySelector('[data-range-start="true"]');
    expect(rangeStartButton).not.toBeNull();

    const className = rangeStartButton?.getAttribute("class") ?? "";
    // Range start should use primary-based colors
    expect(className).toContain("data-[range-start=true]:bg-primary");
    expect(className).toContain("data-[range-start=true]:text-primary-foreground");

    unmount();
  });

  test("Calendar range_middle className should use primary-based highlight", () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);

    const { container, unmount } = render(
      <Calendar mode="range" selected={{ from: startDate, to: endDate }} />
    );

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar).not.toBeNull();

    // Find range middle button - should exist since we have a 5-day range
    const rangeMiddleButton = container.querySelector('[data-range-middle="true"]');
    expect(rangeMiddleButton).not.toBeNull();

    const className = rangeMiddleButton?.getAttribute("class") ?? "";
    // Range middle should use primary-based colors (with opacity for lighter shade)
    expect(className).toContain("data-[range-middle=true]:bg-primary/20");
    expect(className).toContain("data-[range-middle=true]:text-primary-foreground");

    unmount();
  });

  test("Calendar range_end className should use primary-based highlight", () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);

    const { container, unmount } = render(
      <Calendar mode="range" selected={{ from: startDate, to: endDate }} />
    );

    const calendar = container.querySelector('[data-slot="calendar"]');
    expect(calendar).not.toBeNull();

    // Find range end button - should exist since we selected a range ending 5 days from now
    const rangeEndButton = container.querySelector('[data-range-end="true"]');
    expect(rangeEndButton).not.toBeNull();

    const className = rangeEndButton?.getAttribute("class") ?? "";
    // Range end should use primary-based colors
    expect(className).toContain("data-[range-end=true]:bg-primary");
    expect(className).toContain("data-[range-end=true]:text-primary-foreground");

    unmount();
  });

  test("CalendarDayButton should have primary-based highlight classes for range states", () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);

    const { container, unmount } = render(
      <Calendar mode="range" selected={{ from: startDate, to: endDate }} />
    );

    // Find any day button to check the className pattern
    const dayButton = container.querySelector('[data-slot="button"]');
    expect(dayButton).not.toBeNull();

    const className = dayButton?.getAttribute("class") ?? "";

    // Should have primary-based highlight classes for range states
    expect(className).toContain("data-[range-start=true]:bg-primary");
    expect(className).toContain("data-[range-start=true]:text-primary-foreground");
    expect(className).toContain("data-[range-end=true]:bg-primary");
    expect(className).toContain("data-[range-end=true]:text-primary-foreground");
    expect(className).toContain("data-[range-middle=true]:bg-primary/20");
    expect(className).toContain("data-[range-middle=true]:text-primary-foreground");

    // Should NOT use accent-based highlight classes for range states
    expect(className).not.toContain("data-[range-middle=true]:bg-accent");
    expect(className).not.toContain("data-[range-middle=true]:text-accent-foreground");

    unmount();
  });
});
