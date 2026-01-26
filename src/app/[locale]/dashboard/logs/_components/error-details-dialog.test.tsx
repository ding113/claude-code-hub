import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { NextIntlClientProvider } from "next-intl";
import { Window } from "happy-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/actions/active-sessions", () => ({
  hasSessionMessages: vi.fn().mockResolvedValue({ ok: true, data: false }),
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock Sheet to render content directly (not via portal)
vi.mock("@/components/ui/sheet", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Sheet({ children, open }: PropsWithChildren & { open?: boolean }) {
    return (
      <div data-slot="sheet-root" data-open={open}>
        {children}
      </div>
    );
  }

  function SheetTrigger({ children }: PropsWithChildren) {
    return <div data-slot="sheet-trigger">{children}</div>;
  }

  function SheetContent({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <div data-slot="sheet-content" className={className}>
        {children}
      </div>
    );
  }

  function SheetHeader({ children }: PropsWithChildren) {
    return <div data-slot="sheet-header">{children}</div>;
  }

  function SheetTitle({ children }: PropsWithChildren) {
    return <div data-slot="sheet-title">{children}</div>;
  }

  return {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
  };
});

// Mock Tabs to render all content for testing
vi.mock("@/components/ui/tabs", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Tabs({
    children,
    className,
  }: PropsWithChildren & { className?: string; value?: string }) {
    return (
      <div data-slot="tabs-root" className={className}>
        {children}
      </div>
    );
  }

  function TabsList({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <div data-slot="tabs-list" className={className}>
        {children}
      </div>
    );
  }

  function TabsTrigger({
    children,
    className,
  }: PropsWithChildren & { className?: string; value?: string }) {
    return (
      <div data-slot="tabs-trigger" className={className}>
        {children}
      </div>
    );
  }

  function TabsContent({
    children,
    className,
  }: PropsWithChildren & { className?: string; value?: string }) {
    return (
      <div data-slot="tabs-content" className={className}>
        {children}
      </div>
    );
  }

  return {
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
  };
});

// Mock StepCard to always render details (bypasses useState expansion)
vi.mock(
  "@/app/[locale]/dashboard/logs/_components/error-details-dialog/components/StepCard",
  () => {
    type StepStatus = "success" | "failure" | "warning" | "pending" | "skipped" | "session_reuse";

    interface StepCardProps {
      step: number;
      icon: React.ComponentType<{ className?: string }>;
      title: string;
      subtitle?: string;
      status: StepStatus;
      timestamp?: number;
      baseTimestamp?: number;
      details?: React.ReactNode;
      isLast?: boolean;
      className?: string;
    }

    function StepCard({ step, icon: Icon, title, subtitle, details }: StepCardProps) {
      return (
        <div data-slot="step-card" data-step={step}>
          <Icon className="step-icon" />
          <span data-slot="step-title">{title}</span>
          {subtitle && <span data-slot="step-subtitle">{subtitle}</span>}
          {details && <div data-slot="step-details">{details}</div>}
        </div>
      );
    }

    return { StepCard };
  }
);

vi.mock("@/lib/utils/provider-chain-formatter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/provider-chain-formatter")>();
  return {
    ...actual,
    formatProviderTimeline: () => ({ timeline: "timeline", totalDuration: 123 }),
  };
});

import { ErrorDetailsDialog } from "./error-details-dialog";

const messages = {
  dashboard: {
    logs: {
      columns: {
        endpoint: "Endpoint",
      },
      details: {
        title: "Request Details",
        inProgress: "In progress",
        statusTitle: "Status: {status}",
        unknown: "Unknown",
        processing: "Processing",
        success: "Success",
        error: "Error",
        tabs: {
          summary: "Summary",
          logicTrace: "Logic Trace",
          performance: "Performance",
          metadata: "Metadata",
        },
        summary: {
          keyMetrics: "Key Metrics",
          totalCost: "Total Cost",
          totalTokens: "Total Tokens",
          duration: "Duration",
          outputRate: "Output Rate",
          viewFullError: "View full error",
          viewSession: "View Session",
        },
        skipped: {
          title: "Skipped",
          warmup: "Warmup",
          desc: "Warmup skipped",
        },
        blocked: {
          title: "Blocked",
          sensitiveWord: "Sensitive word",
          word: "Word",
          matchType: "Match type",
          matchedText: "Matched text",
        },
        modelRedirect: {
          title: "Model redirect",
          billingOriginal: "Billing original",
          billingRedirected: "Billing redirected",
        },
        specialSettings: {
          title: "Special settings",
        },
        performance: {
          title: "Performance",
          ttfb: "TTFB",
          duration: "Duration",
          outputRate: "Output rate",
        },
        performanceTab: {
          noPerformanceData: "No performance data",
          ttfbGauge: "Time to First Byte",
          outputRateGauge: "Output Rate",
          latencyBreakdown: "Latency Breakdown",
          generationTime: "Generation Time",
          assessment: {
            excellent: "Excellent",
            good: "Good",
            warning: "Warning",
            poor: "Poor",
          },
          thresholds: {
            ttfbGood: "TTFB < 300ms",
            ttfbWarning: "TTFB 300-600ms",
            ttfbPoor: "TTFB > 1000ms",
          },
        },
        metadata: {
          noMetadata: "No metadata",
          sessionInfo: "Session Info",
          clientInfo: "Client Info",
          billingInfo: "Billing Info",
          technicalTimeline: "Technical Timeline",
          copyTimeline: "Copy Timeline",
        },
        logicTrace: {
          title: "Decision Chain",
          noDecisionData: "No decision data",
          providersCount: "{count} providers",
          healthyCount: "{count} healthy",
          initialSelection: "Initial Selection",
          healthCheck: "Health Check",
          prioritySelection: "Priority Selection",
          attemptProvider: "Attempt: {provider}",
          retryAttempt: "Retry #{number}",
        },
        noError: {
          processing: "No error (processing)",
          success: "No error (success)",
          default: "No error",
        },
        errorMessage: "Error message",
        viewDetails: "View details",
        filteredProviders: "Filtered providers",
        providerChain: {
          title: "Provider chain",
          totalDuration: "Total duration: {duration}ms",
        },
        reasons: {
          rateLimited: "Rate limited",
          circuitOpen: "Circuit open",
        },
        billingDetails: {
          title: "Billing details",
          input: "Input",
          output: "Output",
          cacheWrite5m: "Cache write 5m",
          cacheWrite1h: "Cache write 1h",
          cacheRead: "Cache read",
          cacheTtl: "Cache TTL",
          context1m: "1M Context",
          context1mPricing: "special pricing",
          multiplier: "Multiplier",
          totalCost: "Total cost",
        },
      },
    },
  },
  "provider-chain": {
    technicalTimeline: "Technical Timeline",
    reasons: {
      request_success: "Request success",
      retry_success: "Retry success",
      retry_failed: "Retry failed",
      system_error: "System error",
      client_error_non_retryable: "Client error",
      concurrent_limit_failed: "Concurrent limit",
      initial_selection: "Initial selection",
    },
    filterReasons: {
      rate_limited: "Rate limited",
      circuit_open: "Circuit open",
    },
    details: {
      selectionMethod: "Selection method",
      endpoint: "Endpoint",
      circuitBreaker: "Circuit breaker",
      circuitDisabled: "Disabled",
      failures: "failures",
      modelRedirect: "Model redirect",
      error: "Error",
      errorDetails: "Error details",
      priority: "Priority",
      weight: "Weight",
      costMultiplier: "Cost",
    },
  },
};

function renderWithIntl(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>
  );
}

// Note: parseHtml uses innerHTML for test purposes only, parsing trusted test output
function parseHtml(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

describe("error-details-dialog layout", () => {
  test("renders special settings section when specialSettings exists", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        specialSettings={[
          {
            type: "provider_parameter_override",
            scope: "provider",
            providerId: 1,
            providerName: "p",
            providerType: "codex",
            hit: true,
            changed: true,
            changes: [{ path: "temperature", before: 1, after: 0.2, changed: true }],
          },
        ]}
      />
    );

    expect(html).toContain("Special settings");
    expect(html).toContain("provider_parameter_override");
  });

  test("renders key metrics when cost and duration are present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        inputTokens={100}
        outputTokens={80}
        durationMs={900}
        ttfbMs={100}
      />
    );

    expect(html).toContain("Key Metrics");
    expect(html).toContain("Total Cost");
  });

  test("renders billing info when cost is present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        inputTokens={100}
        outputTokens={0}
        durationMs={null}
        ttfbMs={null}
      />
    );

    expect(html).toContain("Billing Info");
    expect(html).toContain("$0.000001");
  });

  test("renders performance metrics when duration is present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={null}
        inputTokens={null}
        outputTokens={80}
        durationMs={900}
        ttfbMs={100}
      />
    );

    expect(html).toContain("Output Rate");
    expect(html).toContain("100.0 tok/s");
  });

  test("hides tok/s when TTFB is close to duration and rate is abnormally high", () => {
    // Rule: generationTimeMs / durationMs < 0.1 && outputRate > 5000 => hide tok/s
    // durationMs=1000, ttfbMs=950 => generationTimeMs=50, ratio=0.05 < 0.1
    // outputTokens=300 => rate = 300 / 0.05 = 6000 > 5000 => should hide
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={null}
        inputTokens={null}
        outputTokens={300}
        durationMs={1000}
        ttfbMs={950}
      />
    );

    // tok/s should NOT appear
    expect(html).not.toContain("tok/s");
    expect(html).not.toContain("Output Rate");
    // TTFB should still appear
    expect(html).toContain("TTFB");
  });

  test("shows tok/s in dialog when conditions are normal", () => {
    // durationMs=1000, ttfbMs=500 => generationTimeMs=500, ratio=0.5 >= 0.1
    // outputTokens=50 => rate = 50 / 0.5 = 100 <= 5000 => should show
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={null}
        inputTokens={null}
        outputTokens={50}
        durationMs={1000}
        ttfbMs={500}
      />
    );

    // tok/s should appear
    expect(html).toContain("tok/s");
    // TTFB should also appear
    expect(html).toContain("TTFB");
  });

  test("uses gray status class for unexpected statusCode (e.g., 100)", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={100}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("bg-gray-100");
  });

  test("covers 3xx and 4xx status badge classes", () => {
    const html3xx = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={302}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
      />
    );
    expect(html3xx).toContain("bg-blue-100");

    const html4xx = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={404}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
      />
    );
    expect(html4xx).toContain("bg-yellow-100");
  });

  test("covers in-progress state when statusCode is null", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={null}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("In progress");
    expect(html).toContain("Processing");
  });

  test("renders provider chain timeline when present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
              decisionContext: {
                filteredProviders: [
                  {
                    id: 2,
                    name: "filtered-provider",
                    reason: "rate_limited",
                    details: "$1",
                  },
                ],
              },
            },
          ] as any
        }
      />
    );

    expect(html).toContain("Decision Chain");
    expect(html).toContain("timeline");
    expect(html).toContain("Total duration");
  });

  test("renders error message in summary tab", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={"not-json"}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("Error message");
    expect(html).toContain("not-json");
  });

  test("renders warmup skipped info in logic trace tab", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        blockedBy={"warmup"}
      />
    );
    expect(html).toContain("Skipped");
    expect(html).toContain("Warmup");
  });

  test("renders blocked info in logic trace tab", () => {
    const htmlBlocked = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        blockedBy={"sensitive_word"}
        blockedReason={JSON.stringify({ word: "bad", matchType: "contains", matchedText: "bad" })}
      />
    );
    expect(htmlBlocked).toContain("Blocked");
    expect(htmlBlocked).toContain("Sensitive word");
    expect(htmlBlocked).toContain("bad");
  });

  test("renders model redirect section when originalModel != currentModel", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        originalModel={"m1"}
        currentModel={"m2"}
        billingModelSource={"original"}
      />
    );

    expect(html).toContain("Model redirect");
    expect(html).toContain("m1");
    expect(html).toContain("m2");
    expect(html).toContain("Billing original");
  });

  test("scrolls to model redirect section when scrollToRedirect is true", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.appendChild(container);

    const scrollIntoViewMock = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: scrollIntoViewMock,
      configurable: true,
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <ErrorDetailsDialog
            externalOpen
            statusCode={200}
            errorMessage={null}
            providerChain={null}
            sessionId={null}
            scrollToRedirect
            originalModel={"m1"}
            currentModel={"m2"}
          />
        </NextIntlClientProvider>
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });

    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: originalScrollIntoView,
      configurable: true,
    });
    vi.useRealTimers();
    container.remove();
  });
});

describe("error-details-dialog multiplier", () => {
  test("does not render multiplier row when costMultiplier is empty string", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        costMultiplier={""}
        inputTokens={100}
        outputTokens={80}
      />
    );

    expect(html).not.toContain("Multiplier");
  });

  test("does not render multiplier row when costMultiplier is undefined", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        costMultiplier={undefined}
        inputTokens={100}
        outputTokens={80}
      />
    );

    expect(html).not.toContain("Multiplier");
  });

  test("does not render multiplier row when costMultiplier is NaN", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        costMultiplier={"NaN"}
        inputTokens={100}
        outputTokens={80}
      />
    );

    expect(html).not.toContain("Multiplier");
    expect(html).not.toContain("NaN");
  });

  test("does not render multiplier row when costMultiplier is Infinity", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        costMultiplier={"Infinity"}
        inputTokens={100}
        outputTokens={80}
      />
    );

    expect(html).not.toContain("Multiplier");
    expect(html).not.toContain("Infinity");
  });

  test("renders multiplier row when costMultiplier is finite and != 1", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        costUsd={"0.000001"}
        costMultiplier={"0.2"}
        inputTokens={100}
        outputTokens={80}
      />
    );

    expect(html).toContain("Multiplier");
    expect(html).toContain("0.20x");
  });
});

describe("error-details-dialog probability formatting", () => {
  test("renders probability 0.5 as 50.0% in Decision Chain tab", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "initial_selection",
              decisionContext: {
                totalProviders: 2,
                enabledProviders: 2,
                afterHealthCheck: 2,
                selectedPriority: 1,
                priorityLevels: [1],
                candidatesAtPriority: [
                  { id: 1, name: "p1", weight: 50, costMultiplier: 1, probability: 0.5 },
                  { id: 2, name: "p2", weight: 50, costMultiplier: 1, probability: 0.5 },
                ],
              },
            },
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
            },
          ] as any
        }
      />
    );

    // Should show 50.0%, not 0.5%
    expect(html).toContain("50.0%");
    expect(html).not.toContain("0.5%");
  });

  test("renders probability 100 (out-of-range) as 100.0% not 10000.0%", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "initial_selection",
              decisionContext: {
                totalProviders: 1,
                enabledProviders: 1,
                afterHealthCheck: 1,
                selectedPriority: 1,
                priorityLevels: [1],
                candidatesAtPriority: [
                  { id: 1, name: "p1", weight: 100, costMultiplier: 1, probability: 100 },
                ],
              },
            },
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
            },
          ] as any
        }
      />
    );

    // Should show 100.0%, not 10000.0%
    expect(html).toContain("100.0%");
    expect(html).not.toContain("10000.0%");
  });

  test("renders circuit breaker threshold=0 as Disabled label", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
              circuitState: "closed",
              circuitFailureCount: 0,
              circuitFailureThreshold: 0,
            },
          ] as any
        }
      />
    );

    // Should show "Disabled" label when threshold is 0
    expect(html).toContain("Disabled");
    expect(html).not.toContain("0/0 failures");
  });

  test("hides probability badge when probability is undefined", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "initial_selection",
              decisionContext: {
                totalProviders: 1,
                enabledProviders: 1,
                afterHealthCheck: 1,
                selectedPriority: 1,
                priorityLevels: [1],
                candidatesAtPriority: [{ id: 1, name: "p1", weight: 100, costMultiplier: 1 }],
              },
            },
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
            },
          ] as any
        }
      />
    );

    // Should not show any percentage when probability is undefined
    expect(html).not.toMatch(/\d+\.\d+%/);
  });

  test("hides probability badge when probability is NaN", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        sessionId={null}
        providerChain={
          [
            {
              id: 1,
              name: "p1",
              reason: "initial_selection",
              decisionContext: {
                totalProviders: 1,
                enabledProviders: 1,
                afterHealthCheck: 1,
                selectedPriority: 1,
                priorityLevels: [1],
                candidatesAtPriority: [
                  { id: 1, name: "p1", weight: 100, costMultiplier: 1, probability: Number.NaN },
                ],
              },
            },
            {
              id: 1,
              name: "p1",
              reason: "request_success",
              statusCode: 200,
            },
          ] as any
        }
      />
    );

    // Should not show NaN%
    expect(html).not.toContain("NaN");
  });
});

describe("error-details-dialog tabs", () => {
  test("renders all three tabs", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("Summary");
    expect(html).toContain("Logic Trace");
    expect(html).toContain("Performance");
  });

  test("renders performance gauges when TTFB and output rate are present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        durationMs={1000}
        ttfbMs={200}
        outputTokens={500}
      />
    );

    expect(html).toContain("Time to First Byte");
    expect(html).toContain("Output Rate");
    expect(html).toContain("Latency Breakdown");
  });

  test("renders session info in summary tab when sessionId is present", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={"test-session-123"}
        requestSequence={5}
      />
    );

    expect(html).toContain("Session Info");
    expect(html).toContain("test-session-123");
    expect(html).toContain("#5");
  });
});
