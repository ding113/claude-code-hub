/**
 * @vitest-environment happy-dom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RequestListSidebar } from "./request-list-sidebar";

const getSessionRequestsMock = vi.fn();
const { translateMock } = vi.hoisted(() => ({
  translateMock: (key: string) => key,
}));

vi.mock("@/lib/api-client/v1/actions/active-sessions", () => ({
  getSessionRequests: (...args: unknown[]) => getSessionRequestsMock(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => translateMock,
  useTimeZone: () => "UTC",
}));

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  getSessionRequestsMock.mockReset();
  document.body.innerHTML = "";
});

describe("RequestListSidebar", () => {
  test("loads newest first and displays public round numbers without changing selectors", async () => {
    getSessionRequestsMock.mockResolvedValue({
      ok: true,
      data: {
        requests: [
          {
            id: 42,
            sourceSessionId: "physical-new",
            sequence: 1,
            displaySequence: 4,
            model: "model-new",
            statusCode: 200,
            costUsd: "0",
            createdAt: new Date("2026-08-02T00:04:00.000Z"),
            inputTokens: 4,
            outputTokens: 4,
            errorMessage: null,
          },
          {
            id: 41,
            sourceSessionId: "physical-old",
            sequence: 1,
            displaySequence: 2,
            model: "model-old",
            statusCode: 200,
            costUsd: "0",
            createdAt: new Date("2026-08-02T00:02:00.000Z"),
            inputTokens: 2,
            outputTokens: 2,
            errorMessage: null,
          },
        ],
        total: 2,
        hasMore: false,
      },
    });
    const onSelect = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <RequestListSidebar
          sessionId="pfx:scope:root"
          selectedSeq={null}
          selectedSourceSessionId={null}
          onSelect={onSelect}
        />
      );
    });
    await flushEffects();

    expect(getSessionRequestsMock).toHaveBeenCalledWith("pfx:scope:root", 1, 20, "desc");
    expect(container.textContent).toContain("#4");
    expect(container.textContent).toContain("#2");
    expect(container.textContent?.indexOf("#4")).toBeLessThan(
      container.textContent?.indexOf("#2") ?? -1
    );

    const newest = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("#4")
    );
    act(() => newest?.click());
    expect(onSelect).toHaveBeenCalledWith("physical-new", 1, 42);

    act(() => root.unmount());
  });
});
