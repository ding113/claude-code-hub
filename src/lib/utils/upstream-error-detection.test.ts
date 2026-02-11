import { describe, expect, test } from "vitest";
import { detectUpstreamErrorFromSseOrJsonText } from "@/lib/utils/upstream-error-detection";

describe("detectUpstreamErrorFromSseOrJsonText", () => {
  test("空响应体视为错误", () => {
    expect(detectUpstreamErrorFromSseOrJsonText("")).toEqual({
      isError: true,
      code: "FAKE_200_EMPTY_BODY",
    });
  });

  test("纯空白响应体视为错误", () => {
    expect(detectUpstreamErrorFromSseOrJsonText("   \n\t  ")).toEqual({
      isError: true,
      code: "FAKE_200_EMPTY_BODY",
    });
  });

  test("明显的 HTML 文档视为错误（覆盖 200+text/html 的“假 200”）", () => {
    const html = [
      "<!doctype html>",
      '<html lang="en">',
      "<head><title>New API</title></head>",
      "<body>Something went wrong</body>",
      "</html>",
    ].join("\n");
    const res = detectUpstreamErrorFromSseOrJsonText(html);
    expect(res).toEqual({
      isError: true,
      code: "FAKE_200_HTML_BODY",
      detail: expect.any(String),
    });
  });

  test("纯 JSON：content 内包含 <html> 文本不应误判为 HTML 错误", () => {
    const body = JSON.stringify({
      type: "message",
      content: [{ type: "text", text: "<html>not an error</html>" }],
    });
    const res = detectUpstreamErrorFromSseOrJsonText(body);
    expect(res.isError).toBe(false);
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

  test.each([
    '{"error":true}',
    '{"error":42}',
  ])("纯 JSON：error 为非字符串类型也应视为错误（%s）", (body) => {
    const res = detectUpstreamErrorFromSseOrJsonText(body);
    expect(res.isError).toBe(true);
  });

  test("JSON 数组输入不视为错误（目前不做解析）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('[{"error":"something"}]');
    expect(res.isError).toBe(false);
  });

  test("detail 应对 Bearer token 做脱敏（避免泄露到日志/Redis/DB）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"error":"Bearer abc.def_ghi"}');
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("Bearer [REDACTED]");
      expect(detail).not.toContain("abc.def_ghi");
    }
  });

  test("detail 应对常见 API key 前缀做脱敏（避免泄露到日志/Redis/DB）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"error":"sk-1234567890abcdef123456"}');
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("[REDACTED_KEY]");
      expect(detail).not.toContain("sk-1234567890abcdef123456");
    }
  });

  test("detail 应对 JWT 做脱敏（避免泄露到日志/Redis/DB）", () => {
    const jwt = "eyJaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc";
    const res = detectUpstreamErrorFromSseOrJsonText(JSON.stringify({ error: jwt }));
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("[JWT]");
      expect(detail).not.toContain("eyJaaaaaaaaaaaaaaa");
    }
  });

  test("detail 应对 email 做脱敏（避免泄露到日志/Redis/DB）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText(
      JSON.stringify({ error: "user@example.com is not allowed" })
    );
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("[EMAIL]");
      expect(detail).not.toContain("user@example.com");
    }
  });

  test("detail 应对通用敏感键值做脱敏（避免泄露到日志/Redis/DB）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText(
      JSON.stringify({ error: 'token=abc123 secret:xyz password:"p@ss" api_key=key123' })
    );
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("token:***");
      expect(detail).toContain("secret:***");
      expect(detail).toContain("password:***");
      expect(detail).toContain("api_key:***");
      expect(detail).not.toContain("abc123");
      expect(detail).not.toContain("xyz");
      expect(detail).not.toContain("p@ss");
      expect(detail).not.toContain("key123");
    }
  });

  test("detail 应对常见配置/凭证路径做脱敏（避免泄露到日志/Redis/DB）", () => {
    const res = detectUpstreamErrorFromSseOrJsonText(
      JSON.stringify({ error: "failed to read /etc/app/config.yaml" })
    );
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail).toContain("[PATH]");
      expect(detail).not.toContain("config.yaml");
    }
  });

  test("detail 过长时应截断（避免把大段响应写入日志/DB）", () => {
    const longText = "a".repeat(250);
    const res = detectUpstreamErrorFromSseOrJsonText(JSON.stringify({ error: longText }));
    expect(res.isError).toBe(true);
    if (res.isError) {
      const detail = res.detail ?? "";
      expect(detail.endsWith("…")).toBe(true);
      expect(detail.length).toBeLessThanOrEqual(201);
    }
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

  test("纯 JSON：options.messageKeyword 可覆盖默认关键字判定", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"message":"boom happened"}', {
      messageKeyword: /boom/i,
    });
    expect(res).toEqual({
      isError: true,
      code: "FAKE_200_JSON_MESSAGE_KEYWORD_MATCH",
      detail: "boom happened",
    });
  });

  test("纯 JSON：options.maxJsonCharsForMessageCheck 可关闭 message 关键字检测", () => {
    const res = detectUpstreamErrorFromSseOrJsonText('{"message":"some error happened"}', {
      maxJsonCharsForMessageCheck: 5,
    });
    expect(res.isError).toBe(false);
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
    const sse = ["event: message", 'data: {"error":"当前无可用凭证"}', ""].join("\n");
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
