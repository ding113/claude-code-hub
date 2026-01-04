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
import { UsageLogsTable } from "@/app/[locale]/dashboard/logs/_components/usage-logs-table";
import type { UsageLogRow } from "@/repository/usage-logs";

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

describe("UsageLogsTable - warmup 跳过展示", () => {
  test("blockedBy=warmup 时应在 Provider/Cost 列显示 Skipped 标记", () => {
    const warmupLog: UsageLogRow = {
      id: 1,
      createdAt: new Date(),
      sessionId: "session_test",
      requestSequence: 1,
      userName: "user",
      keyName: "key",
      providerName: null,
      model: "claude-sonnet-4-5-20250929",
      originalModel: "claude-sonnet-4-5-20250929",
      endpoint: "/v1/messages",
      statusCode: 200,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheTtlApplied: null,
      totalTokens: 0,
      costUsd: null,
      costMultiplier: null,
      durationMs: 0,
      ttfbMs: 0,
      errorMessage: null,
      providerChain: null,
      blockedBy: "warmup",
      blockedReason: JSON.stringify({ reason: "anthropic_warmup_intercepted" }),
      userAgent: "claude_cli/1.0",
      messagesCount: 1,
      context1mApplied: false,
    };

    const { container, unmount } = renderWithIntl(
      <UsageLogsTable
        logs={[warmupLog]}
        total={1}
        page={1}
        pageSize={50}
        onPageChange={() => {}}
        isPending={false}
      />
    );

    expect(container.textContent).toContain("Skipped");
    expect(container.textContent).toContain("Warmup");

    unmount();
  });
});
