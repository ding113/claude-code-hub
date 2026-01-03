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
import { ErrorDetailsDialog } from "@/app/[locale]/dashboard/logs/_components/error-details-dialog";

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

describe("ErrorDetailsDialog - warmup 跳过标注", () => {
  test("blockedBy=warmup 时应展示 Skipped/Warmup Fast Response 提示，且不应显示 Blocking Information", () => {
    const { unmount } = renderWithIntl(
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

    // DialogContent 通常通过 Portal 渲染到 document.body
    expect(document.body.textContent).toContain("Warmup Fast Response (CCH)");
    expect(document.body.textContent).toContain("Skipped");
    expect(document.body.textContent).not.toContain("Blocking Information");

    unmount();
  });
});
