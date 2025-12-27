/**
 * @vitest-environment happy-dom
 */

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, test } from "vitest";
import { CodeDisplay } from "@/components/ui/code-display";

const messages = {
  dashboard: {
    sessions: {
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

describe("CodeDisplay", () => {
  test("json pretty shows formatted output; raw shows original", () => {
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content='{"a":1}' language="json" fileName="request.json" />
    );

    const root = container.querySelector("[data-testid='code-display']");
    expect(root).not.toBeNull();

    // default: pretty for json
    expect(container.textContent).toContain('"a": 1');

    const rawTab = container.querySelector("[data-testid='code-display-mode-raw']") as HTMLElement;
    click(rawTab);
    expect(container.textContent).toContain('{"a":1}');

    unmount();
  });

  test("raw mode renders HTML-like content as text (no script/img elements)", () => {
    const malicious = `<script>alert("XSS")</script><img src=x onerror=alert('XSS')>Hello`;
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={malicious} language="text" />
    );

    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre).not.toBeNull();
    expect(pre.textContent).toContain(malicious);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    unmount();
  });

  test("sse pretty renders events and supports search filtering", () => {
    const sse = [
      "event: foo",
      'data: {"x":1}',
      "",
      "event: bar",
      "data: hello",
      "",
      "data: [DONE]",
    ].join("\n");

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={sse} language="sse" fileName="response.txt" />
    );

    // default: pretty for sse; [DONE] is dropped => 2 rows
    expect(container.querySelectorAll("[data-testid='code-display-sse-row']").length).toBe(2);

    const input = container.querySelector(
      "[data-testid='code-display-search']"
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "bar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(container.querySelectorAll("[data-testid='code-display-sse-row']").length).toBe(1);
    expect(container.textContent).toContain("bar");

    unmount();
  });

  test("sse preview renders data as text (no HTML parsing; truncated and non-truncated)", () => {
    const short = `<script>alert("XSS")</script>`;
    const long = `<img src=x onerror=alert('XSS')>${"x".repeat(200)}`;
    const sse = ["event: foo", `data: ${short}`, "", "event: bar", `data: ${long}`, ""].join("\n");

    const { container, unmount } = renderWithIntl(<CodeDisplay content={sse} language="sse" />);

    const summaries = Array.from(container.querySelectorAll("summary"));
    expect(summaries.length).toBe(2);
    expect(summaries[0]?.textContent).toContain(short);
    expect(summaries[1]?.textContent).toContain("<img src=x onerror=alert('XSS')>");
    expect(summaries[1]?.textContent).toContain("...");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();

    unmount();
  });

  test("json pretty falls back when content is not valid JSON", () => {
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content="not-json" language="json" fileName="request.json" />
    );

    expect(container.textContent).toContain("not-json");
    unmount();
  });

  test("text pretty renders and short content does not show expand toggle", () => {
    const { container, unmount } = renderWithIntl(<CodeDisplay content="hi" language="text" />);

    const root = container.querySelector("[data-testid='code-display']") as HTMLElement;
    expect(root.getAttribute("data-expanded")).toBe("true");
    expect(container.querySelector("[data-testid='code-display-expand-toggle']")).toBeNull();

    const prettyTab = container.querySelector(
      "[data-testid='code-display-mode-pretty']"
    ) as HTMLElement;
    click(prettyTab);
    expect(container.textContent).toContain("hi");

    unmount();
  });

  test("handles empty content without crashing", () => {
    const { container, unmount } = renderWithIntl(<CodeDisplay content="" language="text" />);
    const root = container.querySelector("[data-testid='code-display']") as HTMLElement;
    expect(root.getAttribute("data-expanded")).toBe("true");
    unmount();
  });

  test("text search supports only-matches mode and shows no-matches hint", () => {
    const content = ["L1-111", "L2-222", "L3-333"].join("\n");
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" fileName="headers.txt" />
    );

    const input = container.querySelector(
      "[data-testid='code-display-search']"
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "NOPE");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const toggle = container.querySelector(
      "[data-testid='code-display-only-matches-toggle']"
    ) as HTMLElement;
    click(toggle);
    expect(container.textContent).toContain("No matches");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "L2-222");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const pre = container.querySelector("pre") as HTMLElement;
    expect(pre.textContent).toContain("L2-222");
    expect(pre.textContent).not.toContain("L1-111");

    unmount();
  });

  test("sse pagination and no-matches branch", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 9; i += 1) {
      lines.push("event: evt", `data: ${i}`, "");
    }
    lines.push("event: evt", `data: ${"x".repeat(200)}`, "");
    lines.push("event: evt", "data: 11", "");
    const sse = lines.join("\n");
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={sse} language="sse" fileName="response.sse" />
    );

    expect(container.querySelectorAll("[data-testid='code-display-sse-row']").length).toBe(11);

    const input = container.querySelector(
      "[data-testid='code-display-search']"
    ) as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "does-not-exist");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("No matches");

    unmount();
  });

  test("follows global theme class on <html>", async () => {
    document.documentElement.classList.remove("dark");

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content='{"a":1}' language="json" />
    );
    const root = container.querySelector("[data-testid='code-display']") as HTMLElement;
    expect(root.getAttribute("data-resolved-theme")).toBe("light");

    document.documentElement.classList.add("dark");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(root.getAttribute("data-resolved-theme")).toBe("dark");

    unmount();
  });

  test("large content shows expand/collapse and toggles expanded state", () => {
    const long = "x".repeat(5000);
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={long} language="text" fileName="headers.txt" maxHeight="200px" />
    );

    const expand = container.querySelector(
      "[data-testid='code-display-expand-toggle']"
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();

    const root = container.querySelector("[data-testid='code-display']") as HTMLElement;
    expect(root.getAttribute("data-expanded")).toBe("false");
    click(expand);
    expect(root.getAttribute("data-expanded")).toBe("true");
    click(expand);
    expect(root.getAttribute("data-expanded")).toBe("false");

    unmount();
  });

  test("should show error for oversized content", () => {
    const hugeContent = "x".repeat(1_000_001);
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={hugeContent} language="text" fileName="huge.txt" />
    );

    expect(container.textContent).toContain("Content too large");
    expect(container.textContent).toContain("1.00 MB");
    unmount();
  });

  test("should show error for too many lines", () => {
    const manyLines = Array.from({ length: 10_001 }, (_, i) => `line ${i}`).join("\n");
    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={manyLines} language="text" fileName="many-lines.txt" />
    );

    expect(container.textContent).toContain("Content too large");
    expect(container.textContent).toContain("10,000 lines");
    unmount();
  });
});
