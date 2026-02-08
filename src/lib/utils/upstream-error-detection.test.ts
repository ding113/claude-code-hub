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

  test("纯 JSON：error 为空字符串不视为错误", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"error":""}');
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

  test("SSE：data JSON 包含非空 error 字段视为错误", () => {
    const sse = ['event: message', 'data: {"error":"当前无可用凭证"}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(true);
  });

  test("SSE：data JSON 小于 1000 字符且 message 包含 error 字样视为错误", () => {
    const sse = ['data: {"message":"ERROR: no credentials"}', ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(true);
  });

  test("SSE：仅有 [DONE] 不视为错误", () => {
    const sse = ["data: [DONE]", ""].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(sse);
    expect(res.isError).toBe(false);
  });
});

