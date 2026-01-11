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

vi.mock("@/components/ui/dialog", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Dialog({ children }: PropsWithChildren) {
    return <div data-slot="dialog-root">{children}</div>;
  }

  function DialogTrigger({ children }: PropsWithChildren) {
    return <div data-slot="dialog-trigger">{children}</div>;
  }

  function DialogContent({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <div data-slot="dialog-content" className={className}>
        {children}
      </div>
    );
  }

  function DialogHeader({ children }: PropsWithChildren) {
    return <div data-slot="dialog-header">{children}</div>;
  }

  function DialogTitle({ children }: PropsWithChildren) {
    return <div data-slot="dialog-title">{children}</div>;
  }

  function DialogDescription({ children }: PropsWithChildren) {
    return <div data-slot="dialog-description">{children}</div>;
  }

  return {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  };
});

vi.mock("@/lib/utils/provider-chain-formatter", () => ({
  formatProviderTimeline: () => ({ timeline: "timeline", totalDuration: 123 }),
}));

import { ErrorDetailsDialog } from "./error-details-dialog";

const messages = {
  dashboard: {
    logs: {
      columns: {
        endpoint: "Endpoint",
      },
      details: {
        inProgress: "In progress",
        statusTitle: "Status: {status}",
        unknown: "Unknown",
        processing: "Processing",
        success: "Success",
        error: "Error",
        skipped: {
          title: "Skipped",
          reason: "Reason",
          warmup: "Warmup",
          desc: "Warmup skipped",
        },
        blocked: {
          title: "Blocked",
          type: "Type",
          sensitiveWord: "Sensitive word",
          word: "Word",
          matchType: "Match type",
          matchTypeContains: "Contains",
          matchTypeExact: "Exact",
          matchTypeRegex: "Regex",
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
        billingDetails: {
          title: "Billing details",
        },
        performance: {
          title: "Performance",
          ttfb: "TTFB",
          duration: "Duration",
          outputRate: "Output rate",
        },
        noError: {
          processing: "No error (processing)",
          success: "No error (success)",
          default: "No error",
        },
        errorMessage: "Error message",
        filteredProviders: "Filtered providers",
        providerChain: {
          title: "Provider chain",
          totalDuration: "Total duration: {duration}",
        },
        reasons: {
          rateLimited: "Rate limited",
          circuitOpen: "Circuit open",
        },
      },
      billingDetails: {
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
  "provider-chain": {},
};

function renderWithIntl(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>
  );
}

function parseHtml(html: string) {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

function getBillingAndPerformanceGrid(document: ReturnType<typeof parseHtml>) {
  return document.querySelector("div.grid.gap-4");
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

  test("renders billing + performance as two-column grid on md when both present", () => {
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

    const document = parseHtml(html);
    const grid = getBillingAndPerformanceGrid(document);

    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("class")).toContain("grid-cols-1");
    expect(grid?.getAttribute("class")).toContain("md:grid-cols-2");

    const headings = Array.from(grid?.querySelectorAll("h4") ?? []).map((node) =>
      node.textContent?.trim()
    );
    expect(headings).toContain("Billing details");
    expect(headings).toContain("Performance");
  });

  test("renders only billing in single-column grid when performance is absent", () => {
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

    const document = parseHtml(html);
    const grid = getBillingAndPerformanceGrid(document);

    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("class")).toContain("grid-cols-1");
    expect(grid?.getAttribute("class")).not.toContain("md:grid-cols-2");

    const headings = Array.from(grid?.querySelectorAll("h4") ?? []).map((node) =>
      node.textContent?.trim()
    );
    expect(headings).toEqual(["Billing details"]);
    expect(html).toContain("$0.000001");
  });

  test("renders only performance in single-column grid when billing is absent", () => {
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

    const document = parseHtml(html);
    const grid = getBillingAndPerformanceGrid(document);

    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("class")).toContain("grid-cols-1");
    expect(grid?.getAttribute("class")).not.toContain("md:grid-cols-2");

    const headings = Array.from(grid?.querySelectorAll("h4") ?? []).map((node) =>
      node.textContent?.trim()
    );
    expect(headings).toEqual(["Performance"]);
    expect(html).toContain("100.0 tok/s");
  });

  test("toggles responsive breakpoint class based on section count", () => {
    const both = parseHtml(
      renderWithIntl(
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
      )
    );
    expect(getBillingAndPerformanceGrid(both)?.getAttribute("class")).toContain("md:grid-cols-2");

    const single = parseHtml(
      renderWithIntl(
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
      )
    );
    expect(getBillingAndPerformanceGrid(single)?.getAttribute("class")).not.toContain(
      "md:grid-cols-2"
    );
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

  test("renders filtered providers and provider chain timeline when present", () => {
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

    expect(html).toContain("Filtered providers");
    expect(html).toContain("filtered-provider");
    expect(html).toContain("Provider chain");
    expect(html).toContain("timeline");
    expect(html).toContain("Total duration");
  });

  test("formats JSON rate limit error message and filtered providers", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={429}
        errorMessage={JSON.stringify({
          code: "rate_limit_exceeded",
          message: "Rate limited",
          details: {
            filteredProviders: [{ id: 1, name: "p", reason: "rate_limited", details: "$1" }],
          },
        })}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("Error message");
    expect(html).toContain("Rate limited");
    expect(html).toContain("p");
    expect(html).toContain("$1");
  });

  test("formats non-rate-limit JSON error as pretty JSON", () => {
    const html = renderWithIntl(
      <ErrorDetailsDialog
        externalOpen
        statusCode={500}
        errorMessage={JSON.stringify({ error: "E", code: "other" })}
        providerChain={null}
        sessionId={null}
      />
    );

    expect(html).toContain("Error message");
    expect(html).toContain("&quot;error&quot;");
  });

  test("falls back to raw error message when it is not JSON", () => {
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

  test("renders warmup skipped and blocked sections when applicable", () => {
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
    expect(htmlBlocked).toContain("Contains");
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
