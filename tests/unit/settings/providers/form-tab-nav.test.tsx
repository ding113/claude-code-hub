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
    Clock: stub,
    FileText: stub,
    Route: stub,
    Gauge: stub,
    Network: stub,
    FlaskConical: stub,
    Scale: stub,
    Settings: stub,
    Shield: stub,
    Timer: stub,
  };
});

import {
  FormTabNav,
  NAV_ORDER,
  PARENT_MAP,
  TAB_ORDER,
} from "@/app/[locale]/settings/providers/_components/forms/provider-form/components/form-tab-nav";

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
    it("renders all tabs across 3 responsive breakpoints (22 total when no children on active tab)", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} />);

      // Desktop (10) + Tablet (6) + Mobile (6) = 22
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBe(22);

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

    it("renders sub-items only in the desktop sidebar", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} />);
      const desktopNav = container.querySelector("nav");
      const desktopButtons = desktopNav!.querySelectorAll("button");
      expect(desktopButtons.length).toBe(10);
      unmount();
    });

    it("calls onSubTabChange when a sub-item is clicked", () => {
      const onSubTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} onSubTabChange={onSubTabChange} />
      );
      const desktopNav = container.querySelector("nav");
      const desktopButtons = desktopNav!.querySelectorAll("button");
      act(() => {
        desktopButtons[2].click();
      });
      expect(onSubTabChange).toHaveBeenCalledWith("scheduling");
      unmount();
    });

    it("calls onSubTabChange when the activeTime sub-item is clicked", () => {
      const onSubTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} onSubTabChange={onSubTabChange} />
      );
      const desktopNav = container.querySelector("nav");
      const activeTimeButton = Array.from(desktopNav!.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("tabs.activeTime")
      );

      expect(activeTimeButton).toBeTruthy();

      act(() => {
        activeTimeButton!.click();
      });

      expect(onSubTabChange).toHaveBeenCalledWith("activeTime");
      unmount();
    });

    it("highlights active sub-item with text-primary", () => {
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} activeTab="routing" activeSubTab="scheduling" />
      );
      const desktopNav = container.querySelector("nav");
      const desktopButtons = desktopNav!.querySelectorAll("button");
      expect(desktopButtons[2].className).toContain("text-primary");
      unmount();
    });

    it("renders sub-items in tablet nav when active tab has children", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} activeTab="routing" />);
      const navs = container.querySelectorAll("nav");
      // Second nav is tablet (hidden md:flex md:flex-col lg:hidden)
      const tabletNav = navs[1];
      const schedulingBtn = Array.from(tabletNav!.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("tabs.scheduling")
      );
      expect(schedulingBtn).toBeTruthy();
      unmount();
    });

    it("renders sub-items in mobile nav when active tab has children", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} activeTab="routing" />);
      const navs = container.querySelectorAll("nav");
      // Third nav is mobile (flex md:hidden)
      const mobileNav = navs[2];
      const schedulingBtn = Array.from(mobileNav!.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("tabs.scheduling")
      );
      expect(schedulingBtn).toBeTruthy();
      unmount();
    });

    it("does not render sub-items in tablet/mobile when active tab has no children", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} activeTab="basic" />);
      const navs = container.querySelectorAll("nav");
      const tabletNav = navs[1];
      const mobileNav = navs[2];
      // basic has no children, so no sub-item buttons beyond the main 6
      const tabletButtons = tabletNav!.querySelectorAll("button");
      expect(tabletButtons.length).toBe(6);
      const mobileButtons = mobileNav!.querySelectorAll("button");
      expect(mobileButtons.length).toBe(6);
      unmount();
    });

    it("calls onSubTabChange from tablet sub-item click", () => {
      const onSubTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} activeTab="routing" onSubTabChange={onSubTabChange} />
      );
      const navs = container.querySelectorAll("nav");
      const tabletNav = navs[1];
      const schedulingBtn = Array.from(tabletNav!.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("tabs.scheduling")
      );
      act(() => {
        schedulingBtn!.click();
      });
      expect(onSubTabChange).toHaveBeenCalledWith("scheduling");
      unmount();
    });

    it("calls onSubTabChange from mobile sub-item click", () => {
      const onSubTabChange = vi.fn();
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} activeTab="routing" onSubTabChange={onSubTabChange} />
      );
      const navs = container.querySelectorAll("nav");
      const mobileNav = navs[2];
      const schedulingBtn = Array.from(mobileNav!.querySelectorAll("button")).find((btn) =>
        btn.textContent?.includes("tabs.scheduling")
      );
      act(() => {
        schedulingBtn!.click();
      });
      expect(onSubTabChange).toHaveBeenCalledWith("scheduling");
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

    it("does not render sub-items in horizontal layout", () => {
      const { container, unmount } = render(<FormTabNav {...defaultProps} layout="horizontal" />);
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBe(6);
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
      // Click the "network" tab (index 4)
      act(() => {
        buttons[4].click();
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

      // limits (index 3) should have a primary dot
      const limitsDot = buttons[3].querySelector(".bg-primary");
      expect(limitsDot).toBeTruthy();

      // basic (index 0) should have no status dot
      const basicDot = buttons[0].querySelector(".rounded-full");
      expect(basicDot).toBeNull();

      unmount();
    });
  });

  describe("derived constants", () => {
    it("TAB_ORDER has correct length matching NAV_CONFIG", () => {
      expect(TAB_ORDER.length).toBe(6);
      expect(TAB_ORDER).toEqual(["basic", "routing", "options", "limits", "network", "testing"]);
    });

    it("NAV_ORDER includes all tabs and sub-tabs", () => {
      expect(NAV_ORDER).toEqual([
        "basic",
        "routing",
        "scheduling",
        "options",
        "activeTime",
        "limits",
        "circuitBreaker",
        "network",
        "timeout",
        "testing",
      ]);
    });

    it("PARENT_MAP maps each sub-tab to its parent", () => {
      expect(PARENT_MAP).toEqual({
        scheduling: "routing",
        activeTime: "options",
        circuitBreaker: "limits",
        timeout: "network",
      });
    });
  });

  describe("excludeTabs", () => {
    it("hides excluded tabs in horizontal layout", () => {
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} layout="horizontal" excludeTabs={["options"]} />
      );
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBe(5);
      const labels = Array.from(buttons).map((btn) => btn.textContent);
      expect(labels).not.toContain("tabs.options");
      unmount();
    });

    it("hides excluded tabs in desktop sidebar", () => {
      const { container, unmount } = render(
        <FormTabNav {...defaultProps} excludeTabs={["options"]} />
      );
      const desktopNav = container.querySelector("nav");
      const desktopButtons = desktopNav!.querySelectorAll("button");
      const labels = Array.from(desktopButtons).map((btn) => btn.textContent);
      expect(labels).not.toContain("tabs.options");
      unmount();
    });
  });
});
