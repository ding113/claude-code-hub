import { describe, expect, test } from "vitest";
import {
  createStreamProtocolObserver,
  REPLAY_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS,
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
      failure: null,
    });
  }
}

describe("StreamProtocolObserver", () => {
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
      verdict: "error",
      eventName: "response.failed",
    });
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
      failure: { verdict: "malformed", eventName: "message_stop" },
    });
  });

  test("成功 Anthropic tool_use/message_stop 可 completed", () => {
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
      sawContent: true,
      sawTerminal: true,
      failure: null,
    });
  });

  test("缺失 terminal 时保留 sawContent，但不能证明流已成功完成", () => {
    const observer = createStreamProtocolObserver("openai-chat");
    observer.observe(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
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
      failure: null,
    });
  });

  test("finish 冲刷没有尾部空行的 malformed frame", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(encoder.encode("event: response.completed\ndata: not-json"));

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      failure: { verdict: "malformed", eventName: "response.completed" },
    });
  });

  test("超长未终止 SSE 行会 fail closed，而不是被视为干净流", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(`data: ${"x".repeat(REPLAY_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1)}`)
    );

    expect(observer.finish()).toEqual({
      sawContent: false,
      sawTerminal: false,
      failure: { verdict: "malformed", eventName: null },
    });
  });

  test("首内容后 observer 超限仍保留 content，并阻止 Replay completed", () => {
    const observer = createStreamProtocolObserver("openai-responses");
    observer.observe(
      encoder.encode(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'
      )
    );
    observer.observe(
      encoder.encode(`data: ${"x".repeat(REPLAY_PROTOCOL_OBSERVER_MAX_BUFFER_CHARACTERS + 1)}`)
    );

    expect(observer.finish()).toEqual({
      sawContent: true,
      sawTerminal: false,
      failure: { verdict: "malformed", eventName: null },
    });
  });
});
