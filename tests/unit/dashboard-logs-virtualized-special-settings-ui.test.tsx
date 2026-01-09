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

// 说明：虚拟列表依赖元素测量与 ResizeObserver；在 happy-dom 下行可能不渲染。
// 这里把 useVirtualizer 固定为“只渲染首行”，确保 UI 断言稳定。
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

// 测试环境不加载 next-intl/navigation -> next/navigation 的真实实现（避免 Next.js 运行时依赖）
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
  throw new Error(`等待文本超时: ${text}`);
}

describe("VirtualizedLogsTable - specialSettings 展示", () => {
  test("当 log.specialSettings 存在时应显示 Special 标记", async () => {
    const { container, unmount } = renderWithIntl(
      <VirtualizedLogsTable filters={{}} autoRefreshEnabled={false} />
    );

    await flushMicrotasks();

    // 等待首屏数据渲染完成（避免断言停留在 Loading 状态）
    await waitForText(container, "Loaded 1 records");

    expect(container.textContent).toContain("Special");

    unmount();
  });
});
