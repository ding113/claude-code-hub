import { describe, expect, test } from "vitest";
import {
  createStreamProtocolObserver,
  STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS,
} from "@/app/v1/_lib/proxy/stream-gate/stream-protocol-observer";

const encoder = new TextEncoder();

function observeAtEveryBoundary(stream: string): void {
  const bytes = encoder.encode(stream);
  for (let split = 0; split <= bytes.length; split++) {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(bytes.subarray(0, split));
    observer.observe(bytes.subarray(split));
    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: true,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: null,
    });
  }
}

describe("StreamProtocolObserver", () => {
  test("同时识别携带 compaction 内容的 Responses 完成终态", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[{"type":"compaction","encrypted_content":"opaque"}]}}\n\n'
      )
    );

    expect(observer.finish()).toMatchObject({
      sawContent: true,
      sawTerminal: true,
      sawIncomplete: false,
      failure: null,
    });
  });

  test("同时识别携带文本与 finishReason 的 Gemini 完成帧", () => {
    const observer = createStreamProtocolObserver("gemini");
    observer.observe(
      encoder.encode(
        '{"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}\n'
      )
    );

    expect(observer.finish()).toMatchObject({
      sawContent: true,
      sawTerminal: true,
      sawIncomplete: false,
      failure: null,
    });
  });

  test("在任意网络 chunk boundary 下都识别 content 与成功 terminal", () => {
    observeAtEveryBoundary(
      [
        'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"你好"}\r\n\r\n',
        'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n',
      ].join("")
    );
  });

  test("首内容后继续识别失败帧，并在 EOF 冲刷无空行结尾的 terminal", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    const stream = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}',
    ].join("");
    const bytes = encoder.encode(stream);

    observer.observe(bytes.subarray(0, 17));
    observer.observe(bytes.subarray(17, bytes.length - 11));
    observer.observe(bytes.subarray(bytes.length - 11));
    const result = observer.finish();

    expect(result.sawContent).toBe(true);
    expect(result.sawTerminal).toBe(true);
    expect(result.failure).toEqual({
      afterContent: true,
      verdict: "error",
      eventName: "response.failed",
    });
    expect(result.observationIncomplete).toBe(false);
  });

  test("把 malformed data 记录为终态失败", () => {
    const observer = createStreamProtocolObserver("anthropic");
    observer.observe(
      encoder.encode(
        [
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n',
          "event: message_stop\ndata: {not-json}\n\n",
        ].join("")
      )
    );

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: { afterContent: true, verdict: "malformed", eventName: "message_stop" },
    });
  });

  test("显式 protocol error 覆盖较早的 malformed，但保留 Replay 禁用证据", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(
        [
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
          "event: response.in_progress\ndata: not-json\n\n",
          'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n',
        ].join("")
      )
    );

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: {
        afterContent: true,
        verdict: "error",
        eventName: "response.failed",
        sawMalformed: true,
      },
    });
  });

  test("Anthropic tool metadata alone does not count as committed content", () => {
    const observer = createStreamProtocolObserver("anthropic");
    observer.observe(
      encoder.encode(
        [
          'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","name":"lookup"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ].join("")
      )
    );

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: true,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: null,
    });
  });

  test("缺失 terminal 时保留 sawContent，但不能证明流已成功完成", () => {
    const observer = createStreamProtocolObserver("openai-chat");
    observer.observe(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: null,
    });
  });

  test("OpenAI Chat 的 [DONE] 是成功 terminal", () => {
    const observer = createStreamProtocolObserver("openai-chat");
    observer.observe(
      encoder.encode(
        ['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', "data: [DONE]\n\n"].join("")
      )
    );

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: true,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: null,
    });
  });

  test.each([
    'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n',
    'data: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n',
  ])("Responses incomplete 结束读取但不构成成功 completion", (frame) => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(encoder.encode(frame));

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      sawIncomplete: true,
      observationIncomplete: false,
      failure: null,
    });
  });

  test("finish 冲刷没有尾部空行的 malformed frame", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(encoder.encode("event: response.completed\ndata: not-json"));

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: { afterContent: false, verdict: "malformed", eventName: "response.completed" },
    });
  });

  test("observer 为单个未完成协议帧保留 10 MiB 观察空间", () => {
    expect(STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS).toBe(10 * 1024 * 1024);
  });

  test("超长未终止 SSE 行只会使观察不完整，不会伪造 malformed", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(`data: ${"x".repeat(STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1)}`)
    );

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: true,
      failure: null,
    });
  });

  test("大型 Responses request echo 后的正常内容不会被误判为 malformed", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    const requestEcho = [
      "event: response.created\n",
      `data: ${JSON.stringify({
        response: {
          id: "resp_large_echo",
          instructions: "x".repeat(STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1),
          status: "in_progress",
        },
        type: "response.created",
      })}\n\n`,
    ].join("");
    const suffix = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ].join("");
    const bytes = encoder.encode(`${requestEcho}${suffix}`);
    for (let offset = 0; offset < bytes.length; offset += 16 * 1024) {
      observer.observe(bytes.subarray(offset, offset + 16 * 1024));
    }

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: true,
      sawIncomplete: false,
      observationIncomplete: false,
      failure: null,
    });
  });

  test("大型非 request echo 帧达到资源上限时标记 observation incomplete", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(
        `event: response.output_item.added\ndata: ${JSON.stringify({
          item: {
            id: "msg_oversized",
            payload: "x".repeat(STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1),
            type: "message",
          },
          type: "response.output_item.added",
        })}\n\n`
      )
    );

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: true,
      failure: null,
    });
  });

  test("首内容后 observer 超限保留 content，并把资源上限与协议失败分开", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'
      )
    );
    observer.observe(
      encoder.encode(`data: ${"x".repeat(STREAM_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1)}`)
    );

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
      sawIncomplete: false,
      observationIncomplete: true,
      failure: null,
    });
  });
});
