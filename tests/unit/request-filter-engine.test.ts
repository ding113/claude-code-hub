import { describe, expect, test } from "vitest";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { RequestFilter } from "@/repository/request-filters";

function createSession() {
  return {
    headers: new Headers({
      "user-agent": "UA",
      "x-remove": "foo",
    }),
    request: {
      message: {
        nested: { secret: "abc" },
        text: "hello secret",
      },
      log: "",
      model: "claude-3",
    },
  } as unknown as Parameters<typeof requestFilterEngine.apply>[0];
}

describe("请求过滤引擎", () => {
  test("应该正确应用 Header 删除/设置和 Body 变更", async () => {
    const filters: RequestFilter[] = [
      {
        id: 1,
        name: "remove-header",
        description: null,
        scope: "header",
        action: "remove",
        matchType: null,
        target: "x-remove",
        replacement: null,
        priority: 0,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        name: "set-ua",
        description: null,
        scope: "header",
        action: "set",
        matchType: null,
        target: "user-agent",
        replacement: "custom-UA",
        priority: 1,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 3,
        name: "json-path",
        description: null,
        scope: "body",
        action: "json_path",
        matchType: null,
        target: "nested.secret",
        replacement: "***",
        priority: 2,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 4,
        name: "text-replace",
        description: null,
        scope: "body",
        action: "text_replace",
        matchType: "contains",
        target: "secret",
        replacement: "[redacted]",
        priority: 3,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    requestFilterEngine.setFiltersForTest(filters);
    const session = createSession();

    await requestFilterEngine.apply(session);

    expect(session.headers.has("x-remove")).toBe(false);
    expect(session.headers.get("user-agent")).toBe("custom-UA");
    expect((session.request.message as any).nested.secret).toBe("***");
    expect((session.request.message as any).text).toContain("[redacted]");
  });

  test("应该忽略不安全的正则表达式（不抛出错误）", async () => {
    requestFilterEngine.setFiltersForTest([
      {
        id: 1,
        name: "unsafe",
        description: null,
        scope: "body",
        action: "text_replace",
        matchType: "regex",
        target: "(a+)+",
        replacement: "x",
        priority: 0,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const session = createSession();
    await expect(requestFilterEngine.apply(session)).resolves.toBeUndefined();
    // body remains unchanged because regex skipped
    expect((session.request.message as any).text).toBe("hello secret");
  });
});
