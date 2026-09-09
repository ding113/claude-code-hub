import { describe, expect, it } from "vitest";
import {
  classifyFrame,
  type ProtocolFamily,
} from "@/app/v1/_lib/proxy/stream-gate/frame-classifier";
import { createFrameProbe } from "@/app/v1/_lib/proxy/stream-gate/frame-probe";
import { ProbedSseFrames } from "@/app/v1/_lib/proxy/stream-gate/probed-sse-frames";
import { SseFrameParser } from "@/app/v1/_lib/proxy/stream-gate/sse-frames";

const families: ProtocolFamily[] = ["anthropic", "openai-chat", "openai-responses", "gemini"];
const samples = [
  "{}",
  "[]",
  "null",
  "[DONE]",
  "",
  "   ",
  "{broken}",
  " ".repeat(5000),
  `${" ".repeat(3000)}[DONE]  `,
  "\u00a0{}\u00a0",
  '{"candidates":[{"finishReason":["SAFETY"]}]}',
  '{"choices":{"#":{"delta":{"content":"wrong object wildcard"}}}}',
  '{"unused":' +
    "[".repeat(1000) +
    "0" +
    "]".repeat(1000) +
    ',"choices":[{"delta":{"content":"ok"}}]}',
  '{"type":"content_block_delta","delta":{"text":"你好\\nworld"}}',
  '{"type":"response.output_text.delta","delta":"ok","error":{"message":"failed"}}',
  '{"type":"response.output_text.delta","delta":"ok","delta":""}',
  '{"type":"response.completed","response":{"status":"completed","output":[{"type":"compaction"},{"encrypted_content":"opaque"}]}}',
  '{"type":"response.completed","response":{"status":"completed","output":[{"type":"compaction","encrypted_content":"opaque"}]}}',
  '{"choices":[{"delta":{"content":""}},{"delta":{"tool_calls":[{"function":{"arguments":"{}"}}]}}]}',
  '{"response":{"candidates":[{"content":{"parts":[{"text":"yes"}]},"finishReason":"SAFETY"}]}}',
  '{"error":false,"error":null}',
  '{"error":0}',
  '{"error":[false,null,"",[]]}',
  '{"error":[{}]}',
  '{"error":1e+2}',
  '{"error":01}',
  '{"error":1.}',
  '{"error":1e}',
  '{"error":true,}',
];

describe("增量分类与既有分类器差分", () => {
  it.each(families)("%s 保留裸 JSON、SSE 混合帧和任意网络分块语义", (family) => {
    const wires = [
      samples.map((sample) => `  ${sample} \t`).join("\r\n"),
      '  {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}  \n[{}]\n',
      'event: error\r{"error":"ignored while event pending"}\rdata: {"error":"failed"}\r\r',
      'data\n{"choices":[{"delta":{"content":"bare after ignored field"}}]}\n',
      'id: 1\n:comment\ndata:\t{\ndata: "choices": []}\n\ndata: [DONE]\n\n',
      ' event: error\n data: ignored\n \t\n{"error":true}\n',
      'data: {}\n{"error":"ignored while data pending"}\n\n',
      'event: \n\n{"type":"response.output_text.delta","delta":"tail"}\u00a0',
    ];
    for (const wire of wires) {
      const bytes = new TextEncoder().encode(wire);
      for (const size of [1, 2, 7, bytes.length]) {
        const old = new SseFrameParser();
        const parser = new ProbedSseFrames(family, 10 * 1024 * 1024);
        const expected: unknown[] = [];
        const actual: unknown[] = [];
        const before = (event: string | null, data: string) => {
          expected.push({
            event,
            verdict: classifyFrame(family, event, data),
            dataBytes: Buffer.byteLength(data),
          });
        };
        const after = (event: string | null) => {
          actual.push({
            event,
            verdict: parser.lastFrame?.verdict,
            dataBytes: parser.lastFrame?.dataBytes,
          });
        };
        for (let i = 0; i < bytes.length; i += size) {
          const chunk = bytes.subarray(i, i + size);
          old.visit(chunk, before);
          parser.visit(chunk, after);
        }
        old.finishVisit(before);
        parser.finishVisit(after);
        expect(actual, `size=${size}: ${wire}`).toEqual(expected);
      }
    }
  });

  it.each(families)("%s 任意分块、重复键与错误优先", (family) => {
    for (const data of samples) {
      for (const event of [null, "error", "response.completed", "unknown"]) {
        for (const size of [1, 7, 128]) {
          const probe = createFrameProbe(family);
          for (let i = 0; i < data.length; i += size) probe.feed(data.slice(i, i + size));
          expect(
            probe.finish(event, data.slice(0, 2000), data.length).verdict,
            `${event}: ${data}`
          ).toBe(classifyFrame(family, event, data));
        }
      }
    }
  });

  it("大量数组元素、长字符串与 UTF-8 均不保留完整载荷", () => {
    const parser = new ProbedSseFrames("openai-chat", 10 * 1024 * 1024);
    const text = `data: ${JSON.stringify({ choices: Array.from({ length: 10000 }, (_, i) => ({ delta: { content: i === 9999 ? "你好".repeat(100000) : "" } })) })}\r\n\r\n`;
    const bytes = new TextEncoder().encode(text);
    let count = 0;
    for (let i = 0; i < bytes.length; i += 7919) {
      parser.visit(bytes.subarray(i, i + 7919), (_, preview) => {
        expect(preview.length).toBeLessThanOrEqual(2000);
        expect(parser.lastFrame?.verdict).toBe("content");
        count++;
      });
    }
    expect(count).toBe(1);
  });

  it("随机协议载荷差分，数组中不同元素不能合成 compaction", () => {
    let seed = 1473;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const values = [
      null,
      false,
      true,
      0,
      "",
      "x",
      {},
      [],
      [null],
      { x: null },
      "SAFETY",
      "compaction",
    ];
    for (let i = 0; i < 1000; i++) {
      const choose = () => values[random(values.length)];
      const data = JSON.stringify({
        type: ["response.completed", "response.output_item.done", "content_block_delta"][random(3)],
        error: choose(),
        delta: { text: choose() },
        choices: [{ delta: { content: choose() } }],
        item: { type: choose(), encrypted_content: choose() },
        candidates: [{ finishReason: choose(), content: { parts: [{ text: choose() }] } }],
        response: { output: [{ type: choose() }, { encrypted_content: choose() }] },
      });
      for (const family of families) {
        const probe = createFrameProbe(family);
        probe.feed(data);
        expect(probe.finish(null, data, data.length).verdict, data).toBe(
          classifyFrame(family, null, data)
        );
      }
    }
  });
});
