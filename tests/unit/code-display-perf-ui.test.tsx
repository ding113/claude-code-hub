/**
 * @vitest-environment happy-dom
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CodeDisplay } from "@/components/ui/code-display";
import type { CodeDisplayConfig } from "@/components/ui/code-display-config";
import { CodeDisplayConfigProvider } from "@/components/ui/code-display-config-context";
import { CodeDisplayMatchesList } from "@/components/ui/code-display-matches-list";

const workerClientMocks = vi.hoisted(() => ({
  buildLineIndex: vi.fn(),
  searchLines: vi.fn(),
  formatJsonPretty: vi.fn(),
}));

vi.mock("@/components/ui/code-display-worker-client", () => ({
  buildLineIndex: workerClientMocks.buildLineIndex,
  searchLines: workerClientMocks.searchLines,
  formatJsonPretty: workerClientMocks.formatJsonPretty,
}));

vi.mock("@/lib/hooks/use-debounce", () => ({
  useDebounce: <T,>(value: T) => value,
}));

const dashboardMessages = JSON.parse(
  fs.readFileSync(
    (() => {
      try {
        const dir = path.dirname(fileURLToPath(import.meta.url));
        return path.resolve(dir, "../../messages/en/dashboard.json");
      } catch {
        try {
          const u = new URL(import.meta.url);
          const marker = "/@fs/";
          const idx = u.pathname.indexOf(marker);
          if (idx !== -1) {
            const absPath = decodeURIComponent(u.pathname.slice(idx + marker.length));
            return path.resolve(path.dirname(absPath), "../../messages/en/dashboard.json");
          }
        } catch {
          // ignore
        }

        return path.join(process.cwd(), "messages/en/dashboard.json");
      }
    })(),
    "utf8"
  )
);
const codeDisplayMessages = dashboardMessages.sessions.codeDisplay as {
  showAll: string;
  search: { failed: string; indexTooManyLines: string };
  virtual: { indexTooManyLines: string };
};
const tooManyLinesPrefix = codeDisplayMessages.search.indexTooManyLines.split("{")[0];
const virtualTooManyLinesPrefix = codeDisplayMessages.virtual.indexTooManyLines.split("{")[0];

function renderWithIntl(node: ReactNode, codeDisplayConfig: CodeDisplayConfig) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={{ dashboard: dashboardMessages }}
        timeZone="UTC"
      >
        <CodeDisplayConfigProvider value={codeDisplayConfig}>{node}</CodeDisplayConfigProvider>
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

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error("Timeout waiting for condition");
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function inputText(el: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(el) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  act(() => {
    descriptor?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  });
}

function buildLineStarts(text: string): Int32Array {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return Int32Array.from(starts);
}

function makeConfig(partial: Partial<CodeDisplayConfig>): CodeDisplayConfig {
  return {
    largePlainEnabled: true,
    virtualHighlightEnabled: false,
    workerEnabled: true,
    perfDebugEnabled: false,
    highlightMaxChars: 30_000,
    virtualOverscanLines: 50,
    virtualLineHeightPx: 18,
    virtualContextLines: 50,
    maxPrettyOutputBytes: 20_000_000,
    maxLineIndexLines: 200_000,
    ...partial,
  };
}

beforeEach(() => {
  workerClientMocks.buildLineIndex.mockReset();
  workerClientMocks.searchLines.mockReset();
  workerClientMocks.formatJsonPretty.mockReset();

  workerClientMocks.buildLineIndex.mockResolvedValue({
    ok: true,
    lineStarts: new Int32Array([0]),
    lineCount: 1,
  });
  workerClientMocks.searchLines.mockResolvedValue({ ok: true, matches: new Int32Array(0) });
  workerClientMocks.formatJsonPretty.mockResolvedValue({
    ok: false,
    errorCode: "UNKNOWN",
  });
});

describe("CodeDisplay - large content performance strategy", () => {
  test("large JSON pretty defaults to plain textarea when enabled (scheme1)", async () => {
    const obj = { a: Array.from({ length: 30 }, (_, i) => i) };
    const raw = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);
    const highlightMaxChars = Math.floor((raw.length + pretty.length) / 2);

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={raw} language="json" />,
      makeConfig({
        highlightMaxChars,
        largePlainEnabled: true,
        virtualHighlightEnabled: false,
      })
    );

    await flushMicrotasks();

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe(pretty);
    expect(
      container.querySelector('[data-testid="code-display-large-pretty-view-virtual"]')
    ).toBeNull();
    expect(container.querySelector('[data-testid="code-display-virtual-highlighter"]')).toBeNull();

    unmount();
  });

  test("worker pretty can cancel and retry without getting stuck", async () => {
    const raw = JSON.stringify({ a: "x".repeat(200) });

    let callNo = 0;
    workerClientMocks.formatJsonPretty.mockImplementation(async ({ signal }) => {
      callNo += 1;

      if (callNo === 1) {
        return await new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve({ ok: false, errorCode: "CANCELED" }));
        });
      }

      return await new Promise((resolve) => {
        setTimeout(() => resolve({ ok: true, text: '{"a":1}', usedStreaming: false }), 50);
      });
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={raw} language="json" />,
      makeConfig({
        highlightMaxChars: 10,
        largePlainEnabled: false,
        virtualHighlightEnabled: false,
        workerEnabled: true,
      })
    );

    await waitFor(
      () => container.querySelector('[data-testid="code-display-json-pretty-cancel"]') !== null
    );
    expect(workerClientMocks.formatJsonPretty).toHaveBeenCalledTimes(1);

    click(container.querySelector('[data-testid="code-display-json-pretty-cancel"]') as Element);

    await waitFor(
      () => container.querySelector('[data-testid="code-display-json-pretty-retry"]') !== null
    );

    click(container.querySelector('[data-testid="code-display-json-pretty-retry"]') as Element);

    await waitFor(() => workerClientMocks.formatJsonPretty.mock.calls.length === 2);
    await waitFor(
      () => container.querySelector('[data-testid="code-display-json-pretty-cancel"]') === null
    );

    unmount();
  });

  test("worker pretty does not loop when scheme1 is disabled and output is still large", async () => {
    const obj = { a: Array.from({ length: 200 }, (_, i) => i) };
    const raw = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);

    workerClientMocks.formatJsonPretty.mockResolvedValue({
      ok: true,
      text: pretty,
      usedStreaming: false,
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={raw} language="json" />,
      makeConfig({
        highlightMaxChars: 10,
        largePlainEnabled: false,
        virtualHighlightEnabled: false,
        workerEnabled: true,
      })
    );

    await waitFor(() => workerClientMocks.formatJsonPretty.mock.calls.length === 1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(workerClientMocks.formatJsonPretty).toHaveBeenCalledTimes(1);

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("pre.whitespace-pre-wrap.break-words.font-mono")).not.toBeNull();

    unmount();
  });

  test("large pretty never uses SyntaxHighlighter above highlightMaxChars (falls back to <pre>)", async () => {
    const content = "x".repeat(200);

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" />,
      makeConfig({
        highlightMaxChars: 10,
        largePlainEnabled: false,
        virtualHighlightEnabled: false,
      })
    );

    await flushMicrotasks();

    const prettyTab = container.querySelector('[data-testid="code-display-mode-pretty"]');
    expect(prettyTab).not.toBeNull();
    click(prettyTab as Element);

    await flushMicrotasks();

    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector('[data-testid="code-display-virtual-highlighter"]')).toBeNull();

    const pre = container.querySelector("pre.whitespace-pre-wrap.break-words.font-mono");
    expect(pre).not.toBeNull();
    expect((pre as HTMLElement).textContent).toContain(content.slice(0, 50));

    unmount();
  });

  test("when virtual highlight is enabled, can switch from plain to virtual view (scheme3)", async () => {
    const obj = { a: Array.from({ length: 30 }, (_, i) => i) };
    const raw = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);
    const highlightMaxChars = Math.floor((raw.length + pretty.length) / 2);

    let resolveIndex:
      | ((v: { ok: true; lineStarts: Int32Array; lineCount: number }) => void)
      | undefined;
    workerClientMocks.buildLineIndex.mockImplementation(
      async () =>
        await new Promise<{ ok: true; lineStarts: Int32Array; lineCount: number }>((resolve) => {
          resolveIndex = resolve;
        })
    );

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={raw} language="json" />,
      makeConfig({
        highlightMaxChars,
        largePlainEnabled: true,
        virtualHighlightEnabled: true,
        workerEnabled: true,
      })
    );

    await flushMicrotasks();

    const toggle = container.querySelector(
      '[data-testid="code-display-large-pretty-view-virtual"]'
    );
    expect(toggle).not.toBeNull();

    click(toggle as Element);

    expect(workerClientMocks.buildLineIndex).toHaveBeenCalledTimes(1);
    const firstCallArgs = workerClientMocks.buildLineIndex.mock.calls[0]?.[0] as { text: string };
    expect(firstCallArgs.text).toBe(pretty);

    await waitFor(
      () => container.querySelector('[data-testid="code-display-virtual-highlighter"]') !== null
    );
    expect(container.querySelector("textarea")).toBeNull();

    resolveIndex?.({
      ok: true,
      lineStarts: buildLineStarts(pretty),
      lineCount: pretty.split("\n").length,
    });
    await flushMicrotasks();

    expect(
      container.querySelector('[data-testid="code-display-virtual-highlighter"]')
    ).not.toBeNull();
    expect(container.textContent).toContain('"a"');

    unmount();
  });

  test("large only-matches uses worker index+search and renders matches list", async () => {
    const content = ["alpha", "beta", "alpha gamma", "delta"].join("\n");
    const starts = buildLineStarts(content);

    workerClientMocks.buildLineIndex.mockResolvedValue({
      ok: true,
      lineStarts: starts,
      lineCount: starts.length,
    });
    workerClientMocks.searchLines.mockResolvedValue({
      ok: true,
      matches: Int32Array.from([0, 2]),
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" />,
      makeConfig({
        highlightMaxChars: 10,
        workerEnabled: true,
        largePlainEnabled: true,
      })
    );

    await flushMicrotasks();

    const onlyMatchesToggle = container.querySelector(
      '[data-testid="code-display-only-matches-toggle"]'
    );
    expect(onlyMatchesToggle).not.toBeNull();
    click(onlyMatchesToggle as Element);

    await waitFor(() => {
      const btn = container.querySelector('[data-testid="code-display-only-matches-toggle"]');
      return (btn?.textContent || "").includes(codeDisplayMessages.showAll);
    });

    const searchInput = container.querySelector(
      '[data-testid="code-display-search"]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    inputText(searchInput as HTMLInputElement, "alpha");

    await flushMicrotasks();
    expect((searchInput as HTMLInputElement).value).toBe("alpha");

    await waitFor(() => workerClientMocks.buildLineIndex.mock.calls.length > 0);
    await waitFor(() => workerClientMocks.searchLines.mock.calls.length > 0);
    await waitFor(
      () => container.querySelector('[data-testid="code-display-matches-list"]') !== null
    );

    expect(workerClientMocks.buildLineIndex).toHaveBeenCalled();
    expect(workerClientMocks.searchLines).toHaveBeenCalled();

    const list = container.querySelector('[data-testid="code-display-matches-list"]');
    expect(list).not.toBeNull();
    expect((list as HTMLElement).textContent).toContain("alpha gamma");
    expect((list as HTMLElement).textContent).toContain("alpha");

    unmount();
  });

  test("large only-matches still works when worker is disabled (uses no-worker path)", async () => {
    const content = ["alpha", "beta", "alpha gamma", "delta"].join("\n");
    const starts = buildLineStarts(content);

    workerClientMocks.buildLineIndex.mockResolvedValue({
      ok: true,
      lineStarts: starts,
      lineCount: starts.length,
    });
    workerClientMocks.searchLines.mockResolvedValue({
      ok: true,
      matches: Int32Array.from([0, 2]),
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" />,
      makeConfig({
        highlightMaxChars: 10,
        workerEnabled: false,
        largePlainEnabled: true,
      })
    );

    await flushMicrotasks();

    const onlyMatchesToggle = container.querySelector(
      '[data-testid="code-display-only-matches-toggle"]'
    );
    expect(onlyMatchesToggle).not.toBeNull();
    click(onlyMatchesToggle as Element);

    await waitFor(() => {
      const btn = container.querySelector('[data-testid="code-display-only-matches-toggle"]');
      return (btn?.textContent || "").includes(codeDisplayMessages.showAll);
    });

    const searchInput = container.querySelector(
      '[data-testid="code-display-search"]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    inputText(searchInput as HTMLInputElement, "alpha");

    await flushMicrotasks();
    await waitFor(() => workerClientMocks.buildLineIndex.mock.calls.length > 0);
    await waitFor(() => workerClientMocks.searchLines.mock.calls.length > 0);
    await waitFor(
      () => container.querySelector('[data-testid="code-display-matches-list"]') !== null
    );

    const buildArgs = workerClientMocks.buildLineIndex.mock.calls[0]?.[0] as {
      workerEnabled?: boolean;
    };
    expect(buildArgs.workerEnabled).toBe(false);

    const searchArgs = workerClientMocks.searchLines.mock.calls[0]?.[0] as {
      workerEnabled?: boolean;
    };
    expect(searchArgs.workerEnabled).toBe(false);

    const list = container.querySelector('[data-testid="code-display-matches-list"]');
    expect(list).not.toBeNull();
    expect((list as HTMLElement).textContent).toContain("alpha gamma");

    unmount();
  });

  test("only-matches shows index error message when line index build fails", async () => {
    const content = ["alpha", "beta", "alpha gamma", "delta"].join("\n");

    workerClientMocks.buildLineIndex.mockResolvedValue({
      ok: false,
      errorCode: "TOO_MANY_LINES",
      lineCount: 300_000,
    });
    workerClientMocks.searchLines.mockResolvedValue({
      ok: true,
      matches: Int32Array.from([0, 2]),
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" />,
      makeConfig({
        highlightMaxChars: 10,
        workerEnabled: true,
        largePlainEnabled: true,
      })
    );

    await flushMicrotasks();

    const onlyMatchesToggle = container.querySelector(
      '[data-testid="code-display-only-matches-toggle"]'
    );
    expect(onlyMatchesToggle).not.toBeNull();
    click(onlyMatchesToggle as Element);

    await waitFor(() => {
      const btn = container.querySelector('[data-testid="code-display-only-matches-toggle"]');
      return (btn?.textContent || "").includes(codeDisplayMessages.showAll);
    });

    const searchInput = container.querySelector(
      '[data-testid="code-display-search"]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    inputText(searchInput as HTMLInputElement, "alpha");

    await flushMicrotasks();
    await waitFor(() => workerClientMocks.buildLineIndex.mock.calls.length > 0);
    await waitFor(() => (container.textContent || "").includes(tooManyLinesPrefix));
    expect(workerClientMocks.searchLines).not.toHaveBeenCalled();

    expect(container.querySelector('[data-testid="code-display-matches-list"]')).toBeNull();

    unmount();
  });

  test("only-matches shows search error message when worker search fails", async () => {
    const content = ["alpha", "beta", "alpha gamma", "delta"].join("\n");
    const starts = buildLineStarts(content);

    workerClientMocks.buildLineIndex.mockResolvedValue({
      ok: true,
      lineStarts: starts,
      lineCount: starts.length,
    });
    workerClientMocks.searchLines.mockResolvedValue({
      ok: false,
      errorCode: "UNKNOWN",
    });

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={content} language="text" />,
      makeConfig({
        highlightMaxChars: 10,
        workerEnabled: true,
        largePlainEnabled: true,
      })
    );

    await flushMicrotasks();

    const onlyMatchesToggle = container.querySelector(
      '[data-testid="code-display-only-matches-toggle"]'
    );
    expect(onlyMatchesToggle).not.toBeNull();
    click(onlyMatchesToggle as Element);

    await waitFor(() => {
      const btn = container.querySelector('[data-testid="code-display-only-matches-toggle"]');
      return (btn?.textContent || "").includes(codeDisplayMessages.showAll);
    });

    const searchInput = container.querySelector(
      '[data-testid="code-display-search"]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    inputText(searchInput as HTMLInputElement, "alpha");

    await flushMicrotasks();
    await waitFor(() => workerClientMocks.searchLines.mock.calls.length > 0);
    await waitFor(() => (container.textContent || "").includes(codeDisplayMessages.search.failed));

    expect(container.querySelector('[data-testid="code-display-matches-list"]')).toBeNull();

    unmount();
  });

  test("when line index fails, fallback forces plain textarea even if scheme1 is disabled", async () => {
    workerClientMocks.buildLineIndex.mockResolvedValue({
      ok: false,
      errorCode: "TOO_MANY_LINES",
      lineCount: 300_000,
    });

    const obj = { a: Array.from({ length: 30 }, (_, i) => i) };
    const raw = JSON.stringify(obj);
    const pretty = JSON.stringify(obj, null, 2);
    const highlightMaxChars = Math.floor((raw.length + pretty.length) / 2);

    const { container, unmount } = renderWithIntl(
      <CodeDisplay content={raw} language="json" />,
      makeConfig({
        highlightMaxChars,
        largePlainEnabled: false,
        virtualHighlightEnabled: true,
        workerEnabled: true,
      })
    );

    await waitFor(() => container.querySelector("textarea") !== null);
    await waitFor(() => (container.textContent || "").includes(virtualTooManyLinesPrefix));

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe(pretty);

    expect(
      container.querySelector('[data-testid="code-display-large-pretty-view-plain"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="code-display-large-pretty-view-virtual"]')
    ).not.toBeNull();

    unmount();
  });

  test("matches list does not truncate the last character on final line", async () => {
    const text = "abc";

    const { container, unmount } = renderWithIntl(
      <CodeDisplayMatchesList
        text={text}
        matches={Int32Array.from([0])}
        lineStarts={Int32Array.from([0])}
        maxHeight="200px"
        lineHeightPx={18}
      />,
      makeConfig({})
    );

    await flushMicrotasks();

    const list = container.querySelector('[data-testid="code-display-matches-list"]');
    expect(list).not.toBeNull();
    expect((list as HTMLElement).textContent).toContain("abc");

    unmount();
  });

  test("matches list strips CR-only line endings", async () => {
    const text = "a\rb\r";

    const { container, unmount } = renderWithIntl(
      <CodeDisplayMatchesList
        text={text}
        matches={Int32Array.from([0, 1])}
        // lineStarts 最后一项 4 === text.length，表示末尾 CR 后存在一个空的尾随行；
        // 因此 matches 只包含有内容的第 0/1 行（"a" / "b"），不包含空行。
        lineStarts={Int32Array.from([0, 2, 4])}
        maxHeight="200px"
        lineHeightPx={18}
      />,
      makeConfig({})
    );

    await flushMicrotasks();

    const spans = Array.from(container.querySelectorAll("span.whitespace-pre"));
    expect(spans.length).toBe(2);
    expect(spans[0]?.textContent).toBe("a");
    expect(spans[1]?.textContent).toBe("b");

    unmount();
  });
});
