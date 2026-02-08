import { describe, expect, test } from "vitest";
import { detectUpstreamErrorFromSseOrJsonText } from "./upstream-error-detection";

describe("detectUpstreamErrorFromSseOrJsonText", () => {
  test("空响应体视为错误", () => {
    expect(detectUpstreamErrorFromSseOrJsonText("")).toEqual({
      isError: true,
      reason: "上游返回 200 但响应体为空",
    });
  });

  test("纯 JSON：error 字段非空视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"error":"当前无可用凭证"}');
    expect(res.isError).toBe(true);
  });

  test("纯 JSON：error 为对象且 error.message 非空视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText(
      JSON.stringify({ error: { message: "error: no credentials" } })
    );
    expect(res.isError).toBe(true);
  });

  test.each(['{"error":true}', '{"error":42}'])("纯 JSON：error 为非字符串类型也应视为错误（%s）", (body) => {
    const res = detectUpstreamErrorFromSseOrJsonText(body);
    expect(res.isError).toBe(true);
  });

  test("纯 JSON：JSON 数组不视为错误（避免误判）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('[{"error":"something"}]');
    expect(res.isError).toBe(false);
  });

  test("纯 JSON：error 为空字符串不视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"error":""}');
    expect(res.isError).toBe(false);
  });

  test("纯 JSON：message 不包含关键字不视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"message":"all good"}');
    expect(res.isError).toBe(false);
  });

  test("纯 JSON：小于 1000 字符且 message 包含 error 字样视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"message":"some error happened"}');
    expect(res.isError).toBe(true);
  });

  test("纯 JSON：大于等于 1000 字符时不做 message 关键字判定", () => {
    const longMessage = "a".repeat(1000);
    const res = detectUpstreamErrorFromSseOrJsonText(
      JSON.stringify({ message: `${longMessage} error ${longMessage}` })
    );
    expect(res.isError).toBe(false);
  });

  test("纯 JSON：非法 JSON 不抛错且不视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText("{not-json}");
    expect(res.isError).toBe(false);
  });

  test("SSE：data JSON 包含非空 error 字段视为错误", () => {
    const sse = ['event: message', 'data: {"error":"当前无可用凭证"}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(true);
  });

  test("SSE：data JSON error 为对象且 error.message 非空视为错误", () => {
    const sse = ['data: {"error":{"message":"ERROR: no credentials"}}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(true);
  });

  test("SSE：data JSON 小于 1000 字符且 message 包含 error 字样视为错误", () => {
    const sse = ['data: {"message":"ERROR: no credentials"}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(true);
  });

  test("SSE：message 为对象时不应误判为错误", () => {
    // 类 Anthropic SSE：message 字段通常是对象（不是错误字符串）
    const sse = [
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant"}}',
      "",
    ].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(false);
  });

  test("SSE：不包含 error/message key 时不解析且不视为错误", () => {
    const sse = ['data: {"foo":"bar"}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(false);
  });

  test("SSE：仅有 [DONE] 不视为错误", () => {
    const sse = ["data: [DONE]", ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(false);
  });
});
