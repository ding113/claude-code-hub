import { describe, expect, test } from "vitest";
import {
  CUSTOM_HEADERS_PLACEHOLDER,
  mergeResolvedCustomHeaders,
  parseCustomHeadersJsonText,
  resolveCustomHeaderValue,
} from "./custom-headers";

function ctx(init?: {
  headers?: Record<string, string>;
  sessionId?: string | null;
  clientSessionId?: string | null;
}) {
  const headers = new Headers(init?.headers);
  return {
    getHeader: (name: string) => headers.get(name),
    sessionId: init?.sessionId,
    clientSessionId: init?.clientSessionId,
  };
}

describe("custom header templates - parse", () => {
  test("accepts static values and supported templates", () => {
    expect(
      parseCustomHeadersJsonText(
        JSON.stringify({
          "cf-aig-authorization": "Bearer token",
          "x-session-id": "{{session.id}}",
          "x-client-session": "{{session.client_id}}",
          "x-ua": "{{header.user-agent}}",
          "x-mixed": "id-{{session.id}}",
        })
      )
    ).toEqual({
      ok: true,
      value: {
        "cf-aig-authorization": "Bearer token",
        "x-session-id": "{{session.id}}",
        "x-client-session": "{{session.client_id}}",
        "x-ua": "{{header.user-agent}}",
        "x-mixed": "id-{{session.id}}",
      },
    });
  });

  test("accepts case-insensitive session and header expressions", () => {
    const result = parseCustomHeadersJsonText(
      JSON.stringify({
        "x-session-id": "{{ SESSION.ID }}",
        "x-ua": "{{Header.User-Agent}}",
      })
    );
    expect(result.ok).toBe(true);
  });

  test("rejects unknown template expressions", () => {
    expect(parseCustomHeadersJsonText(JSON.stringify({ "x-foo": "{{foo}}" }))).toEqual({
      ok: false,
      code: "invalid_template",
      path: "x-foo",
    });
  });

  test("rejects unknown session fields", () => {
    expect(parseCustomHeadersJsonText(JSON.stringify({ "x-foo": "{{session.identity}}" }))).toEqual(
      {
        ok: false,
        code: "invalid_template",
        path: "x-foo",
      }
    );
  });

  test("rejects unmatched braces", () => {
    expect(parseCustomHeadersJsonText(JSON.stringify({ "x-foo": "before {{session.id" }))).toEqual({
      ok: false,
      code: "invalid_template",
      path: "x-foo",
    });
    expect(parseCustomHeadersJsonText(JSON.stringify({ "x-foo": "session.id}}" }))).toEqual({
      ok: false,
      code: "invalid_template",
      path: "x-foo",
    });
  });

  test("rejects invalid header names inside templates", () => {
    expect(
      parseCustomHeadersJsonText(JSON.stringify({ "x-foo": "{{header.user agent}}" }))
    ).toEqual({
      ok: false,
      code: "invalid_template",
      path: "x-foo",
    });
  });

  test("rejects sensitive inbound auth headers as template sources", () => {
    for (const value of [
      "{{header.Authorization}}",
      "{{header.cookie}}",
      "{{header.x-api-key}}",
      "{{header.x-goog-api-key}}",
    ]) {
      expect(parseCustomHeadersJsonText(JSON.stringify({ "x-forwarded-auth": value }))).toEqual({
        ok: false,
        code: "invalid_template",
        path: "x-forwarded-auth",
      });
    }
  });

  test("placeholder remains parseable and includes a template example", () => {
    const result = parseCustomHeadersJsonText(CUSTOM_HEADERS_PLACEHOLDER);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.["x-session-id"]).toBe("{{session.id}}");
    }
  });
});

describe("resolveCustomHeaderValue", () => {
  test("returns static values unchanged", () => {
    expect(resolveCustomHeaderValue("Bearer token", ctx())).toBe("Bearer token");
  });

  test("keeps empty static header values", () => {
    expect(resolveCustomHeaderValue("", ctx())).toBe("");
  });

  test("copies inbound headers case-insensitively", () => {
    expect(
      resolveCustomHeaderValue(
        "{{header.user-agent}}",
        ctx({ headers: { "User-Agent": "Codex/1.0" } })
      )
    ).toBe("Codex/1.0");
  });

  test("interpolates session.id and session.client_id", () => {
    const resolveCtx = ctx({
      sessionId: "sess_assigned",
      clientSessionId: "client-sess",
    });
    expect(resolveCustomHeaderValue("{{session.id}}", resolveCtx)).toBe("sess_assigned");
    expect(resolveCustomHeaderValue("{{session.client_id}}", resolveCtx)).toBe("client-sess");
    expect(resolveCustomHeaderValue("id-{{session.id}}", resolveCtx)).toBe("id-sess_assigned");
  });

  test("omits the header when any source is missing", () => {
    expect(resolveCustomHeaderValue("{{header.x-request-id}}", ctx())).toBeNull();
    expect(resolveCustomHeaderValue("{{session.id}}", ctx())).toBeNull();
    expect(
      resolveCustomHeaderValue("id-{{session.client_id}}", ctx({ sessionId: "sess_assigned" }))
    ).toBeNull();
  });

  test("omits resolved values that contain CRLF", () => {
    expect(
      resolveCustomHeaderValue(
        "{{header.x-evil}}",
        ctx({ headers: { "x-evil": "ok\r\nInjected: 1" } })
      )
    ).toBeNull();
  });
});

describe("mergeResolvedCustomHeaders", () => {
  test("merges static and resolved templates into overrides", () => {
    const overrides: Record<string, string> = { host: "upstream.example" };
    mergeResolvedCustomHeaders(
      overrides,
      {
        "x-tenant": "acme",
        "x-ua": "{{header.user-agent}}",
        "x-session-id": "{{session.id}}",
        "x-client-session": "{{session.client_id}}",
      },
      ctx({
        headers: { "user-agent": "Codex/1.0" },
        sessionId: "sess_assigned",
        clientSessionId: "client-sess",
      })
    );

    expect(overrides).toEqual({
      host: "upstream.example",
      "x-tenant": "acme",
      "x-ua": "Codex/1.0",
      "x-session-id": "sess_assigned",
      "x-client-session": "client-sess",
    });
  });

  test("skips missing sources, protected auth names, and reserved names", () => {
    const overrides: Record<string, string> = {
      authorization: "Bearer upstream",
      host: "upstream.example",
    };
    mergeResolvedCustomHeaders(
      overrides,
      {
        Authorization: "Bearer attacker",
        host: "attacker.example",
        "x-missing": "{{header.x-request-id}}",
        "x-ua": "{{header.user-agent}}",
      },
      ctx({ headers: { "user-agent": "Codex/1.0" } }),
      new Set(["host"])
    );

    expect(overrides.authorization).toBe("Bearer upstream");
    expect(overrides.host).toBe("upstream.example");
    expect(overrides["x-missing"]).toBeUndefined();
    expect(overrides["x-ua"]).toBe("Codex/1.0");
  });

  test("keeps empty static values and skips sensitive source templates", () => {
    const overrides: Record<string, string> = {};
    mergeResolvedCustomHeaders(
      overrides,
      {
        "x-empty": "",
        "x-forwarded-auth": "{{header.Authorization}}",
      },
      ctx({ headers: { Authorization: "Bearer secret" } })
    );
    expect(overrides["x-empty"]).toBe("");
    expect(overrides["x-forwarded-auth"]).toBeUndefined();
  });
});
