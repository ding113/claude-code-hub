/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test, vi } from "vitest";
import dashboardMessages from "@messages/en/dashboard.json";
import {
  DEFAULT_SESSION_DETAIL_VIEW_MODE,
  type SessionDetailSnapshots,
  type SessionDetailViewMode,
} from "@/types/session";
import { SessionMessagesDetailsTabs } from "./session-details-tabs";

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

function createSnapshots(): SessionDetailSnapshots {
  return {
    defaultView: DEFAULT_SESSION_DETAIL_VIEW_MODE,
    request: {
      before: {
        body: { model: "gpt-5.2", instructions: "before body" },
        messages: { role: "user", content: "before hi" },
        headers: { "x-before-request": "1" },
        meta: {
          clientUrl: "https://client.example/v1/responses",
          upstreamUrl: null,
          method: "POST",
        },
      },
      after: {
        body: { model: "gpt-5.2", instructions: "after body" },
        messages: { role: "user", content: "after hi" },
        headers: { "x-after-request": "1" },
        meta: {
          clientUrl: null,
          upstreamUrl: "https://upstream.example/v1/responses",
          method: "POST",
        },
      },
    },
    response: {
      before: {
        body: ["event: foo", 'data: {"x":1}', "", "data: [DONE]"].join("\n"),
        headers: { "x-before-response": "1" },
        meta: {
          upstreamUrl: "https://upstream.example/v1/responses",
          statusCode: 200,
        },
      },
      after: {
        body: '{"after":true}',
        headers: { "x-after-response": "1" },
        meta: {
          upstreamUrl: null,
          statusCode: 200,
        },
      },
    },
  };
}

function StatefulTabsHarness({
  snapshots,
  specialSettings,
}: {
  snapshots: SessionDetailSnapshots | null;
  specialSettings: unknown | null;
}) {
  const [viewMode, setViewMode] = useState<SessionDetailViewMode>(DEFAULT_SESSION_DETAIL_VIEW_MODE);

  return (
    <SessionMessagesDetailsTabs
      snapshots={snapshots}
      specialSettings={specialSettings}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
    />
  );
}

describe("SessionMessagesDetailsTabs", () => {
  test("switches request and response tabs between before and after snapshots", () => {
    const { container, unmount } = renderWithIntl(
      <StatefulTabsHarness snapshots={createSnapshots()} specialSettings={null} />
    );

    click(requestHeadersTrigger(container));
    const requestHeadersTab = container.querySelector(
      "[data-testid='session-tab-request-headers']"
    ) as HTMLElement;
    expect(requestHeadersTab.textContent).toContain(
      "Upstream: POST https://upstream.example/v1/responses"
    );
    expect(requestHeadersTab.textContent).toContain("x-after-request: 1");

    const requestMessagesTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-messages']"
    ) as HTMLElement;
    click(requestMessagesTrigger);
    const requestMessagesTab = container.querySelector(
      "[data-testid='session-tab-request-messages']"
    ) as HTMLElement;
    expect(requestMessagesTab.textContent).toContain('"content": "after hi"');

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
    expect(responseBodyTab.textContent).toContain('"after": true');

    const responseHeadersTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-response-headers']"
    ) as HTMLElement;
    click(responseHeadersTrigger);
    const responseHeadersTab = container.querySelector(
      "[data-testid='session-tab-response-headers']"
    ) as HTMLElement;
    expect(responseHeadersTab.textContent).toContain("Client: HTTP 200");
    expect(responseHeadersTab.textContent).toContain("x-after-response: 1");

    const beforeToggle = container.querySelector(
      "[data-testid='session-view-mode-before']"
    ) as HTMLElement;
    click(beforeToggle);

    click(requestHeadersTrigger(container));
    expect(requestHeadersTab.textContent).toContain(
      "Client: POST https://client.example/v1/responses"
    );
    expect(requestHeadersTab.textContent).toContain("x-before-request: 1");

    click(requestMessagesTrigger);
    expect(requestMessagesTab.textContent).toContain('"content": "before hi"');

    click(responseBodyTrigger);
    const beforeResponseBodyCodeDisplay = responseBodyTab.querySelector(
      "[data-testid='code-display']"
    ) as HTMLElement;
    expect(beforeResponseBodyCodeDisplay.getAttribute("data-language")).toBe("sse");

    click(responseHeadersTrigger);
    expect(responseHeadersTab.textContent).toContain(
      "Upstream: HTTP 200 https://upstream.example/v1/responses"
    );
    expect(responseHeadersTab.textContent).toContain("x-before-response: 1");

    unmount();
  });

  test("shows after-request-messages empty state when processed request has no messages field", () => {
    const snapshots = createSnapshots();
    if (!snapshots.request.after) {
      throw new Error("after snapshot missing");
    }
    snapshots.request.after.body = { model: "gpt-5.2", input: [{ role: "user", content: "hi" }] };
    snapshots.request.after.messages = null;

    const { container, unmount } = renderWithIntl(
      <StatefulTabsHarness snapshots={snapshots} specialSettings={null} />
    );

    const requestMessagesTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-request-messages']"
    ) as HTMLElement;
    click(requestMessagesTrigger);
    const requestMessagesTab = container.querySelector(
      "[data-testid='session-tab-request-messages']"
    ) as HTMLElement;
    expect(requestMessagesTab.textContent).toContain(
      dashboardMessages.sessions.details.afterRequestMessagesEmpty.replace(
        "{requestBodyLabel}",
        dashboardMessages.sessions.details.requestBody
      )
    );

    unmount();
  });

  test("detects JSON response when response is not SSE", () => {
    const snapshots = createSnapshots();
    if (!snapshots.response.after) {
      throw new Error("after response snapshot missing");
    }
    snapshots.response.after.body = '{"ok":true}';

    const { container, unmount } = renderWithIntl(
      <StatefulTabsHarness snapshots={snapshots} specialSettings={null} />
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
      <StatefulTabsHarness
        snapshots={{
          defaultView: DEFAULT_SESSION_DETAIL_VIEW_MODE,
          request: { before: null, after: null },
          response: { before: null, after: null },
        }}
        specialSettings={null}
      />
    );

    const requestBodyTab = container.querySelector(
      "[data-testid='session-tab-request-body']"
    ) as HTMLElement;
    expect(requestBodyTab.textContent).toContain(dashboardMessages.sessions.details.storageTip);

    const specialSettingsTrigger = container.querySelector(
      "[data-testid='session-tab-trigger-special-settings']"
    ) as HTMLElement;
    click(specialSettingsTrigger);
    const specialSettingsTab = container.querySelector(
      "[data-testid='session-tab-special-settings']"
    ) as HTMLElement;
    expect(specialSettingsTab.textContent).toContain(
      dashboardMessages.sessions.details.specialSettingsStaticNote
    );
    expect(specialSettingsTab.textContent).toContain(
      dashboardMessages.sessions.details.specialSettingsEmpty
    );

    unmount();
  });

  test("uses larger hard-limit threshold (<= 30,000 lines) for request headers", () => {
    const snapshots = createSnapshots();
    if (!snapshots.request.after) {
      throw new Error("after snapshot missing");
    }
    snapshots.request.after.headers = Object.fromEntries(
      Array.from({ length: 10_100 }, (_, i) => [`x-h-${i}`, `v-${i}`])
    );

    const { container, unmount } = renderWithIntl(
      <StatefulTabsHarness snapshots={snapshots} specialSettings={null} />
    );

    click(requestHeadersTrigger(container));
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
    const snapshots = createSnapshots();
    if (!snapshots.request.after) {
      throw new Error("after snapshot missing");
    }
    snapshots.request.after.body = requestBody;

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
      <StatefulTabsHarness snapshots={snapshots} specialSettings={null} />
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

function requestHeadersTrigger(container: HTMLElement) {
  return container.querySelector(
    "[data-testid='session-tab-trigger-request-headers']"
  ) as HTMLElement;
}
