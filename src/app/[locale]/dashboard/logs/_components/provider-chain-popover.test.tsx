import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";
import dashboardMessages from "../../../../../../messages/en/dashboard.json";
import providerChainMessages from "../../../../../../messages/en/provider-chain.json";
import type { RoutingTraceV1 } from "@/types/routing-trace";

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
  Badge: ({
    children,
    className,
    variant: _variant,
    ...props
  }: React.ComponentProps<"span"> & { variant?: string }) => (
    <span data-slot="badge" className={className} {...props}>
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
        routingTrace: dashboardMessages.logs.details.routingTrace,
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

function getCompactDiscoveryRouteBadge(html: string) {
  return parseHtml(html).querySelector("[data-testid='discovery-route-badge']");
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
  test("hedge_triggered is not counted as actual request", () => {
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
    // so the request count should be 2 (winner + loser), not 3
    const document = parseHtml(html);
    const requestRows = document.querySelectorAll("#root .relative.flex.gap-2");
    expect(requestRows).toHaveLength(2);
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

describe("provider-chain-popover Discovery summary", () => {
  test("shows cold start, rounds, attempts and fallback winner source", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      events: [],
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 2_000,
        ttfbMs: 1_500,
        attemptsPerRequest: 4,
        maxActiveAttempts: 2,
        rounds: 2,
        providerMs: 3_400,
        fallbackPromotions: 1,
        cancelFailures: 0,
        winnerOrigin: "fallback",
        winnerProviderId: 2,
        winnerRound: 1,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 2, name: "winner", reason: "request_success", statusCode: 200 }]}
        routingTrace={routingTrace}
        finalProvider="winner"
        onChainItemClick={() => undefined}
      />
    );

    expect(html).toContain("Cold start");
    expect(html).toContain("2R · 4 tries");
    expect(html).toContain("Final provider");
    expect(html).toContain("winner");
    expect(html).toContain("Route mode");
    expect(html).toContain("Winner origin");
    expect(html).toContain("Fallback takeover");
    expect(html).toContain("View Discovery details");
    expect(html).not.toContain("1 times");

    const document = parseHtml(html);
    const coldStartBadges = Array.from(document.querySelectorAll("[data-slot='badge']")).filter(
      (node) => node.textContent === "Cold start"
    );
    expect(coldStartBadges.some((node) => node.classList.contains("max-w-[45%]"))).toBe(true);
    expect(coldStartBadges.some((node) => node.classList.contains("whitespace-normal"))).toBe(true);
    const fallbackBadge = Array.from(document.querySelectorAll("[data-slot='badge']")).find(
      (node) => node.textContent === "Fallback takeover"
    );
    expect(fallbackBadge?.classList.contains("whitespace-normal")).toBe(true);
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.classList.contains("bg-amber-50")).toBe(true);
    expect(compactRouteBadge?.classList.contains("text-amber-800")).toBe(true);
    expect(compactRouteBadge?.getAttribute("data-route-mode")).toBe("cold_start");
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("fallback");
    expect(compactRouteBadge?.getAttribute("title")).toBe("Cold start · Fallback takeover");
    expect(document.querySelector("button")?.getAttribute("aria-label")).toContain(
      "Cold start · Fallback takeover"
    );
  });

  test("labels a healthy Sticky request and shows the full winner name from the trace", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "sticky_probe_started",
          at: 1_000,
          elapsedMs: 0,
          round: 0,
          attemptKind: "sticky",
          provider: { id: 9, name: "full-sticky-provider-name" },
        },
        {
          type: "winner_committed",
          at: 2_000,
          elapsedMs: 1_000,
          round: 0,
          attemptId: "sticky:1",
          attemptKind: "sticky",
          provider: { id: 9, name: "full-sticky-provider-name" },
          statusCode: 200,
        },
      ],
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 2_000,
        ttfbMs: 1_000,
        attemptsPerRequest: 1,
        maxActiveAttempts: 1,
        rounds: 0,
        providerMs: 1_000,
        fallbackPromotions: 0,
        cancelFailures: 0,
        winnerOrigin: "sticky",
        winnerProviderId: 9,
        winnerRound: 0,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 9, name: "short", reason: "request_success", statusCode: 200 }]}
        routingTrace={routingTrace}
        finalProvider="short"
      />
    );

    expect(html).toContain("full-sticky-provider-name");
    expect(html).toContain("Route mode");
    expect(html).toContain("Sticky");
    expect(html).toContain("0R · 1 tries");
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.classList.contains("bg-violet-50")).toBe(true);
    expect(compactRouteBadge?.classList.contains("text-violet-700")).toBe(true);
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("sticky");
  });

  test("labels Discovery after a Sticky timeout as rediscovery", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 4_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "sticky_probe_started",
          at: 1_000,
          elapsedMs: 0,
          round: 0,
          attemptKind: "sticky",
          provider: { id: 1, name: "old-sticky" },
        },
        {
          type: "sticky_timeout",
          at: 2_000,
          elapsedMs: 1_000,
          round: 0,
          attemptKind: "sticky",
          provider: { id: 1, name: "old-sticky" },
          outcome: "timeout",
        },
        { type: "round_started", at: 2_001, elapsedMs: 1_001, round: 1 },
        {
          type: "winner_committed",
          at: 3_000,
          elapsedMs: 2_000,
          round: 1,
          attemptId: "fallback:2",
          attemptKind: "fallback",
          provider: { id: 2, name: "new-winner" },
          statusCode: 200,
        },
      ],
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 3_000,
        ttfbMs: 2_000,
        attemptsPerRequest: 2,
        maxActiveAttempts: 2,
        rounds: 1,
        providerMs: 3_000,
        fallbackPromotions: 1,
        cancelFailures: 0,
        winnerOrigin: "fallback",
        winnerProviderId: 2,
        winnerRound: 1,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 2, name: "new-winner", reason: "retry_success", statusCode: 200 }]}
        routingTrace={routingTrace}
        finalProvider="new-winner"
      />
    );

    expect(html).toContain("Rediscovery");
    expect(html).toContain("Fallback takeover");
    expect(html).not.toContain("Cold start");
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.classList.contains("bg-slate-100")).toBe(true);
    expect(compactRouteBadge?.classList.contains("text-slate-700")).toBe(true);
    expect(compactRouteBadge?.getAttribute("data-route-mode")).toBe("rediscovery");
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("fallback");
  });

  test("labels a Sticky attempt that fails before discovery as Sticky", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "sticky_probe_started",
          at: 1_000,
          elapsedMs: 0,
          round: 0,
          attemptKind: "sticky",
          provider: { id: 1, name: "sticky-provider" },
        },
        {
          type: "attempt_finished",
          at: 2_000,
          elapsedMs: 1_000,
          round: 0,
          attemptKind: "sticky",
          outcome: "failed",
          provider: { id: 1, name: "sticky-provider" },
        },
        {
          type: "request_finished",
          at: 3_000,
          elapsedMs: 2_000,
          outcome: "failed",
          statusCode: 503,
        },
      ],
      summary: {
        outcome: "failed",
        statusCode: 503,
        durationMs: 2_000,
        ttfbMs: null,
        attemptsPerRequest: 1,
        maxActiveAttempts: 1,
        rounds: 0,
        providerMs: 1_000,
        fallbackPromotions: 0,
        cancelFailures: 0,
        winnerOrigin: "none",
        winnerProviderId: null,
        winnerRound: 0,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 1, name: "sticky-provider", reason: "session_reuse", statusCode: 503 }]}
        routingTrace={routingTrace}
        finalProvider="sticky-provider"
      />
    );

    expect(html).toContain("Sticky");
    expect(html).not.toContain("Rediscovery");
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("none");
    expect(compactRouteBadge?.classList.contains("bg-violet-50")).toBe(false);
    expect(compactRouteBadge?.classList.contains("bg-blue-50")).toBe(false);
    expect(compactRouteBadge?.classList.contains("bg-amber-50")).toBe(false);
    expect(compactRouteBadge?.classList.contains("bg-teal-50")).toBe(false);
    expect(compactRouteBadge?.classList.contains("bg-slate-100")).toBe(false);
  });

  test("does not infer Rediscovery from a stale session_reuse chain", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        { type: "round_started", at: 1_000, elapsedMs: 0, round: 1 },
        {
          type: "attempt_started",
          at: 1_010,
          elapsedMs: 10,
          round: 1,
          attemptKind: "normal",
          provider: { id: 2, name: "cold-start-provider" },
        },
      ],
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 1, name: "stale-session-provider", reason: "session_reuse" }]}
        routingTrace={routingTrace}
        finalProvider="cold-start-provider"
      />
    );

    expect(html).toContain("Cold start");
    expect(html).not.toContain("Rediscovery");
  });

  test("uses session reuse only as a fallback for a truncated trace", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      truncated: true,
      events: [{ type: "round_started", at: 2_000, elapsedMs: 1_000, round: 1 }],
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 2_000,
        ttfbMs: 1_000,
        attemptsPerRequest: 2,
        maxActiveAttempts: 2,
        rounds: 1,
        providerMs: 2_000,
        fallbackPromotions: 0,
        cancelFailures: 0,
        winnerOrigin: "normal",
        winnerProviderId: 2,
        winnerRound: 1,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 1, name: "sticky-provider", reason: "session_reuse" }]}
        routingTrace={routingTrace}
        finalProvider="winner"
      />
    );

    expect(html).toContain("Rediscovery");
  });

  test("recognizes Rediscovery from a retained non-Sticky winner event", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      truncated: true,
      events: [
        {
          type: "sticky_probe_started",
          at: 1_000,
          elapsedMs: 0,
          round: 0,
          attemptKind: "sticky",
          provider: { id: 1, name: "old-sticky" },
        },
        {
          type: "winner_committed",
          at: 3_000,
          elapsedMs: 2_000,
          round: 1,
          attemptKind: "normal",
          provider: { id: 2, name: "new-winner" },
          statusCode: 200,
        },
      ],
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 1, name: "old-sticky", reason: "session_reuse" }]}
        routingTrace={routingTrace}
        finalProvider="new-winner"
      />
    );

    expect(html).toContain("Rediscovery");
    expect(html).toContain("Normal candidate");
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.classList.contains("bg-teal-50")).toBe(true);
    expect(compactRouteBadge?.classList.contains("text-teal-700")).toBe(true);
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("normal");
  });

  test("uses live winner events when the final summary has not been persisted yet", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 2_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "winner_committed",
          at: 1_500,
          elapsedMs: 500,
          round: 1,
          attemptId: "normal:1",
          attemptKind: "normal",
          provider: { id: 7, name: "live-winner-name" },
          statusCode: 200,
        },
      ],
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[]}
        routingTrace={routingTrace}
        finalProvider="stale-selection"
      />
    );

    expect(html).toContain("live-winner-name");
    expect(html).toContain("Normal candidate");
    expect(html).toContain("Cold start");
    const compactRouteBadge = getCompactDiscoveryRouteBadge(html);
    expect(compactRouteBadge?.classList.contains("bg-blue-50")).toBe(true);
    expect(compactRouteBadge?.classList.contains("text-blue-700")).toBe(true);
    expect(compactRouteBadge?.getAttribute("data-winner-origin")).toBe("normal");
  });

  test("derives live rounds and attempt count before a terminal summary exists", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        { type: "round_started", at: 1_000, elapsedMs: 0, round: 1 },
        {
          type: "attempt_started",
          at: 1_010,
          elapsedMs: 10,
          round: 1,
          attemptId: "normal:1",
          attemptKind: "normal",
          provider: { id: 1, name: "candidate-a" },
        },
        {
          type: "attempt_started",
          at: 1_020,
          elapsedMs: 20,
          round: 1,
          attemptId: "normal:2",
          attemptKind: "normal",
          provider: { id: 2, name: "candidate-b" },
        },
        {
          type: "attempt_finished",
          at: 2_000,
          elapsedMs: 1_000,
          round: 1,
          attemptId: "normal:1",
          attemptKind: "normal",
          outcome: "cancelled",
        },
        { type: "round_started", at: 2_010, elapsedMs: 1_010, round: 2 },
        {
          type: "attempt_started",
          at: 2_020,
          elapsedMs: 1_020,
          round: 2,
          attemptId: "normal:3",
          attemptKind: "normal",
          provider: { id: 3, name: "candidate-c" },
        },
      ],
    };

    const html = renderWithIntl(
      <ProviderChainPopover chain={[]} routingTrace={routingTrace} finalProvider="candidate-b" />
    );

    expect(html).toContain("2R · 3 tries");
    expect(html).toContain("Cold start");
    expect(html).toContain("Request result");
    expect(html).toContain("Pending");
    expect(html).not.toContain("0R · 0 tries");
  });

  test("uses the terminal failure over a committed winner and preserves fake-200 warnings", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 5_000,
      discoveryEnabled: true,
      eligible: true,
      events: [
        {
          type: "winner_committed",
          at: 2_000,
          elapsedMs: 1_000,
          round: 1,
          attemptId: "normal:1",
          attemptKind: "normal",
          provider: { id: 1, name: "candidate-a" },
          statusCode: 200,
        },
        {
          type: "request_finished",
          at: 5_000,
          elapsedMs: 4_000,
          outcome: "failed",
          statusCode: 502,
          reason: "FAKE_200_EMPTY_BODY",
        },
      ],
      summary: {
        outcome: "success",
        statusCode: 200,
        durationMs: 1_000,
        ttfbMs: 1_000,
        attemptsPerRequest: 1,
        maxActiveAttempts: 1,
        rounds: 1,
        providerMs: 1_000,
        fallbackPromotions: 0,
        cancelFailures: 0,
        winnerOrigin: "normal",
        winnerProviderId: 1,
        winnerRound: 1,
      },
    };

    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 1,
            name: "candidate-a",
            reason: "retry_failed",
            statusCode: 502,
            errorMessage: "FAKE_200_EMPTY_BODY",
          },
        ]}
        routingTrace={routingTrace}
        finalProvider="candidate-a"
      />
    );
    const document = parseHtml(html);
    const terminal = document.querySelector("[data-testid='discovery-compact-terminal']");

    expect(terminal?.textContent).toContain("Failed");
    expect(terminal?.textContent).toContain("HTTP 502");
    expect(terminal?.innerHTML).toContain("text-rose-600");
    expect(terminal?.innerHTML).not.toContain("text-emerald-600");
    expect(html).toContain("Detected reason: Empty response body");
    expect(html).toContain("Note: payload may have been forwarded");
    expect(html).toContain("Why CCH cannot retry this response on the server");
  });

  test("marks lease-conflict single-upstream routing without hiding selector priority", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "single_upstream",
      startedAt: 1_000,
      updatedAt: 2_000,
      discoveryEnabled: true,
      eligible: false,
      bypassReason: "lease_conflict",
      events: [],
    };
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          {
            id: 80,
            name: "Lyclaude",
            reason: "initial_selection",
            decisionContext: {
              selectedPriority: 1,
              totalProviders: 2,
              enabledProviders: 2,
              afterHealthCheck: 2,
              beforeHealthCheck: 2,
              priorityLevels: [1],
              candidatesAtPriority: [],
              groupFilterApplied: false,
              targetType: "codex",
            },
          },
          { id: 80, name: "Lyclaude", reason: "request_success", statusCode: 200 },
        ]}
        routingTrace={routingTrace}
        finalProvider="Lyclaude"
      />
    );

    expect(html).toContain("Single-route protection");
    expect(html).toContain("Another request owns the Discovery lease");
    expect(html).toContain("P1");
    expect(html).toContain("lucide-shield-check");
    const document = parseHtml(html);
    const protectionBadge = Array.from(document.querySelectorAll("[data-slot='badge']")).find(
      (node) => node.textContent === "Single-route protection"
    );
    expect(protectionBadge?.classList.contains("bg-amber-50")).toBe(true);
    expect(protectionBadge?.classList.contains("text-amber-700")).toBe(true);
  });

  test("keeps lease-conflict protection visible after serial provider fallback", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "single_upstream",
      startedAt: 1_000,
      updatedAt: 3_000,
      discoveryEnabled: true,
      eligible: false,
      bypassReason: "lease_conflict",
      events: [],
    };
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[
          { id: 80, name: "primary", reason: "initial_selection" },
          {
            id: 80,
            name: "primary",
            reason: "retry_failed",
            attemptNumber: 1,
            statusCode: 503,
          },
          {
            id: 81,
            name: "backup",
            reason: "retry_success",
            attemptNumber: 2,
            statusCode: 200,
          },
        ]}
        routingTrace={routingTrace}
        finalProvider="backup"
      />
    );

    expect(html).toContain("Single-route protection");
    expect(html).toContain("lucide-shield-check");
    expect(html).toContain("primary");
    expect(html).toContain("backup");
  });

  test("does not label a binding conflict as single-route protection", () => {
    const routingTrace: RoutingTraceV1 = {
      version: 1,
      mode: "single_upstream",
      startedAt: 1_000,
      updatedAt: 2_000,
      discoveryEnabled: true,
      eligible: false,
      bypassReason: "binding_conflict",
      events: [],
    };
    const html = renderWithIntl(
      <ProviderChainPopover
        chain={[{ id: 80, name: "Lyclaude", reason: "request_success", statusCode: 200 }]}
        routingTrace={routingTrace}
        finalProvider="Lyclaude"
      />
    );

    expect(html).not.toContain("Single-route protection");
    expect(html).not.toContain("lucide-shield-check");
  });
});
