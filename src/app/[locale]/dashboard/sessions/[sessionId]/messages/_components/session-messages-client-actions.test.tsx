/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_SESSION_DETAIL_VIEW_MODE,
  type SessionDetailSnapshots,
  type SessionDetailViewMode,
} from "@/types/session";
import { SessionMessagesClient } from "./session-messages-client";

vi.mock("@tanstack/react-query", () => {
  return {
    useQuery: () => ({ data: { currencyDisplay: "USD" } }),
  };
});

vi.mock("next-intl", () => {
  const t = (key: string) => key;
  return {
    useTranslations: () => t,
    useTimeZone: () => "UTC",
  };
});

let seqParamValue: string | null = null;
vi.mock("next/navigation", () => {
  return {
    useParams: () => ({ sessionId: "0123456789abcdef" }),
    useSearchParams: () => ({
      get: (key: string) => {
        if (key !== "seq") return null;
        return seqParamValue;
      },
    }),
  };
});

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn();
const routerBackMock = vi.fn();

vi.mock("@/i18n/routing", () => {
  return {
    useRouter: () => ({
      replace: routerReplaceMock,
      push: routerPushMock,
      back: routerBackMock,
    }),
    usePathname: () => "/dashboard/sessions/0123456789abcdef/messages",
  };
});

const getSessionDetailsMock = vi.fn();
const terminateActiveSessionMock = vi.fn();
vi.mock("@/actions/active-sessions", () => {
  return {
    getSessionDetails: (...args: unknown[]) => getSessionDetailsMock(...args),
    terminateActiveSession: (...args: unknown[]) => terminateActiveSessionMock(...args),
  };
});

vi.mock("sonner", () => {
  return {
    toast: {
      success: () => {},
      error: () => {},
    },
  };
});

vi.mock("./request-list-sidebar", () => {
  return {
    RequestListSidebar: () => <div data-testid="mock-request-list-sidebar" />,
  };
});

vi.mock("./session-details-tabs", () => {
  return {
    SessionMessagesDetailsTabs: (props: {
      snapshots: SessionDetailSnapshots | null;
      viewMode: SessionDetailViewMode;
      onViewModeChange: (mode: SessionDetailViewMode) => void;
      onCopyResponse?: () => void;
      isResponseCopied?: boolean;
    }) => {
      const responseBody = props.snapshots?.response[props.viewMode]?.body ?? null;

      return (
        <div data-testid="mock-session-details-tabs">
          <div data-testid="mock-view-mode">{props.viewMode}</div>
          <button
            type="button"
            data-testid="mock-view-before"
            onClick={() => props.onViewModeChange("before")}
          >
            before
          </button>
          <button
            type="button"
            data-testid="mock-view-after"
            onClick={() => props.onViewModeChange("after")}
          >
            after
          </button>
          {responseBody && props.onCopyResponse ? (
            <button type="button" onClick={props.onCopyResponse}>
              {props.isResponseCopied ? "actions.copied" : "actions.copyResponse"}
            </button>
          ) : null}
        </div>
      );
    },
  };
});

function createSnapshots(): SessionDetailSnapshots {
  return {
    defaultView: DEFAULT_SESSION_DETAIL_VIEW_MODE,
    request: {
      before: {
        body: { model: "gpt-5.2", input: "before" },
        messages: { role: "user", content: "before" },
        headers: { "x-before": "1" },
        meta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: null,
          method: "POST",
        },
      },
      after: {
        body: { model: "gpt-5.2", input: "after" },
        messages: { role: "user", content: "after" },
        headers: { "x-after": "1" },
        meta: {
          clientUrl: null,
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
      },
    },
    response: {
      before: {
        body: '{"before":true}',
        headers: { "x-before-res": "1" },
        meta: {
          upstreamUrl: "https://upstream.example/v1/responses",
          statusCode: 200,
        },
      },
      after: {
        body: '{"after":true}',
        headers: { "x-after-res": "1" },
        meta: {
          upstreamUrl: null,
          statusCode: 200,
        },
      },
    },
  };
}

function buildDetailsData(
  overrides: Partial<{
    snapshots: SessionDetailSnapshots | null;
    sessionStats: unknown | null;
    currentSequence: number | null;
    prevSequence: number | null;
    nextSequence: number | null;
  }> = {}
) {
  return {
    requestBody: { model: "gpt-5.2", input: "legacy" },
    messages: { role: "user", content: "legacy" },
    response: '{"legacy":true}',
    requestHeaders: { "x-legacy": "1" },
    responseHeaders: { "x-legacy-response": "1" },
    requestMeta: {
      clientUrl: "https://client.example/v1/responses",
      upstreamUrl: "https://upstream.example/v1/responses",
      method: "POST",
    },
    responseMeta: { upstreamUrl: "https://upstream.example/v1/responses", statusCode: 200 },
    snapshots: createSnapshots(),
    specialSettings: null,
    sessionStats: null,
    currentSequence: 7,
    prevSequence: null,
    nextSequence: null,
    ...overrides,
  };
}

function renderClient(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function flushEffects() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  getSessionDetailsMock.mockReset();
  terminateActiveSessionMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  routerBackMock.mockReset();
  vi.useRealTimers();
  seqParamValue = null;
});

describe("SessionMessagesClient (request export actions)", () => {
  test("selected seq in URL overrides currentSequence for request export", async () => {
    seqParamValue = "3";
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData(),
    });

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement");
    let lastAnchor: HTMLAnchorElement | null = null;
    createElementSpy.mockImplementation(((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        lastAnchor = el as HTMLAnchorElement;
      }
      return el;
    }) as unknown as typeof document.createElement);

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    const downloadBtn = container.querySelector('button[aria-label="actions.downloadMessages"]');
    expect(downloadBtn).not.toBeNull();
    click(downloadBtn as HTMLButtonElement);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const anchor = lastAnchor as HTMLAnchorElement | null;
    if (!anchor) throw new Error("anchor not created");
    expect(anchor.download).toBe("session-01234567-seq-3-request.json");
    expect(anchor.href).toBe("blob:mock");

    const blob = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(
      JSON.stringify(
        {
          sessionId: "0123456789abcdef",
          sequence: 3,
          view: "after",
          request: createSnapshots().request.after,
          specialSettings: null,
        },
        null,
        2
      )
    );
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    unmount();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  test("defaults to after and preserves view mode across seq navigation", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData({
        sessionStats: {
          userAgent: "UA",
          requestCount: 3,
          firstRequestAt: "2026-01-01T00:00:00.000Z",
          lastRequestAt: "2026-01-01T00:01:00.000Z",
          totalDurationMs: 1500,
          providers: [{ id: 1, name: "p1" }],
          models: ["gpt-5.2"],
          totalInputTokens: 10,
          totalOutputTokens: 20,
          totalCacheCreationTokens: 30,
          totalCacheReadTokens: 40,
          cacheTtlApplied: "mixed",
          totalCostUsd: "0.123456",
        },
        prevSequence: 6,
        nextSequence: 8,
      }),
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.querySelector("[data-testid='mock-view-mode']")?.textContent).toBe("after");
    click(container.querySelector("[data-testid='mock-view-before']") as HTMLButtonElement);
    expect(container.querySelector("[data-testid='mock-view-mode']")?.textContent).toBe("before");

    const buttons = Array.from(container.querySelectorAll("button"));
    const prevBtn = buttons.find((b) => b.textContent?.includes("details.prevRequest"));
    const nextBtn = buttons.find((b) => b.textContent?.includes("details.nextRequest"));
    expect(prevBtn).not.toBeUndefined();
    expect(nextBtn).not.toBeUndefined();
    click(prevBtn as HTMLButtonElement);
    click(nextBtn as HTMLButtonElement);

    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/dashboard/sessions/0123456789abcdef/messages?seq=6"
    );
    expect(routerReplaceMock).toHaveBeenCalledWith(
      "/dashboard/sessions/0123456789abcdef/messages?seq=8"
    );
    expect(container.querySelector("[data-testid='mock-view-mode']")?.textContent).toBe("before");

    unmount();
  });

  test("copy and download request payloads from the active view", async () => {
    const snapshots = createSnapshots();
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData({ snapshots }),
    });

    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, "createElement");
    let lastAnchor: HTMLAnchorElement | null = null;
    createElementSpy.mockImplementation(((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        lastAnchor = el as HTMLAnchorElement;
      }
      return el;
    }) as unknown as typeof document.createElement);

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    click(container.querySelector("[data-testid='mock-view-before']") as HTMLButtonElement);

    vi.useFakeTimers();
    const copyBtn = container.querySelector('button[aria-label="actions.copyMessages"]');
    expect(copyBtn).not.toBeNull();
    await clickAsync(copyBtn as HTMLButtonElement);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();

    expect(clipboardWriteText).toHaveBeenCalledWith(
      JSON.stringify(
        {
          sessionId: "0123456789abcdef",
          sequence: 7,
          view: "before",
          request: snapshots.request.before,
          specialSettings: null,
        },
        null,
        2
      )
    );

    const downloadBtn = container.querySelector('button[aria-label="actions.downloadMessages"]');
    expect(downloadBtn).not.toBeNull();
    click(downloadBtn as HTMLButtonElement);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const anchor = lastAnchor as HTMLAnchorElement | null;
    if (!anchor) throw new Error("anchor not created");
    expect(anchor.download).toBe("session-01234567-seq-7-request.json");
    const blob = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(
      JSON.stringify(
        {
          sessionId: "0123456789abcdef",
          sequence: 7,
          view: "before",
          request: snapshots.request.before,
          specialSettings: null,
        },
        null,
        2
      )
    );
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    unmount();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  test("copies response body from the active view", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData(),
    });

    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    vi.useFakeTimers();
    const copyRespBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("actions.copyResponse")
    );
    expect(copyRespBtn).not.toBeUndefined();
    await clickAsync(copyRespBtn as HTMLButtonElement);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    expect(clipboardWriteText).toHaveBeenLastCalledWith('{"after":true}');

    click(container.querySelector("[data-testid='mock-view-before']") as HTMLButtonElement);
    vi.useFakeTimers();
    await clickAsync(copyRespBtn as HTMLButtonElement);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    expect(clipboardWriteText).toHaveBeenLastCalledWith('{"before":true}');

    unmount();
  });

  test("shows error when getSessionDetails returns ok:false", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: false,
      error: "ERR_FETCH",
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.textContent).toContain("ERR_FETCH");

    unmount();
  });

  test("does not render the global empty state when another view still has snapshot data", async () => {
    const snapshots = createSnapshots();
    snapshots.request.after = null;
    snapshots.response.after = null;

    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData({
        snapshots,
      }),
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.textContent).not.toContain("details.noDetailedData");

    unmount();
  });

  test("renders the global empty state when both before and after snapshots are absent", async () => {
    const snapshots = createSnapshots();
    snapshots.request.before = null;
    snapshots.request.after = null;
    snapshots.response.before = null;
    snapshots.response.after = null;

    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData({
        snapshots,
      }),
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.textContent).toContain("details.noDetailedData");

    unmount();
  });

  test("renders session stats view and supports terminate flow", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: buildDetailsData({
        sessionStats: {
          userAgent: "UA",
          requestCount: 3,
          firstRequestAt: "2026-01-01T00:00:00.000Z",
          lastRequestAt: "2026-01-01T00:01:00.000Z",
          totalDurationMs: 1500,
          providers: [{ id: 1, name: "p1" }],
          models: ["gpt-5.2"],
          totalInputTokens: 10,
          totalOutputTokens: 20,
          totalCacheCreationTokens: 30,
          totalCacheReadTokens: 40,
          cacheTtlApplied: "mixed",
          totalCostUsd: "0.123456",
        },
      }),
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    const terminateBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("actions.terminate")
    );
    expect(terminateBtn).not.toBeUndefined();
    click(terminateBtn as HTMLButtonElement);
    await act(async () => {
      await Promise.resolve();
    });

    terminateActiveSessionMock.mockResolvedValue({ ok: true });
    const confirmBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("actions.confirmTerminate")
    );
    expect(confirmBtn).not.toBeUndefined();
    await clickAsync(confirmBtn as HTMLButtonElement);

    expect(terminateActiveSessionMock).toHaveBeenCalledWith("0123456789abcdef");
    expect(routerPushMock).toHaveBeenCalledWith("/dashboard/sessions");

    unmount();
  });
});
