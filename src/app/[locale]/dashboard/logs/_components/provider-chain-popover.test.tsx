import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/utils/provider-chain-formatter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/provider-chain-formatter")>();
  return {
    ...actual,
    formatProviderDescription: () => "provider description",
  };
});

vi.mock("@/components/ui/tooltip", () => {
  type PropsWithChildren = { children?: ReactNode };

  function TooltipProvider({ children }: PropsWithChildren) {
    return <div data-slot="tooltip-provider">{children}</div>;
  }

  function Tooltip({ children }: PropsWithChildren) {
    return <div data-slot="tooltip-root">{children}</div>;
  }

  function TooltipTrigger({ children }: PropsWithChildren) {
    return <div data-slot="tooltip-trigger">{children}</div>;
  }

  function TooltipContent({ children }: PropsWithChildren) {
    return <div data-slot="tooltip-content">{children}</div>;
  }

  return { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };
});

vi.mock("@/components/ui/popover", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Popover({ children }: PropsWithChildren) {
    return <div data-slot="popover-root">{children}</div>;
  }

  function PopoverTrigger({ children }: PropsWithChildren) {
    return <div data-slot="popover-trigger">{children}</div>;
  }

  function PopoverContent({ children }: PropsWithChildren) {
    return <div data-slot="popover-content">{children}</div>;
  }

  return { Popover, PopoverTrigger, PopoverContent };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    ...props
  }: React.ComponentProps<"button"> & { variant?: string }) => (
    <button className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: React.ComponentProps<"span"> & { variant?: string }) => (
    <span data-slot="badge" className={className}>
      {children}
    </span>
  ),
}));

import { ProviderChainPopover } from "./provider-chain-popover";

const messages = {
  dashboard: {
    logs: {
      table: {
        times: "times",
      },
      providerChain: {
        decisionChain: "Decision chain",
      },
      details: {
        clickStatusCode: "Click status code",
      },
    },
  },
  "provider-chain": {},
};

function renderWithIntl(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <div id="root">{node}</div>
    </NextIntlClientProvider>
  );
}

function parseHtml(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

describe("provider-chain-popover probability formatting", () => {
  test("renders probability 0.5 as 50% in tooltip", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "initial_selection",
            decisionContext: {
              totalProviders: 2,
              enabledProviders: 2,
              targetType: "claude",
              groupFilterApplied: false,
              beforeHealthCheck: 2,
              afterHealthCheck: 2,
              priorityLevels: [1],
              selectedPriority: 1,
              candidatesAtPriority: [
                { id: 1, name: "p1", weight: 50, costMultiplier: 1, probability: 0.5 },
                { id: 2, name: "p2", weight: 50, costMultiplier: 1, probability: 0.5 },
              ],
            },
          },
          { id: 1, name: "p1", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider="p1"
      />
    );

    // Should show 50%, not 0%
    expect(html).toContain("50%");
    expect(html).not.toContain("0.5%");
  });

  test("renders probability 100 (out-of-range) as 100% not 10000%", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "initial_selection",
            decisionContext: {
              totalProviders: 2,
              enabledProviders: 2,
              targetType: "claude",
              groupFilterApplied: false,
              beforeHealthCheck: 2,
              afterHealthCheck: 2,
              priorityLevels: [1],
              selectedPriority: 1,
              candidatesAtPriority: [
                { id: 1, name: "p1", weight: 100, costMultiplier: 1, probability: 100 },
                { id: 2, name: "p2", weight: 0, costMultiplier: 1, probability: 0 },
              ],
            },
          },
          { id: 1, name: "p1", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider="p1"
      />
    );

    // Should show 100%, not 10000%
    expect(html).toContain("100%");
    expect(html).not.toContain("10000%");
  });

  test("hides probability when undefined", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "initial_selection",
            decisionContext: {
              totalProviders: 1,
              enabledProviders: 1,
              targetType: "claude",
              groupFilterApplied: false,
              beforeHealthCheck: 1,
              afterHealthCheck: 1,
              priorityLevels: [1],
              selectedPriority: 1,
              candidatesAtPriority: [{ id: 1, name: "p1", weight: 100, costMultiplier: 1 }],
            },
          },
          { id: 1, name: "p1", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider="p1"
      />
    );

    // Should not show any percentage
    expect(html).not.toMatch(/\d+%\)/);
  });
});

describe("provider-chain-popover layout", () => {
  test("requestCount<=1 branch keeps truncation container shrinkable", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 1, name: "p1", reason: "request_success", statusCode: 200 }]}
        finalProvider={"Very long provider name that should truncate"}
      />
    );
    const document = parseHtml(html);

    const container = document.querySelector("#root > div");
    const containerClass = container?.getAttribute("class") ?? "";
    expect(containerClass).toContain("min-w-0");
    expect(containerClass).toContain("w-full");

    const truncateNode = document.querySelector("#root span.truncate");
    expect(truncateNode).not.toBeNull();
  });

  test("requestCount>1 branch uses w-full/min-w-0 button and flex-1 name container", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "retry_failed" },
          { id: 2, name: "p2", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider={"Very long provider name that should truncate"}
      />
    );
    const document = parseHtml(html);

    const button = document.querySelector("#root button");
    expect(button).not.toBeNull();
    const buttonClass = button?.getAttribute("class") ?? "";
    expect(buttonClass).toContain("w-full");
    expect(buttonClass).toContain("min-w-0");

    // The button contains a span with flex+min-w-0, and inside it the provider name span has truncate+min-w-0
    const buttonInnerSpan = document.querySelector("#root button span.flex.min-w-0");
    expect(buttonInnerSpan).not.toBeNull();

    // The name container has truncate and min-w-0
    const nameContainer = document.querySelector("#root button span.truncate.min-w-0");
    expect(nameContainer).not.toBeNull();

    // Find the count badge by checking content (it should contain "times" text from translation)
    const countBadge = Array.from(document.querySelectorAll('#root [data-slot="badge"]')).find(
      (node) => (node.textContent ?? "").includes("times")
    );
    expect(countBadge).not.toBeUndefined();
  });
});
