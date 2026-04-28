/**
 * /api/v1 secret redaction：单元测试
 *
 * 验证：
 * - DEFAULT_SECRET_KEYS 在顶层匹配（大小写不敏感）；
 * - 嵌套对象 / 数组中的字段也会被处理；
 * - 原对象不被修改（返回新对象）；
 * - WEBHOOK_SECRET_KEYS 在 DEFAULT 之上额外屏蔽 webhookUrl / telegramBotToken / dingtalkSecret。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SECRET_KEYS,
  redactSecrets,
  sanitizeForLogging,
  WEBHOOK_SECRET_KEYS,
} from "@/lib/api/v1/_shared/redaction";

const REDACTED = "[REDACTED]";

describe("redactSecrets - DEFAULT_SECRET_KEYS", () => {
  it("redacts top-level matches case-insensitively", () => {
    const input = {
      apiKey: "sk-1234",
      Key: "another-secret",
      Password: "p@ss",
      Token: "t-token",
      Authorization: "Bearer xxxxx",
      Secret: "shh",
      name: "ok",
    };
    const out = redactSecrets(input);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.Key).toBe(REDACTED);
    expect(out.Password).toBe(REDACTED);
    expect(out.Token).toBe(REDACTED);
    expect(out.Authorization).toBe(REDACTED);
    expect(out.Secret).toBe(REDACTED);
    expect(out.name).toBe("ok");
  });

  it("recursively redacts nested objects", () => {
    const input = {
      meta: { ok: true },
      auth: {
        token: "deep-token",
        nested: { password: "deep-pass", info: "keep" },
      },
    };
    const out = redactSecrets(input);
    const auth = out.auth as { token: string; nested: { password: string; info: string } };
    expect(auth.token).toBe(REDACTED);
    expect(auth.nested.password).toBe(REDACTED);
    expect(auth.nested.info).toBe("keep");
    expect((out.meta as { ok: boolean }).ok).toBe(true);
  });

  it("redacts secrets inside arrays of objects", () => {
    const input = {
      items: [
        { name: "a", apiKey: "key-1" },
        { name: "b", apiKey: "key-2" },
      ],
    };
    const out = redactSecrets(input);
    const items = out.items as Array<{ name: string; apiKey: string }>;
    expect(items[0].apiKey).toBe(REDACTED);
    expect(items[1].apiKey).toBe(REDACTED);
    expect(items[0].name).toBe("a");
    expect(items[1].name).toBe("b");
  });

  it("does not mutate the original object", () => {
    const input = { apiKey: "sk-original", nested: { token: "raw" } };
    const snapshot = JSON.parse(JSON.stringify(input)) as typeof input;
    const out = redactSecrets(input);
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
    expect((out.nested as { token: string }).token).toBe(REDACTED);
  });

  it("DEFAULT_SECRET_KEYS does NOT redact webhookUrl by default", () => {
    const input = {
      webhookUrl: "https://hooks.example/path",
      telegramBotToken: "1234:abc",
      dingtalkSecret: "ding-secret",
      apiKey: "sk-protected",
    };
    const out = redactSecrets(input, DEFAULT_SECRET_KEYS);
    expect(out.webhookUrl).toBe("https://hooks.example/path");
    expect(out.telegramBotToken).toBe("1234:abc");
    expect(out.dingtalkSecret).toBe("ding-secret");
    expect(out.apiKey).toBe(REDACTED);
  });
});

describe("redactSecrets - WEBHOOK_SECRET_KEYS", () => {
  it("adds webhookUrl / telegramBotToken / dingtalkSecret to redaction set", () => {
    const input = {
      webhookUrl: "https://hooks.example/path",
      telegramBotToken: "1234:abc",
      dingtalkSecret: "ding-secret",
      apiKey: "sk-protected",
      kept: "kept",
    };
    const out = redactSecrets(input, WEBHOOK_SECRET_KEYS);
    expect(out.webhookUrl).toBe(REDACTED);
    expect(out.telegramBotToken).toBe(REDACTED);
    expect(out.dingtalkSecret).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.kept).toBe("kept");
  });
});

describe("sanitizeForLogging", () => {
  it("uses DEFAULT_SECRET_KEYS preset", () => {
    const out = sanitizeForLogging({ password: "x", webhookUrl: "https://x" });
    expect(out.password).toBe(REDACTED);
    expect(out.webhookUrl).toBe("https://x");
  });
});
