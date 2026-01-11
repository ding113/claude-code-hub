import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, vi } from "vitest";

import type { UsageLogRow } from "@/repository/usage-logs";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/relative-time", () => ({
  RelativeTime: ({ fallback }: { fallback: string }) => <span>{fallback}</span>,
}));

vi.mock("./model-display-with-redirect", () => ({
  ModelDisplayWithRedirect: ({
    currentModel,
    onRedirectClick,
  }: {
    currentModel: string | null;
    onRedirectClick?: () => void;
  }) => (
    <button type="button" data-slot="model-redirect" onClick={onRedirectClick}>
      {currentModel ?? "-"}
    </button>
  ),
}));

vi.mock("./error-details-dialog", () => ({
  ErrorDetailsDialog: () => <div data-slot="error-details-dialog" />,
}));

import { UsageLogsTable } from "./usage-logs-table";

function makeLog(overrides: Partial<UsageLogRow>): UsageLogRow {
  return {
    id: 1,
    createdAt: new Date(),
    sessionId: null,
    requestSequence: null,
    userName: "u",
    keyName: "k",
    providerName: "p",
    model: "m",
    originalModel: null,
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
    costUsd: "0.01",
    costMultiplier: null,
    durationMs: 100,
    ttfbMs: 50,
    errorMessage: null,
    providerChain: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    messagesCount: null,
    context1mApplied: null,
    specialSettings: null,
    ...overrides,
  };
}

describe("usage-logs-table multiplier badge", () => {
  test("does not render multiplier badge for null/undefined/empty/NaN/Infinity", () => {
    for (const costMultiplier of [null, undefined, "", "NaN", "Infinity"] as const) {
      const html = renderToStaticMarkup(
        <UsageLogsTable
          logs={[makeLog({ id: 1, costMultiplier })]}
          total={1}
          page={1}
          pageSize={50}
          onPageChange={() => {}}
          isPending={false}
        />
      );

      expect(html).not.toContain("×0.00");
      expect(html).not.toContain("×NaN");
      expect(html).not.toContain("×Infinity");
    }
  });

  test("renders multiplier badge when finite and != 1", () => {
    const html = renderToStaticMarkup(
      <UsageLogsTable
        logs={[makeLog({ id: 1, costMultiplier: "0.2" })]}
        total={1}
        page={1}
        pageSize={50}
        onPageChange={() => {}}
        isPending={false}
      />
    );

    expect(html).toContain("×0.20");
    expect(html).toContain("0.20x");
  });

  test("renders warmup skipped and blocked labels", () => {
    const htmlWarmup = renderToStaticMarkup(
      <UsageLogsTable
        logs={[makeLog({ id: 1, blockedBy: "warmup" })]}
        total={1}
        page={1}
        pageSize={50}
        onPageChange={() => {}}
        isPending={false}
      />
    );
    expect(htmlWarmup).toContain("logs.table.skipped");

    const htmlBlocked = renderToStaticMarkup(
      <UsageLogsTable
        logs={[makeLog({ id: 1, blockedBy: "sensitive_word" })]}
        total={1}
        page={1}
        pageSize={50}
        onPageChange={() => {}}
        isPending={false}
      />
    );
    expect(htmlBlocked).toContain("logs.table.blocked");
  });

  test("invokes model redirect and pagination callbacks", async () => {
    const onPageChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);

    const root = createRoot(container);
    await act(async () => {
      root.render(
        <UsageLogsTable
          logs={[makeLog({ id: 1, costMultiplier: "0.2" })]}
          total={100}
          page={1}
          pageSize={50}
          onPageChange={onPageChange}
          isPending={false}
        />
      );
    });

    // Trigger model redirect click (covers onRedirectClick handler)
    const redirectButton = container.querySelector('button[data-slot="model-redirect"]');
    expect(redirectButton).not.toBeNull();
    await act(async () => {
      redirectButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Trigger pagination (covers onClick handlers)
    const nextButton = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("logs.table.nextPage")
    );
    expect(nextButton).not.toBeUndefined();
    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPageChange).toHaveBeenCalledWith(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
