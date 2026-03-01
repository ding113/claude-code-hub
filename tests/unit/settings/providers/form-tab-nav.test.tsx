/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock framer-motion -- render motion.div as a plain div
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, layoutId, ...rest }: any) => (
      <div data-layout-id={layoutId} {...rest}>
        {children}
      </div>
    ),
  },
}));

// Mock lucide-react icons used by FormTabNav
vi.mock("lucide-react", () => {
  const stub = ({ className }: any) => <span data-testid="icon" className={className} />;
  return {
    FileText: stub,
    Route: stub,
    Gauge: stub,
    Network: stub,
    FlaskConical: stub,
  };
});

import { FormTabNav } from "@/app/[locale]/settings/providers/_components/forms/provider-form/components/form-tab-nav";

// ---------------------------------------------------------------------------
// Render helper (matches project convention)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FormTabNav", () => {
  const defaultProps = {
    activeTab: "basic" as const,
    onTabChange: vi.fn(),
  };

  // -- Default (vertical) layout -------------------------------------------

  describe("default vertical layout", () => {
    it("renders all 5 tabs across 3 responsive breakpoints (15 total)", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} />);

      // Desktop (5) + Tablet (5) + Mobile (5) = 15
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBe(15);

      unmount();
    });

    it("renders vertical sidebar nav with hidden lg:flex classes", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} />);

      const nav = container.querySelector("nav");
      expect(nav).toBeTruthy();
      expect(nav!.className).toContain("lg:flex");
      expect(nav!.className).toContain("flex-col");

      unmount();
    });
  });

  // -- Horizontal layout ---------------------------------------------------

  describe('layout="horizontal"', () => {
    it("renders a horizontal nav bar", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} layout="horizontal" />);

      const nav = container.querySelector("nav");
      expect(nav).toBeTruthy();
      // Horizontal mode uses sticky top-0 nav with border-b
      expect(nav!.className).toContain("sticky");
      expect(nav!.className).toContain("border-b");

      unmount();
    });

    it("has overflow-x-auto for horizontal scrolling", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} layout="horizontal" />);

      const scrollContainer = container.querySelector("nav > div");
      expect(scrollContainer).toBeTruthy();
      expect(scrollContainer!.className).toContain("overflow-x-auto");

      unmount();
    });

    it("highlights the active tab with text-primary", () => {
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} activeTab="routing" layout="horizontal" />
      );

      const buttons = container.querySelectorAll("button");
      // "routing" is the second tab (index 1)
      const routingBtn = buttons[1];
      expect(routingBtn.className).toContain("text-primary");

      // Other tabs should have text-muted-foreground
      const basicBtn = buttons[0];
      expect(basicBtn.className).toContain("text-muted-foreground");

      unmount();
    });

    it("renders motion indicator for active tab with horizontal layoutId", () => {
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} activeTab="basic" layout="horizontal" />
      );

      const indicator = container.querySelector('[data-layout-id="activeTabIndicatorHorizontal"]');
      expect(indicator).toBeTruthy();

      unmount();
    });

    it("calls onTabChange when a tab is clicked", () => {
      const onTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} onTabChange={onTabChange} layout="horizontal" />
      );

      const buttons = container.querySelectorAll("button");
      // Click the "network" tab (index 3)
      act(() => {
        buttons[3].click();
      });

      expect(onTabChange).toHaveBeenCalledWith("network");

      unmount();
    });

    it("disables all tabs when disabled prop is true", () => {
      const onTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} onTabChange={onTabChange} disabled layout="horizontal" />
      );

      const buttons = container.querySelectorAll("button");
      for (const btn of buttons) {
        expect(btn.disabled).toBe(true);
        expect(btn.className).toContain("opacity-50");
        expect(btn.className).toContain("cursor-not-allowed");
      }

      // Click should not fire because button is disabled
      act(() => {
        buttons[2].click();
      });
      expect(onTabChange).not.toHaveBeenCalled();

      unmount();
    });

    it("shows status dot for tabs with warning or configured status", () => {
      const { container, unmount } = render(
        <FormTabNav
          {...defaultProps}
          layout="horizontal"
          tabStatus={{ routing: "warning", limits: "configured" }}
        />
      );

      const buttons = container.querySelectorAll("button");
      // routing (index 1) should have a yellow dot
      const routingDot = buttons[1].querySelector(".bg-yellow-500");
      expect(routingDot).toBeTruthy();

      // limits (index 2) should have a primary dot
      const limitsDot = buttons[2].querySelector(".bg-primary");
      expect(limitsDot).toBeTruthy();

      // basic (index 0) should have no status dot
      const basicDot = buttons[0].querySelector(".rounded-full");
      expect(basicDot).toBeNull();

      unmount();
    });
  });
});
