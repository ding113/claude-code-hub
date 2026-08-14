import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";
import providerChainMessages from "../../../../../../messages/en/provider-chain.json";

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
        fake200ForwardedNotice: "Note: payload may have been forwarded",
        fake200DetectedReason: "Detected reason: {reason}",
        fake200RetryTooltipLabel: "Why no server retry?",
        fake200RetryTooltipTitle: "Why CCH cannot retry this response on the server",
        fake200RetryTooltipServerRetry:
          "The upstream already returned HTTP 200, so CCH had started forwarding the SSE body before the error appeared in-stream. Once that error is recognized, this response can no longer be retried gracefully on the server.",
        fake200RetryTooltipSessionFallback:
          "Clients can retry on their side; later requests in the same session will avoid this fake-200 provider and continue fallback.",
        statusCodeInferredBadge: "Inferred",
        statusCodeInferredTooltip: "This status code is inferred from response body content.",
        statusCodeInferredSuffix: "(inferred)",
        fake200Reasons: {
          emptyBody: "Empty response body",
          htmlBody: "HTML document returned",
          jsonErrorNonEmpty: "JSON has non-empty error field",
          jsonErrorMessageNonEmpty: "JSON has non-empty error.message",
          jsonMessageKeywordMatch: 'JSON message contains "error"',
          unknown: "Response body indicates an error",
        },
      },
    },
  },
  "provider-chain": {
    ...providerChainMessages,
    summary: {
      ...providerChainMessages.summary,
      originHint: "Session reuse - originally selected via {method}",
    },
  },
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

describe("provider-chain-popover group badges", () => {
  test("renders multiple deduped group badges with tooltip content", () => {
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
          {
            id: 2,
            name: "p1",
            reason: "retry_failed",
            statusCode: 500,
          },
          {
            id: 3,
            name: "p1",
            reason: "request_success",
            statusCode: 200,
            groupTag: "alpha, beta, alpha",
          },
        ]}
        finalProvider="p1"
      />
    );

    const document = parseHtml(html);
    const badgeTexts = Array.from(document.querySelectorAll("[data-slot='badge']")).map(
      (node) => node.textContent
    );
    expect(badgeTexts.filter((text) => text === "alpha").length).toBe(1);
    expect(badgeTexts.filter((text) => text === "beta").length).toBe(1);
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
  });
});

describe("provider-chain-popover layout", () => {
  test("renders fake-200 forwarded notice when chain has FAKE_200_* errorMessage", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "retry_failed",
            statusCode: 502,
            errorMessage: "FAKE_200_EMPTY_BODY",
          },
        ]}
        finalProvider="p1"
      />
    );

    expect(html).toContain("Note: payload may have been forwarded");
    expect(html).toContain("Why CCH cannot retry this response on the server");
    expect(html).toContain(
      "The upstream already returned HTTP 200, so CCH had started forwarding the SSE body before the error appeared in-stream. Once that error is recognized, this response can no longer be retried gracefully on the server."
    );
    expect(html).toContain(
      "Clients can retry on their side; later requests in the same session will avoid this fake-200 provider and continue fallback."
    );
  });

  test("renders inferred status code badge when statusCodeInferred=true", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "retry_failed",
            statusCode: 429,
            statusCodeInferred: true,
          },
        ]}
        finalProvider="p1"
      />
    );

    expect(html).toContain("Inferred");
  });

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

  test("session_reuse item with selectionMethod shows origin hint text", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "p1",
            reason: "session_reuse",
            selectionMethod: "weighted_random",
          },
          { id: 1, name: "p1", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider="p1"
      />
    );
    expect(html).toContain("Weighted Random");
    expect(html).toContain("Session reuse - originally selected via");
  });

  test("non-session-reuse item does NOT show origin hint", () => {
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
              candidatesAtPriority: [
                { id: 1, name: "p1", weight: 100, costMultiplier: 1, probability: 1 },
              ],
            },
          },
          { id: 1, name: "p1", reason: "request_success", statusCode: 200 },
        ]}
        finalProvider="p1"
      />
    );
    expect(html).not.toContain("Session reuse - originally selected via");
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

describe("provider-chain-popover hedge/abort reason handling", () => {
  test("hedge_triggered is not counted as actual request but main path is shown", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "initial_selection" },
          { id: 1, name: "p1", reason: "hedge_triggered", attemptNumber: 1 },
          { id: 2, name: "p2", reason: "hedge_winner", statusCode: 200, attemptNumber: 2 },
          { id: 1, name: "p1", reason: "hedge_loser_cancelled", attemptNumber: 1 },
        ]}
        finalProvider="p2"
      />
    );

    // hedge_triggered is informational, not an actual request
    // visual chain shows main path + race participants = 3 rows (initial_selection + winner + loser)
    const document = parseHtml(html);
    const requestRows = document.querySelectorAll("#root .relative.flex.gap-2");
    expect(requestRows).toHaveLength(3);
  });

  test("hedge_winner is treated as successful provider", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "initial_selection" },
          { id: 2, name: "p2", reason: "hedge_winner", statusCode: 200, attemptNumber: 2 },
          { id: 1, name: "p1", reason: "hedge_loser_cancelled", attemptNumber: 1 },
        ]}
        finalProvider="p2"
      />
    );

    // Should render without error
    expect(html).toContain("p2");
  });

  test("client_abort is counted as actual request", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "initial_selection" },
          { id: 1, name: "p1", reason: "client_abort", attemptNumber: 1 },
        ]}
        finalProvider="p1"
      />
    );

    // client_abort should be counted as actual request (requestCount=1 -> single view)
    expect(html).toContain("p1");
  });
});

describe("provider-chain-popover race type / outcome display", () => {
  test("cold-start dual race shows race type badge and rebind outcome", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "initial_selection" },
          {
            id: 2,
            name: "p2",
            reason: "hedge_launched",
            attemptNumber: 2,
            raceInfo: { type: "cold_start", stage: "winner", firstByteTimeoutMs: 20000 },
          },
          {
            id: 2,
            name: "p2",
            reason: "hedge_winner",
            statusCode: 200,
            attemptNumber: 2,
            raceInfo: { type: "cold_start", stage: "winner" },
            raceOutcome: {
              type: "rebind",
              fromProviderId: 2,
              fromProviderName: "p2",
              toProviderId: 1,
              toProviderName: "p1",
            },
          },
          {
            id: 1,
            name: "p1",
            reason: "hedge_loser_billed",
            attemptNumber: 1,
            raceInfo: { type: "cold_start", stage: "loser" },
          },
        ]}
        finalProvider="p2"
      />
    );

    // Race type badge (cold start) rendered
    expect(html).toContain("Cold-Start Dual Race");
    // Rebind outcome rendered (from p2 to p1)
    expect(html).toContain("Rebound from p2 to cheaper p1");
    // Candidate stage badge rendered
    expect(html).toContain("winner");
  });

  test("race shows main path provider alongside hedge participants", () => {
    // Regression: cold-start dual race must show the MAIN path provider (e.g. 247kan)
    // even though the hedge spare won. Previously only hedge_* rows were rendered.
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "247kan-main", reason: "initial_selection" },
          {
            id: 2,
            name: "haoyue-spare",
            reason: "hedge_launched",
            attemptNumber: 2,
            raceInfo: { type: "cold_start", stage: "winner", firstByteTimeoutMs: 20000 },
          },
          {
            id: 2,
            name: "haoyue-spare",
            reason: "hedge_winner",
            statusCode: 200,
            attemptNumber: 2,
            raceInfo: { type: "cold_start", stage: "winner" },
            raceOutcome: {
              type: "rebind",
              fromProviderId: 2,
              fromProviderName: "haoyue-spare",
              toProviderId: 1,
              toProviderName: "247kan-main",
            },
          },
        ]}
        finalProvider="haoyue-spare"
      />
    );

    expect(html).toContain("247kan-main");
    expect(html).toContain("haoyue-spare");
  });

  test("timeout race with no rebind shows noRebind outcome", () => {
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "global_reuse", selectionMethod: "global_reuse" },
          {
            id: 1,
            name: "p1",
            reason: "hedge_winner",
            statusCode: 200,
            attemptNumber: 1,
            raceInfo: { type: "timeout_race", stage: "winner" },
            raceOutcome: {
              type: "no_rebind",
              fromProviderId: 1,
              fromProviderName: "p1",
              detail: "cheaper_candidate_timed_out",
            },
          },
          {
            id: 2,
            name: "p2",
            reason: "hedge_launched",
            attemptNumber: 2,
            raceInfo: { type: "timeout_race", stage: "timed_out", firstByteTimeoutMs: 20000 },
          },
        ]}
        finalProvider="p1"
      />
    );

    expect(html).toContain("Timeout Race");
    expect(html).toContain("No rebind - keep p1");
    expect(html).toContain("timed out");
  });

  test("failover (provider failure without timeout) shows Failover badge", () => {
    // Regression: a reused provider that FAILS (retry_failed, no timed_out stage)
    // must display as Failover instead of Timeout Race.
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 1, name: "p1", reason: "global_reuse", selectionMethod: "global_reuse" },
          {
            id: 1,
            name: "p1",
            reason: "retry_failed",
            attemptNumber: 1,
            statusCode: 503,
            raceInfo: { type: "timeout_race", stage: "failed", firstByteTimeoutMs: 20000 },
          },
          {
            id: 2,
            name: "p2",
            reason: "hedge_launched",
            attemptNumber: 2,
            raceInfo: { type: "timeout_race", stage: "first_byte", firstByteTimeoutMs: 20000 },
          },
          {
            id: 2,
            name: "p2",
            reason: "hedge_winner",
            statusCode: 200,
            attemptNumber: 2,
            raceInfo: { type: "timeout_race", stage: "winner" },
          },
        ]}
        finalProvider="p2"
      />
    );

    expect(html).toContain("Failover");
    expect(html).not.toContain("Timeout Race");
  });
});
