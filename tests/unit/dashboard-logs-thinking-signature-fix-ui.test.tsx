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

describe("UsageLogsTable - thinking signature 修复标记展示", () => {
  test("thinkingSignatureFixApplied=true 时应显示 Fix 标记", () => {
    const log: UsageLogRow = {
      id: 1,
      createdAt: new Date(),
      sessionId: "session_test",
      requestSequence: 1,
      userName: "user",
      keyName: "key",
      providerName: "provider",
      model: "claude-sonnet",
      originalModel: "claude-sonnet",
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
      costUsd: "0.001",
      costMultiplier: null,
      durationMs: 10,
      ttfbMs: 10,
      errorMessage: null,
      providerChain: [],
      blockedBy: null,
      blockedReason: null,
      userAgent: "claude_cli/1.0",
      messagesCount: 2,
      context1mApplied: false,
      // 新增字段：thinking signature 修复审计标记
      thinkingSignatureFixApplied: true as any,
      thinkingSignatureFixReason: null as any,
    } as any;

    const { container, unmount } = renderWithIntl(
      <UsageLogsTable
        logs={[log]}
        total={1}
        page={1}
        pageSize={50}
        onPageChange={() => {}}
        isPending={false}
      />
    );

    expect(container.textContent).toContain("Fix");
    unmount();
  });
});
