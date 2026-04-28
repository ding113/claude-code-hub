import { describe, expect, test } from "vitest";
import {
  cloneRequestForInternalNonStreamAttempt,
  detectClientStreamIntent,
} from "@/app/v1/_lib/proxy/fake-streaming/stream-intent";
import type { ClientFormat } from "@/app/v1/_lib/proxy/format-mapper";

function inputs({
  format,
  pathname,
  search,
  body,
}: {
  format: ClientFormat;
  pathname: string;
  search?: string;
  body?: Record<string, unknown> | null;
}) {
  return {
    format,
    pathname,
    search: search ?? "",
    body: body ?? null,
  };
}

describe("detectClientStreamIntent", () => {
  describe("standard formats (claude / openai / response)", () => {
    test.each<ClientFormat>([
      "claude",
      "openai",
      "response",
    ])("%s: body.stream === true => stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({ format, pathname: "/v1/messages", body: { stream: true } })
        )
      ).toBe(true);
    });

    test.each<ClientFormat>([
      "claude",
      "openai",
      "response",
    ])("%s: body.stream missing or false => non-stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({ format, pathname: "/v1/messages", body: { stream: false } })
        )
      ).toBe(false);
      expect(detectClientStreamIntent(inputs({ format, pathname: "/v1/messages", body: {} }))).toBe(
        false
      );
      expect(detectClientStreamIntent(inputs({ format, pathname: "/v1/messages" }))).toBe(false);
    });

    test("standard formats ignore path / query for stream intent", () => {
      expect(
        detectClientStreamIntent(
          inputs({
            format: "openai",
            pathname: "/v1/chat/completions",
            search: "?alt=sse",
            body: { stream: false },
          })
        )
      ).toBe(false);
    });
  });

  describe("gemini family", () => {
    test.each<ClientFormat>([
      "gemini",
      "gemini-cli",
    ])("%s: streamGenerateContent in path => stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({
            format,
            pathname: "/v1beta/models/gemini-1.5-pro:streamGenerateContent",
            body: {},
          })
        )
      ).toBe(true);
    });

    test.each<ClientFormat>(["gemini", "gemini-cli"])("%s: alt=sse query => stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({
            format,
            pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
            search: "?alt=sse",
            body: {},
          })
        )
      ).toBe(true);
    });

    test.each<ClientFormat>([
      "gemini",
      "gemini-cli",
    ])("%s: body.stream === true => stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({
            format,
            pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
            body: { stream: true },
          })
        )
      ).toBe(true);
    });

    test.each<ClientFormat>([
      "gemini",
      "gemini-cli",
    ])("%s: no streaming signal => non-stream", (format) => {
      expect(
        detectClientStreamIntent(
          inputs({
            format,
            pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
            body: { stream: false },
          })
        )
      ).toBe(false);
      expect(
        detectClientStreamIntent(
          inputs({
            format,
            pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
          })
        )
      ).toBe(false);
    });

    test("gemini search supports object form", () => {
      expect(
        detectClientStreamIntent(
          inputs({
            format: "gemini",
            pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
            search: "?alt=json",
            body: {},
          })
        )
      ).toBe(false);
    });
  });
});

describe("cloneRequestForInternalNonStreamAttempt", () => {
  test("standard format clones body with stream: false without mutating original", () => {
    const original = {
      format: "openai" as ClientFormat,
      pathname: "/v1/chat/completions",
      search: "",
      body: { stream: true, model: "gpt-4o-mini", messages: [] } as Record<string, unknown>,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);

    expect(clone.pathname).toBe("/v1/chat/completions");
    expect(clone.search).toBe("");
    expect(clone.body).toEqual({ stream: false, model: "gpt-4o-mini", messages: [] });
    // Original must not have been mutated
    expect(original.body).toEqual({ stream: true, model: "gpt-4o-mini", messages: [] });
    expect(clone.body).not.toBe(original.body);
  });

  test("standard format adds stream: false even when missing", () => {
    const original = {
      format: "claude" as ClientFormat,
      pathname: "/v1/messages",
      search: "",
      body: { model: "claude-3-5", messages: [] } as Record<string, unknown>,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);
    expect(clone.body).toEqual({ model: "claude-3-5", messages: [], stream: false });
  });

  test("gemini path rewrites streamGenerateContent to generateContent", () => {
    const original = {
      format: "gemini" as ClientFormat,
      pathname: "/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent",
      search: "?alt=sse&key=abc",
      body: { contents: [] } as Record<string, unknown>,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);
    expect(clone.pathname).toBe("/v1beta/models/gemini-3-pro-image-preview:generateContent");
    expect(clone.search.includes("alt=sse")).toBe(false);
    expect(clone.search.includes("key=abc")).toBe(true);
    // Original is not mutated
    expect(original.pathname).toBe(
      "/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent"
    );
    expect(original.search).toBe("?alt=sse&key=abc");
  });

  test("gemini drops alt=sse but keeps other query params", () => {
    const original = {
      format: "gemini-cli" as ClientFormat,
      pathname: "/v1internal/models/gemini-3-pro-image-preview:generateContent",
      search: "?alt=sse&clientName=cli",
      body: {} as Record<string, unknown>,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);
    expect(clone.pathname).toBe("/v1internal/models/gemini-3-pro-image-preview:generateContent");
    expect(clone.search).toBe("?clientName=cli");
  });

  test("gemini sets body.stream=false when present", () => {
    const original = {
      format: "gemini" as ClientFormat,
      pathname: "/v1beta/models/gemini-1.5-pro:generateContent",
      search: "",
      body: { stream: true, contents: [] } as Record<string, unknown>,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);
    expect(clone.body).toEqual({ stream: false, contents: [] });
    expect(original.body).toEqual({ stream: true, contents: [] });
  });

  test("preserves null body for gemini without body", () => {
    const original = {
      format: "gemini" as ClientFormat,
      pathname: "/v1beta/models/gemini-1.5-pro:streamGenerateContent",
      search: "?alt=sse",
      body: null as Record<string, unknown> | null,
    };

    const clone = cloneRequestForInternalNonStreamAttempt(original);
    expect(clone.body).toBeNull();
    expect(clone.pathname).toBe("/v1beta/models/gemini-1.5-pro:generateContent");
    expect(clone.search).toBe("");
  });
});
