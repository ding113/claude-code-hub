/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import dashboardMessages from "@messages/en/dashboard.json";
import { SessionMessagesDetailsTabs } from "./session-details-tabs";

// Use real locale messages to ensure test stays in sync with actual translations
const messages = {
  dashboard: dashboardMessages,
} as const;

function renderWithIntl(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
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

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("SessionMessagesDetailsTabs", () => {
  test("uses CodeDisplay for request/response/headers and detects SSE response", () => {
    const sse = ["event: foo", 'data: {"x":1}', "", "data: [DONE]"].join("\n");

    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={{ model: "gpt-5.2", instructions: "test" }}
        messages={{ role: "user", content: "hi" }}
        specialSettings={null}
        response={sse}
        requestHeaders={{ a: "1" }}
        responseHeaders={{ b: "2" }}
        requestMeta={{
          clientUrl: "https://example.com/v1/responses",
          upstreamUrl: null,
          method: "POST",
        }}
        responseMeta={{ upstreamUrl: "https://api.example.com/v1/responses", statusCode: 200 }}
      />
    );

    expect(container.querySelector("[data-testid='session-details-tabs']")).not.toBeNull();
    expect(
      container.querySelector("[data-testid='session-tab-trigger-request-messages']")
    ).not.toBeNull();

    // Check request body tab content within its scope
    const requestBodyTab = container.querySelector(
      "[data-testid='session-tab-request-body']"
    ) as HTMLElement;
    const requestBodyCodeDisplay = requestBodyTab.querySelector(
      "[data-testid='code-display']"
    ) as HTMLElement;
    expect(requestBodyCodeDisplay.getAttribute("data-language")).toBe("json");
    expect(requestBodyTab.textContent).toContain('"model": "gpt-5.2"');

    // Switch to request headers tab and check within its scope
    const requestHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-headers']"
    ) as HTMLElement;
    click(requestHeadersTrigger);
    const requestHeadersTab = container.querySelector(
      "[data-testid='session-tab-request-headers']"
    ) as HTMLElement;
    expect(requestHeadersTab.textContent).toContain(
      "CLIENT: POST https://example.com/v1/responses"
    );

    // Switch to request messages tab and check within its scope
    const requestMessagesTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-messages']"
    ) as HTMLElement;
    click(requestMessagesTrigger);
    const requestMessagesTab = container.querySelector(
      "[data-testid='session-tab-request-messages']"
    ) as HTMLElement;
    expect(requestMessagesTab.textContent).toContain('"content": "hi"');

    // Switch to response body tab and check SSE detection
    const responseBodyTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-body']"
    ) as HTMLElement;
    click(responseBodyTrigger);

    const responseBodyTab = container.querySelector(
      "[data-testid='session-tab-response-body']"
    ) as HTMLElement;
    const responseBodyCodeDisplay = responseBodyTab.querySelector(
      "[data-testid='code-display']"
    ) as HTMLElement;
    expect(responseBodyCodeDisplay.getAttribute("data-language")).toBe("sse");

    // Switch to response headers tab and check within its scope
    const responseHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-headers']"
    ) as HTMLElement;
    click(responseHeadersTrigger);
    const responseHeadersTab = container.querySelector(
      "[data-testid='session-tab-response-headers']"
    ) as HTMLElement;
    expect(responseHeadersTab.textContent).toContain(
      "UPSTREAM: HTTP 200 https://api.example.com/v1/responses"
    );

    unmount();
  });

  test("detects JSON response when response is not SSE", () => {
    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={{ model: "gpt-5.2", instructions: "test" }}
        messages={{ role: "user", content: "hi" }}
        specialSettings={null}
        response='{"ok":true}'
        requestHeaders={{}}
        responseHeaders={{}}
        requestMeta={{ clientUrl: null, upstreamUrl: null, method: null }}
        responseMeta={{ upstreamUrl: null, statusCode: null }}
      />
    );

    const responseBodyTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-body']"
    ) as HTMLElement;
    click(responseBodyTrigger);

    const responseBodyTab = container.querySelector(
      "[data-testid='session-tab-response-body']"
    ) as HTMLElement;
    const responseBodyCodeDisplay = responseBodyTab.querySelector(
      "[data-testid='code-display']"
    ) as HTMLElement;
    expect(responseBodyCodeDisplay.getAttribute("data-language")).toBe("json");

    unmount();
  });

  test("renders empty states for missing data", () => {
    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={null}
        messages={null}
        specialSettings={null}
        response={null}
        requestHeaders={null}
        responseHeaders={null}
        requestMeta={{ clientUrl: null, upstreamUrl: null, method: null }}
        responseMeta={{ upstreamUrl: null, statusCode: null }}
      />
    );

    // Check default tab (request body) shows storageTip when null - scoped to tab
    const requestBodyTab = container.querySelector(
      "[data-testid='session-tab-request-body']"
    ) as HTMLElement;
    expect(requestBodyTab.textContent).toContain(dashboardMessages.sessions.details.storageTip);

    // Switch to request headers tab and check storageTip - scoped to tab
    const requestHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-headers']"
    ) as HTMLElement;
    click(requestHeadersTrigger);
    const requestHeadersTab = container.querySelector(
      "[data-testid='session-tab-request-headers']"
    ) as HTMLElement;
    expect(requestHeadersTab.textContent).toContain(dashboardMessages.sessions.details.storageTip);

    // Switch to special settings tab and check noData - scoped to tab
    const specialSettingsTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-special-settings']"
    ) as HTMLElement;
    click(specialSettingsTrigger);
    const specialSettingsTab = container.querySelector(
      "[data-testid='session-tab-special-settings']"
    ) as HTMLElement;
    expect(specialSettingsTab.textContent).toContain(dashboardMessages.sessions.details.noData);

    unmount();
  });

  test("uses larger hard-limit threshold (<= 30,000 lines) for request headers", () => {
    const requestHeaders = Object.fromEntries(
      Array.from({ length: 10_100 }, (_, i) => [`x-h-${i}`, `v-${i}`])
    );

    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={null}
        messages={{ role: "user", content: "hi" }}
        specialSettings={null}
        response='{"ok":true}'
        requestHeaders={requestHeaders}
        responseHeaders={{ b: "2" }}
        requestMeta={{ clientUrl: null, upstreamUrl: null, method: null }}
        responseMeta={{ upstreamUrl: null, statusCode: null }}
      />
    );

    const requestHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-headers']"
    ) as HTMLElement;
    click(requestHeadersTrigger);

    const requestHeadersTab = container.querySelector(
      "[data-testid='session-tab-request-headers']"
    ) as HTMLElement;
    expect(requestHeadersTab.textContent).not.toContain(
      dashboardMessages.sessions.codeDisplay.hardLimit.title
    );

    const search = requestHeadersTab.querySelector(
      "[data-testid='code-display-search']"
    ) as HTMLInputElement;
    expect(search).not.toBeNull();

    unmount();
  });

  test("hard-limited request body provides in-panel download for request.json", async () => {
    const requestBody = Array.from({ length: 30_001 }, (_, i) => i);
    const expectedJson = JSON.stringify(requestBody, null, 2);

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

    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={requestBody}
        messages={{ role: "user", content: "hi" }}
        specialSettings={null}
        response='{"ok":true}'
        requestHeaders={{ a: "1" }}
        responseHeaders={{ b: "2" }}
        requestMeta={{ clientUrl: null, upstreamUrl: null, method: null }}
        responseMeta={{ upstreamUrl: null, statusCode: null }}
      />
    );

    const requestBodyTab = container.querySelector(
      "[data-testid='session-tab-request-body']"
    ) as HTMLElement;
    expect(requestBodyTab.textContent).toContain(
      dashboardMessages.sessions.codeDisplay.hardLimit.title
    );

    const downloadBtn = requestBodyTab.querySelector(
      "[data-testid='code-display-hard-limit-download']"
    ) as HTMLButtonElement;
    expect(downloadBtn).not.toBeNull();
    click(downloadBtn);

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const anchor = lastAnchor as HTMLAnchorElement | null;
    if (!anchor) throw new Error("anchor not created");
    expect(anchor.download).toBe("request.json");
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
});
