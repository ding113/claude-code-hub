/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { SessionMessagesDetailsTabs } from "./session-details-tabs";

const messages = {
  dashboard: {
    sessions: {
      details: {
        requestHeaders: "Request Headers",
        requestBody: "Request Body",
        requestMessages: "Request Messages",
        responseHeaders: "Response Headers",
        responseBody: "Response Body",
        noHeaders: "No data",
        noData: "No Data",
      },
      codeDisplay: {
        raw: "Raw",
        pretty: "Pretty",
        searchPlaceholder: "Search",
        expand: "Expand",
        collapse: "Collapse",
        themeAuto: "Auto",
        themeLight: "Light",
        themeDark: "Dark",
        noMatches: "No matches",
        onlyMatches: "Only matches",
        showAll: "Show all",
        prevPage: "Prev",
        nextPage: "Next",
        pageInfo: "Page {page} / {total}",
        sseEvent: "Event",
        sseData: "Data",
      },
    },
  },
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

    const requestBody = container.querySelector(
      "[data-testid='session-tab-request-body'] [data-testid='code-display']"
    ) as HTMLElement;
    expect(requestBody.getAttribute("data-language")).toBe("json");
    expect(container.textContent).toContain('"model": "gpt-5.2"');

    const requestHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-headers']"
    ) as HTMLElement;
    click(requestHeadersTrigger);
    expect(container.textContent).toContain("CLIENT: POST https://example.com/v1/responses");

    const requestMessagesTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-messages']"
    ) as HTMLElement;
    click(requestMessagesTrigger);
    expect(container.textContent).toContain('"content": "hi"');

    const responseBodyTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-body']"
    ) as HTMLElement;
    click(responseBodyTrigger);

    const responseBody = container.querySelector(
      "[data-testid='session-tab-response-body'] [data-testid='code-display']"
    ) as HTMLElement;
    expect(responseBody.getAttribute("data-language")).toBe("sse");

    const responseHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-headers']"
    ) as HTMLElement;
    click(responseHeadersTrigger);
    expect(container.textContent).toContain(
      "UPSTREAM: HTTP 200 https://api.example.com/v1/responses"
    );

    unmount();
  });

  test("detects JSON response when response is not SSE", () => {
    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={{ model: "gpt-5.2", instructions: "test" }}
        messages={{ role: "user", content: "hi" }}
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

    const responseBody = container.querySelector(
      "[data-testid='session-tab-response-body'] [data-testid='code-display']"
    ) as HTMLElement;
    expect(responseBody.getAttribute("data-language")).toBe("json");

    unmount();
  });

  test("renders empty states for missing data", () => {
    const { container, unmount } = renderWithIntl(
      <SessionMessagesDetailsTabs
        requestBody={null}
        messages={null}
        response={null}
        requestHeaders={null}
        responseHeaders={null}
        requestMeta={{ clientUrl: null, upstreamUrl: null, method: null }}
        responseMeta={{ upstreamUrl: null, statusCode: null }}
      />
    );

    expect(container.textContent).toContain("No Data");

    const requestHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-headers']"
    ) as HTMLElement;
    click(requestHeadersTrigger);
    expect(container.textContent).toContain("No data");

    unmount();
  });
});
