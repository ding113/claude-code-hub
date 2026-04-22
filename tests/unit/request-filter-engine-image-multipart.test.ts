import { describe, expect, test } from "vitest";
import { requestFilterEngine } from "@/lib/request-filter-engine";
import type { RequestFilter } from "@/repository/request-filters";

function createMultipartSession() {
  return {
    headers: new Headers({
      "user-agent": "UA",
      "x-remove": "foo",
    }),
    request: {
      message: {
        prompt: "hello secret",
        model: "gpt-image-1.5",
        _private: "strip-me",
      },
      log: "",
      model: "gpt-image-1.5",
      imageRequestMetadata: {
        endpoint: "edits",
        bodyKind: "multipart",
        contentType: "multipart/form-data; boundary=test",
        model: "gpt-image-1.5",
        parts: [],
      },
    },
    provider: {
      id: 1,
      groupTag: null,
    },
  } as any;
}

describe("请求过滤引擎 - image multipart logical body contract", () => {
  test("guard phase 仍应允许 body filters 作用到逻辑文本字段", async () => {
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
        name: "redact-prompt",
        description: null,
        scope: "body",
        action: "text_replace",
        matchType: "contains",
        target: "secret",
        replacement: "[redacted]",
        priority: 1,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    requestFilterEngine.setFiltersForTest(filters);
    const session = createMultipartSession();

    await requestFilterEngine.applyGlobal(session);

    expect(session.headers.has("x-remove")).toBe(false);
    expect(session.request.message.prompt).toContain("[redacted]");
  });

  test("final phase 仍应允许 body filters 修改 multipart 逻辑文本字段", async () => {
    const filters: RequestFilter[] = [
      {
        id: 3,
        name: "final-redact-prompt",
        description: null,
        scope: "body",
        action: "json_path",
        matchType: null,
        target: "prompt",
        replacement: "sanitized prompt",
        priority: 0,
        isEnabled: true,
        executionPhase: "final",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as RequestFilter,
    ];

    requestFilterEngine.setFiltersForTest(filters);
    const headers = new Headers();
    const logicalBody = { prompt: "hello secret" };
    const session = createMultipartSession();

    await requestFilterEngine.applyFinal(session, logicalBody, headers);

    expect(logicalBody.prompt).toBe("sanitized prompt");
  });
});
