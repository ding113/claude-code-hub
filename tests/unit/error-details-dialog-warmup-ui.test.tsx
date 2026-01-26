/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";

// Mock routing
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

// Mock Sheet to render content directly (not via portal)
vi.mock("@/components/ui/sheet", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Sheet({ children }: PropsWithChildren & { open?: boolean }) {
    return <div data-slot="sheet-root">{children}</div>;
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

  function SheetDescription({ children }: PropsWithChildren) {
    return <div data-slot="sheet-description">{children}</div>;
  }

  return {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
  };
});

// Mock Tabs to render all content for testing
vi.mock("@/components/ui/tabs", () => {
  type PropsWithChildren = { children?: ReactNode };

  function Tabs({ children, className }: PropsWithChildren & { className?: string }) {
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

  function TabsTrigger({ children, className }: PropsWithChildren & { className?: string }) {
    return (
      <div data-slot="tabs-trigger" className={className}>
        {children}
      </div>
    );
  }

  function TabsContent({ children, className }: PropsWithChildren & { className?: string }) {
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

import { ErrorDetailsDialog } from "@/app/[locale]/dashboard/logs/_components/error-details-dialog";

const dashboardMessages = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "messages/en/dashboard.json"), "utf8")
);
const providerChainMessages = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "messages/en/provider-chain.json"), "utf8")
);

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ dashboard: dashboardMessages, "provider-chain": providerChainMessages }}
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

describe("ErrorDetailsDialog - warmup skip indicator", () => {
  test("blockedBy=warmup should display Skipped/Warmup Fast Response and not show Blocking Information", () => {
    const { container, unmount } = renderWithIntl(
      <ErrorDetailsDialog
        statusCode={200}
        errorMessage={null}
        providerChain={null}
        sessionId={null}
        requestSequence={1}
        blockedBy="warmup"
        blockedReason={JSON.stringify({ reason: "anthropic_warmup_intercepted" })}
        originalModel="claude-sonnet-4-5-20250929"
        currentModel="claude-sonnet-4-5-20250929"
        userAgent={null}
        messagesCount={null}
        endpoint="/v1/messages"
        billingModelSource="original"
        inputTokens={0}
        outputTokens={0}
        cacheCreationInputTokens={0}
        cacheCreation5mInputTokens={0}
        cacheCreation1hInputTokens={0}
        cacheReadInputTokens={0}
        cacheTtlApplied={null}
        costUsd={null}
        costMultiplier={null}
        context1mApplied={false}
        durationMs={null}
        ttfbMs={null}
        externalOpen
      />
    );

    // With mocked Sheet and Tabs, content is rendered in-place (not via Portal)
    const textContent = container.textContent || "";
    expect(textContent).toContain("Warmup Fast Response (CCH)");
    expect(textContent).toContain("Skipped");
    expect(textContent).not.toContain("Blocking Information");

    unmount();
  });
});
