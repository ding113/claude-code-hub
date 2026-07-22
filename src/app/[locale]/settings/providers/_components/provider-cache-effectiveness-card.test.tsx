/**
 * @vitest-environment happy-dom
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, test, vi } from "vitest";
import listMessages from "../../../../../../messages/en/settings/providers/list.json";
import { ProviderCacheEffectivenessCard } from "./provider-cache-effectiveness-card";

const getWindowsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client/v1/actions/provider-cache-effectiveness", () => ({
  getProviderCacheEffectivenessWindows: getWindowsMock,
}));

const messages = { settings: { providers: { list: listMessages } } };

function effectivenessWindow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    providerId: 7,
    model: "claude-sonnet-4-5",
    cacheTtlBucket: "5m",
    windowStart: "2026-07-20T00:00:00.000Z",
    windowEnd: "2026-07-20T01:00:00.000Z",
    sampleCount: 120,
    eligibleCount: 96,
    theoreticalCacheTokens: 200000,
    observedCacheReadTokens: 150000,
    rawEffectivenessBp: 7500,
    confidenceBp: 8000,
    effectivenessBp: 6000,
    createdAt: "2026-07-20T01:00:05.000Z",
    ...overrides,
  };
}

async function renderCards(providerIds: number[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" messages={messages}>
          {providerIds.map((providerId) => (
            <ProviderCacheEffectivenessCard key={providerId} providerId={providerId} />
          ))}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  });
  // react-query notifies subscribers through timer-based scheduling
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

describe("ProviderCacheEffectivenessCard", () => {
  beforeEach(() => {
    getWindowsMock.mockResolvedValue({ ok: true, data: [effectivenessWindow()] });
  });

  test("renders the latest window metrics for the provider", async () => {
    const { container, cleanup } = await renderCards([7]);
    const text = container.textContent ?? "";

    expect(text).toContain("Cache Effect");
    expect(text).toContain("Hit Rate");
    expect(text).toContain("75.0%");
    expect(text).toContain("Confidence");
    expect(text).toContain("80.0%");
    expect(text).toContain("Samples");
    expect(text).toContain("120/96");
    expect(text).toContain("Score");
    expect(text).toContain("60.0%");
    cleanup();
  });

  test("uses the first row as the latest window and dashes hit rate without theoretical tokens", async () => {
    getWindowsMock.mockResolvedValue({
      ok: true,
      data: [
        effectivenessWindow({ id: 9, theoreticalCacheTokens: 0, observedCacheReadTokens: 0 }),
        effectivenessWindow({ id: 5 }),
      ],
    });
    const { container, cleanup } = await renderCards([7]);
    const text = container.textContent ?? "";

    expect(text).toContain("Hit Rate");
    expect(text).toContain("-");
    expect(text).not.toContain("75.0%");
    cleanup();
  });

  test("shows the empty state when the provider has no windows", async () => {
    const { container, cleanup } = await renderCards([42]);
    expect(container.textContent).toContain("No cache data yet");
    cleanup();
  });

  test("shows the empty state when the API call fails", async () => {
    getWindowsMock.mockResolvedValue({ ok: false, error: "Permission denied" });
    const { container, cleanup } = await renderCards([7]);
    expect(container.textContent).toContain("No cache data yet");
    cleanup();
  });

  test("shares one fetch across multiple provider rows", async () => {
    const { cleanup } = await renderCards([7, 8, 9]);
    expect(getWindowsMock).toHaveBeenCalledTimes(1);
    expect(getWindowsMock).toHaveBeenCalledWith({ limit: 200 });
    cleanup();
  });
});
