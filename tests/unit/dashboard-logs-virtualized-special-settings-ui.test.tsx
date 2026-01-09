/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import { VirtualizedLogsTable } from "@/app/[locale]/dashboard/logs/_components/virtualized-logs-table";
import type { UsageLogRow } from "@/repository/usage-logs";

// Note: The virtualized table relies on element measurements and ResizeObserver; happy-dom may not render rows.
// Stub useVirtualizer to "render only the first row" to keep UI assertions stable.
vi.mock("@/hooks/use-virtualizer", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [{ index: 0, size: 52, start: 0 }],
    getTotalSize: () => 52,
  }),
}));

vi.mock("@/actions/usage-logs", () => ({
  getUsageLogsBatch: vi.fn(async () => ({
    ok: true,
    data: {
      logs: [
        {
          id: 1,
          createdAt: new Date(),
          sessionId: "session_test",
          requestSequence: 1,
          userName: "user",
          keyName: "key",
          providerName: "provider",
          model: "claude-sonnet-4-5-20250929",
          originalModel: "claude-sonnet-4-5-20250929",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheTtlApplied: null,
          totalTokens: 2,
          costUsd: "0.000001",
          costMultiplier: null,
          durationMs: 10,
          ttfbMs: 5,
          errorMessage: null,
          providerChain: null,
          blockedBy: null,
          blockedReason: null,
          userAgent: "claude_cli/1.0",
          messagesCount: 1,
          context1mApplied: false,
          specialSettings: [
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
          ],
        } satisfies UsageLogRow,
      ],
      nextCursor: null,
      hasMore: false,
    },
  })),
}));

// Avoid importing the real next-intl navigation implementation in tests (it depends on Next.js runtime).
vi.mock("@/i18n/routing", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
}));

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

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale="en"
          messages={{ dashboard: dashboardMessages, "provider-chain": providerChainMessages }}
          timeZone="UTC"
        >
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>
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

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitForText(container: HTMLElement, text: string, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((container.textContent || "").includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`Timeout waiting for text: ${text}`);
}

describe("VirtualizedLogsTable - specialSettings display", () => {
  test("should not display specialSettings badge in the logs list row", async () => {
    const { container, unmount } = renderWithIntl(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    await flushMicrotasks();

    // Wait for initial data to render (avoid assertion stuck in Loading state).
    await waitForText(container, "Loaded 1 records");

    expect(container.textContent).not.toContain(dashboardMessages.logs.table.specialSettings);

    unmount();
  });
});
