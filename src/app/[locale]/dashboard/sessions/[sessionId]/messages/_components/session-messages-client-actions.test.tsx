/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
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
      response: string | null;
      onCopyResponse?: () => void;
      isResponseCopied?: boolean;
    }) => {
      return (
        <div data-testid="mock-session-details-tabs">
          {props.response && props.onCopyResponse ? (
            <button type="button" onClick={props.onCopyResponse}>
              {props.isResponseCopied ? "actions.copied" : "actions.copyResponse"}
            </button>
          ) : null}
        </div>
      );
    },
  };
});

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
    // 让事件处理器内的 await 续体在 act 作用域内完成
    await Promise.resolve();
  });
}

async function flushEffects() {
  // SessionMessagesClient 内部有异步 useEffect（await getSessionDetails + 多次 setState）。
  // 这里用两轮 tick 来确保状态更新都在 act 范围内落地，避免 act 警告。
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
      data: {
        requestBody: { model: "gpt-5.2", input: "hi" },
        messages: { role: "user", content: "hi" },
        response: '{"ok":true}',
        requestHeaders: { "content-type": "application/json", "x-test": "1" },
        responseHeaders: { "x-res": "1" },
        requestMeta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
        responseMeta: { upstreamUrl: "https://upstream.example/v1/responses", statusCode: 200 },
        sessionStats: null,
        currentSequence: 7,
        prevSequence: null,
        nextSequence: null,
      },
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

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    unmount();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  test("copy/download exports include request headers and body", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: {
        requestBody: { model: "gpt-5.2", input: "hi" },
        messages: { role: "user", content: "hi" },
        response: '{"ok":true}',
        requestHeaders: { "content-type": "application/json", "x-test": "1" },
        responseHeaders: { "x-res": "1" },
        requestMeta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
        responseMeta: { upstreamUrl: "https://upstream.example/v1/responses", statusCode: 200 },
        sessionStats: null,
        currentSequence: 7,
        prevSequence: null,
        nextSequence: null,
      },
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

    // 复制按钮内部会设置 2s 的回滚定时器；用 fake timers 避免 act 警告
    vi.useFakeTimers();

    const expectedJson = JSON.stringify(
      {
        sessionId: "0123456789abcdef",
        sequence: 7,
        meta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
        headers: { "content-type": "application/json", "x-test": "1" },
        body: { model: "gpt-5.2", input: "hi" },
      },
      null,
      2
    );

    const copyBtn = container.querySelector('button[aria-label="actions.copyMessages"]');
    expect(copyBtn).not.toBeNull();
    await clickAsync(copyBtn as HTMLButtonElement);
    expect(clipboardWriteText).toHaveBeenCalledWith(expectedJson);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();

    const downloadBtn = container.querySelector('button[aria-label="actions.downloadMessages"]');
    expect(downloadBtn).not.toBeNull();
    click(downloadBtn as HTMLButtonElement);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const anchor = lastAnchor as HTMLAnchorElement | null;
    if (!anchor) throw new Error("anchor not created");
    expect(anchor.download).toBe("session-01234567-seq-7-request.json");
    expect(anchor.href).toBe("blob:mock");

    const blob = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe(expectedJson);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    unmount();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });

  test("does not render export buttons when request headers/body are missing", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: {
        requestBody: null,
        messages: { role: "user", content: "hi" },
        response: null,
        requestHeaders: null,
        responseHeaders: null,
        requestMeta: { clientUrl: null, upstreamUrl: null, method: null },
        responseMeta: { upstreamUrl: null, statusCode: null },
        sessionStats: null,
        currentSequence: 1,
        prevSequence: null,
        nextSequence: null,
      },
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.querySelector('button[aria-label="actions.copyMessages"]')).toBeNull();
    expect(container.querySelector('button[aria-label="actions.downloadMessages"]')).toBeNull();

    unmount();
  });

  test("does not render export buttons when request body is missing but headers exist", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: {
        requestBody: null,
        messages: { role: "user", content: "hi" },
        response: null,
        requestHeaders: { "content-type": "application/json" },
        responseHeaders: null,
        requestMeta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
        responseMeta: { upstreamUrl: null, statusCode: null },
        sessionStats: null,
        currentSequence: 1,
        prevSequence: null,
        nextSequence: null,
      },
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    expect(container.querySelector('button[aria-label="actions.copyMessages"]')).toBeNull();
    expect(container.querySelector('button[aria-label="actions.downloadMessages"]')).toBeNull();

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

  test("renders session stats view and supports nav/copy/terminate flows", async () => {
    getSessionDetailsMock.mockResolvedValue({
      ok: true,
      data: {
        requestBody: { model: "gpt-5.2", input: "hi" },
        messages: { role: "user", content: "hi" },
        response: '{"ok":true}',
        requestHeaders: { "content-type": "application/json" },
        responseHeaders: { "x-res": "1" },
        requestMeta: { clientUrl: null, upstreamUrl: null, method: "POST" },
        responseMeta: { upstreamUrl: null, statusCode: 200 },
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
        currentSequence: 7,
        prevSequence: 6,
        nextSequence: 8,
      },
    });

    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    const { container, unmount } = renderClient(<SessionMessagesClient />);
    await flushEffects();

    // 上/下一个请求按钮应触发 router.replace
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

    // 复制响应体
    const copyRespBtn = buttons.find((b) => b.textContent?.includes("actions.copyResponse"));
    expect(copyRespBtn).not.toBeUndefined();
    vi.useFakeTimers();
    await clickAsync(copyRespBtn as HTMLButtonElement);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    expect(clipboardWriteText).toHaveBeenCalledWith('{"ok":true}');

    // 终止会话：打开弹窗并确认
    const terminateBtn = buttons.find((b) => b.textContent?.includes("actions.terminate"));
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
