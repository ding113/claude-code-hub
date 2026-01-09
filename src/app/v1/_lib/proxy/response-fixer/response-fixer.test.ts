import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    storeSessionSpecialSettings: vi.fn(async () => {}),
    updateMessageRequestDetails: vi.fn(async () => {}),
    getCachedSystemSettings: vi.fn(async () => ({
      enableResponseFixer: true,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 1024 * 1024,
      },
    })),
  };
});

vi.mock("@/lib/session-manager", () => ({
  SessionManager: {
    storeSessionSpecialSettings: mocks.storeSessionSpecialSettings,
  },
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

vi.mock("@/lib/config", () => ({
  getCachedSystemSettings: mocks.getCachedSystemSettings,
}));

function createSession() {
  const settings: unknown[] = [];
  return {
    sessionId: "sess_test",
    requestSequence: 1,
    messageContext: { id: 123 },
    addSpecialSetting: (s: unknown) => settings.push(s),
    getSpecialSettings: () => (settings.length > 0 ? (settings as any[]) : null),
  } as any;
}

describe("ResponseFixer", () => {
  test("禁用时应原样透传（不加 header，不写 specialSettings）", async () => {
    const { ResponseFixer } = await import("./index");

    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      enableResponseFixer: false,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 1024 * 1024,
      },
    });

    const session = createSession();
    const response = new Response('{"a":1}', {
      headers: { "content-type": "application/json" },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('{"a":1}');
    expect(fixed.headers.get("x-cch-response-fixer")).toBeNull();
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("非流式响应：命中编码修复时应写入 specialSettings 并持久化", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    const bomJson = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    const response = new Response(bomJson, {
      headers: { "content-type": "application/json; charset=utf-8" },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('{"a":1}');
    expect(fixed.headers.get("x-cch-response-fixer")).toBe("applied");
    expect(session.getSpecialSettings()).not.toBeNull();
    expect(mocks.storeSessionSpecialSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("流式 SSE：应支持跨 chunk 缓冲并修复 data 行内的截断 JSON", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"key":'));
        controller.enqueue(encoder.encode("\n\n"));
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fixed = await ResponseFixer.process(session, response);
    const text = await fixed.text();

    expect(fixed.headers.get("x-cch-response-fixer")).toBe("processed");
    expect(text).toBe('data: {"key":null}\n\n');
    expect(session.getSpecialSettings()).not.toBeNull();
  });

  test("流式 SSE：有效 SSE 不应写入 specialSettings", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\n'));
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('data: {"a":1}\n\n');
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("流式 SSE：无换行且超过 maxFixSize 时应降级输出，避免无限缓冲", async () => {
    const { ResponseFixer } = await import("./index");

    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      enableResponseFixer: true,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 12,
      },
    });

    const session = createSession();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"k":'));
        controller.enqueue(encoder.encode('"v"'));
        // 保持流不关闭：如果没有降级策略，这里会一直缓冲直到 flush（潜在无界增长）
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fixed = await ResponseFixer.process(session, response);
    const reader = fixed.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const readPromise = reader.read();
    const raced = await Promise.race([
      readPromise,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    // 清理：避免悬挂流导致用例卡死
    await reader.cancel();
    await readPromise.catch(() => {});

    expect(raced).not.toBe("timeout");
    expect(session.getSpecialSettings()).toBeNull();
  });
});
