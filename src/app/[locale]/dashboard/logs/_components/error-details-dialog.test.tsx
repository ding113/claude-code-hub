import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
});
