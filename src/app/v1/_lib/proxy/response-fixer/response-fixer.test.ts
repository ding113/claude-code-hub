import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    storeSessionSpecialSettings: vi.fn(async () => {}),
    updateMessageRequestDetails: vi.fn(async () => {}),
    getCachedSystemSettings: vi.fn(async () => ({
      enableResponseFixer: true,
      enableHighConcurrencyMode: false,
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
    shouldPersistSessionDebugArtifacts: () => true,
  } as any;
}

function createSseResponse(payloadLines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payloadLines.join("\n")));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("ResponseFixer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedSystemSettings.mockResolvedValue({
      enableResponseFixer: true,
      enableHighConcurrencyMode: false,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 1024 * 1024,
      },
    });
  });

  test("禁用时应原样透传（不加 header，不写 specialSettings）", async () => {
    const { ResponseFixer } = await import("./index");

    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      enableResponseFixer: false,
      enableHighConcurrencyMode: false,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 1024 * 1024,
      },
    });

    const session = createSession();
    session.originalFormat = "response";
    const response = new Response('{"object":"response","output":null}', {
      headers: { "content-type": "application/json" },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('{"object":"response","output":null}');
    expect(fixed.headers.get("x-cch-response-fixer")).toBeNull();
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("非流式 Responses 响应：启用时应执行输出归一化", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const response = new Response('{"object":"response","output":null}', {
      headers: { "content-type": "application/json" },
    });

    const fixed = await ResponseFixer.process(session, response);

    expect(await fixed.json()).toMatchObject({ object: "response", output: [] });
  });

  test("非流式响应：命中编码修复时应写入 specialSettings 并持久化", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    const bomJson = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    const response = new Response(bomJson, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-cch-response-fixer": "applied",
      },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('{"a":1}');
    expect(fixed.headers.get("x-cch-response-fixer")).toBeNull();
    expect(session.getSpecialSettings()).not.toBeNull();
    expect(mocks.storeSessionSpecialSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("高并发模式：命中修复时应继续持久化 DB specialSettings，但不写 session Redis specialSettings", async () => {
    const { ResponseFixer } = await import("./index");

    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      enableResponseFixer: true,
      enableHighConcurrencyMode: true,
      responseFixerConfig: {
        fixTruncatedJson: true,
        fixSseFormat: true,
        fixEncoding: true,
        maxJsonDepth: 200,
        maxFixSize: 1024 * 1024,
      },
    });

    const session = createSession();
    session.shouldPersistSessionDebugArtifacts = () => false;
    const bomJson = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"a":1}')]);
    const response = new Response(bomJson, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-cch-response-fixer": "applied",
      },
    });

    const fixed = await ResponseFixer.process(session, response);
    expect(await fixed.text()).toBe('{"a":1}');
    expect(fixed.headers.get("x-cch-response-fixer")).toBeNull();
    expect(session.getSpecialSettings()).not.toBeNull();
    expect(mocks.storeSessionSpecialSettings).not.toHaveBeenCalled();
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
      headers: {
        "content-type": "text/event-stream",
        "x-cch-response-fixer": "processed",
      },
    });

    const fixed = await ResponseFixer.process(session, response);
    const text = await fixed.text();

    expect(fixed.headers.get("x-cch-response-fixer")).toBeNull();
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

  test("流式 Responses SSE：应过滤上游混入的空 Chat Completions chunk", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const encoder = new TextEncoder();
    const emptyChatChunk = {
      id: "chatcmpl-dummy",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    };
    const responseDelta = {
      type: "response.output_text.delta",
      delta: "Hi",
    };
    const responseCompleted = {
      type: "response.completed",
      response: { id: "resp_test", object: "response" },
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              `data: ${JSON.stringify(emptyChatChunk)}`,
              "",
              "event: response.output_text.delta",
              `data: ${JSON.stringify(responseDelta)}`,
              "",
              "event: response.completed",
              `data: ${JSON.stringify(responseCompleted)}`,
              "",
            ].join("\n")
          )
        );
        controller.close();
      },
    });

    const response = new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });

    const fixed = await ResponseFixer.process(session, response);
    const text = await fixed.text();

    expect(text).not.toContain("chat.completion.chunk");
    expect(text).not.toContain("chatcmpl-dummy");
    expect(text.startsWith("event: response.output_text.delta")).toBe(true);
    expect(text).toContain("response.output_text.delta");
    expect(text).toContain("response.completed");
    expect(session.getSpecialSettings()).not.toBeNull();
  });

  test("流式 Responses SSE：包含实际 content 的 Chat Completions chunk 应保留", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const chatChunk = {
      id: "chatcmpl-content",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { role: "assistant", content: "Hi" } }],
    };

    const fixed = await ResponseFixer.process(
      session,
      createSseResponse([`data: ${JSON.stringify(chatChunk)}`, ""])
    );
    const text = await fixed.text();

    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("chatcmpl-content");
    expect(text).toContain('"content":"Hi"');
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("流式 Responses SSE：带 finish_reason 的 Chat Completions chunk 应保留", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const chatChunk = {
      id: "chatcmpl-finish",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };

    const fixed = await ResponseFixer.process(
      session,
      createSseResponse([`data: ${JSON.stringify(chatChunk)}`, ""])
    );
    const text = await fixed.text();

    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("chatcmpl-finish");
    expect(text).toContain("finish_reason");
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("流式 Responses SSE：带 usage 的 Chat Completions chunk 应保留", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const chatChunk = {
      id: "chatcmpl-usage",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };

    const fixed = await ResponseFixer.process(
      session,
      createSseResponse([`data: ${JSON.stringify(chatChunk)}`, ""])
    );
    const text = await fixed.text();

    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("chatcmpl-usage");
    expect(text).toContain("prompt_tokens");
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("流式非 Responses SSE：空 Chat Completions chunk 应保留", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "chat";
    const emptyChatChunk = {
      id: "chatcmpl-chat-format",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    };

    const fixed = await ResponseFixer.process(
      session,
      createSseResponse([`data: ${JSON.stringify(emptyChatChunk)}`, ""])
    );
    const text = await fixed.text();

    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain("chatcmpl-chat-format");
    expect(session.getSpecialSettings()).toBeNull();
  });

  test("流式 Responses SSE：过滤 inert chunk 时相邻行的多字节 CJK 内容应按字节原样保留", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const encoder = new TextEncoder();
    const emptyChatChunk = {
      id: "chatcmpl-dummy",
      object: "chat.completion.chunk",
      created: 1780753978,
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
    };
    // 含 3 字节 CJK 与 4 字节扩展区 CJK（U+20000），覆盖多字节 UTF-8 往返
    const cjkDeltaBefore = {
      type: "response.output_text.delta",
      delta: "你好，",
    };
    const cjkDeltaAfter = {
      type: "response.output_text.delta",
      delta: "世界𠀀",
    };

    const fixed = await ResponseFixer.process(
      session,
      createSseResponse([
        `data: ${JSON.stringify(cjkDeltaBefore)}`,
        "",
        `data: ${JSON.stringify(emptyChatChunk)}`,
        "",
        "event: response.output_text.delta",
        `data: ${JSON.stringify(cjkDeltaAfter)}`,
        "",
        "",
      ])
    );

    const bytes = new Uint8Array(await fixed.arrayBuffer());
    const expected = encoder.encode(
      [
        `data: ${JSON.stringify(cjkDeltaBefore)}`,
        "",
        "event: response.output_text.delta",
        `data: ${JSON.stringify(cjkDeltaAfter)}`,
        "",
        "",
      ].join("\n")
    );

    expect(Array.from(bytes)).toEqual(Array.from(expected));

    // inert 过滤应计入 sse 修复的审计项
    const settings = session.getSpecialSettings() as Array<{
      fixersApplied: Array<{ fixer: string; applied: boolean }>;
    }> | null;
    expect(settings).not.toBeNull();
    expect(settings?.[0]?.fixersApplied).toEqual(
      expect.arrayContaining([expect.objectContaining({ fixer: "sse", applied: true })])
    );
  });

  test("流式 Responses SSE：不含 chat.completion.chunk 标记的块应原引用返回（字节预扫描早退）", async () => {
    const { ResponseFixer } = await import("./index");

    const session = createSession();
    session.originalFormat = "response";
    const data = new TextEncoder().encode(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你好"}\n\n'
    );

    const result = (ResponseFixer as any).filterInertResponsesChatCompletionChunks(
      session,
      data
    ) as { data: Uint8Array; applied: boolean };

    expect(result.applied).toBe(false);
    expect(result.data).toBe(data);
  });

  test("byteIndexOf：部分匹配回退与边界场景", async () => {
    const { ResponseFixer } = await import("./index");
    const encoder = new TextEncoder();
    const indexOf = (haystack: string, needle: string) =>
      (ResponseFixer as any).byteIndexOf(encoder.encode(haystack), encoder.encode(needle));

    expect(indexOf("aaab", "aab")).toBe(1);
    expect(indexOf('x"chat.completion.chunk"', '"chat.completion.chunk"')).toBe(1);
    expect(indexOf("abc", "abc")).toBe(0);
    expect(indexOf("ab", "abc")).toBe(-1);
    expect(indexOf("abc", "xyz")).toBe(-1);
  });

  test("流式 SSE：无换行且超过 maxFixSize 时应降级输出，避免无限缓冲", async () => {
    const { ResponseFixer } = await import("./index");

    mocks.getCachedSystemSettings.mockResolvedValueOnce({
      enableResponseFixer: true,
      enableHighConcurrencyMode: false,
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
