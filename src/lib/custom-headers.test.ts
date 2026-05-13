import { describe, expect, test } from "vitest";
import {
  CUSTOM_HEADERS_PLACEHOLDER,
  normalizeCustomHeadersRecord,
  parseCustomHeadersJsonText,
  stringifyCustomHeadersForTextarea,
} from "./custom-headers";

describe("parseCustomHeadersJsonText - empty/whitespace/empty-object", () => {
  test("empty string normalizes to null", () => {
    expect(parseCustomHeadersJsonText("")).toEqual({ ok: true, value: null });
  });

  test("whitespace-only normalizes to null", () => {
    expect(parseCustomHeadersJsonText("   \t\n  ")).toEqual({ ok: true, value: null });
  });

  test("empty object normalizes to null", () => {
    expect(parseCustomHeadersJsonText("{}")).toEqual({ ok: true, value: null });
  });

  test("object with only whitespace inside also normalizes to null", () => {
    expect(parseCustomHeadersJsonText("  {}  ")).toEqual({ ok: true, value: null });
  });
});

describe("parseCustomHeadersJsonText - happy path", () => {
  test("parses Cloudflare AI Gateway example", () => {
    const result = parseCustomHeadersJsonText('{"cf-aig-authorization":"Bearer your-token"}');
    expect(result).toEqual({
      ok: true,
      value: { "cf-aig-authorization": "Bearer your-token" },
    });
  });

  test("preserves multiple valid headers", () => {
    const result = parseCustomHeadersJsonText('{"x-foo":"a","x-bar":"b"}');
    expect(result).toEqual({
      ok: true,
      value: { "x-foo": "a", "x-bar": "b" },
    });
  });
});

describe("parseCustomHeadersJsonText - JSON shape errors", () => {
  test("rejects malformed JSON", () => {
    const r = parseCustomHeadersJsonText("{bad}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_json");
  });

  test("rejects JSON array as not_object", () => {
    const r = parseCustomHeadersJsonText('["bad"]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("rejects JSON null as not_object", () => {
    const r = parseCustomHeadersJsonText("null");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("rejects JSON string as not_object", () => {
    const r = parseCustomHeadersJsonText('"hello"');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });
});

describe("parseCustomHeadersJsonText - value validation", () => {
  test("rejects non-string value (number)", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": 123}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_value");
  });

  test("rejects non-string value (boolean)", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": true}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_value");
  });

  test("rejects non-string value (null)", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": null}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_value");
  });

  test("rejects non-string value (object)", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": {}}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_value");
  });
});

describe("parseCustomHeadersJsonText - name validation", () => {
  test("rejects empty header name", () => {
    const r = parseCustomHeadersJsonText('{"": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty_name");
  });

  test("rejects whitespace-only header name as empty_name", () => {
    const r = parseCustomHeadersJsonText('{"   ": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty_name");
  });

  test("rejects name with internal whitespace", () => {
    const r = parseCustomHeadersJsonText('{"x foo": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_name");
  });

  test("rejects name with disallowed character (@)", () => {
    const r = parseCustomHeadersJsonText('{"x@foo": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_name");
  });

  test("rejects name with colon", () => {
    const r = parseCustomHeadersJsonText('{"x:foo": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_name");
  });
});

describe("parseCustomHeadersJsonText - CRLF injection guard", () => {
  test("rejects CR in name", () => {
    const r = parseCustomHeadersJsonText('{"x\\rfoo": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("crlf");
  });

  test("rejects LF in name", () => {
    const r = parseCustomHeadersJsonText('{"x\\nfoo": "v"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("crlf");
  });

  test("rejects CR in value", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": "bar\\rbaz"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("crlf");
  });

  test("rejects LF in value", () => {
    const r = parseCustomHeadersJsonText('{"x-foo": "bar\\nbaz"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("crlf");
  });
});

describe("parseCustomHeadersJsonText - duplicates (case-insensitive)", () => {
  test("rejects two keys differing only by case", () => {
    const r = parseCustomHeadersJsonText('{"X-Foo": "1", "x-foo": "2"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("duplicate_name");
  });

  test("rejects mixed-case authorization plus a non-protected dupe", () => {
    const r = parseCustomHeadersJsonText('{"X-CUSTOM": "1", "x-custom": "2"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("duplicate_name");
  });
});

describe("parseCustomHeadersJsonText - protected auth headers", () => {
  test("rejects Authorization (any case)", () => {
    for (const name of ["Authorization", "AUTHORIZATION", "authorization", "auThoRizaTion"]) {
      const r = parseCustomHeadersJsonText(`{"${name}": "Bearer x"}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("protected_name");
    }
  });

  test("rejects x-api-key (any case)", () => {
    for (const name of ["x-api-key", "X-Api-Key", "X-API-KEY", "X-Api-KEY"]) {
      const r = parseCustomHeadersJsonText(`{"${name}": "secret"}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("protected_name");
    }
  });

  test("rejects x-goog-api-key (any case)", () => {
    for (const name of ["x-goog-api-key", "X-Goog-Api-Key", "X-GOOG-API-KEY"]) {
      const r = parseCustomHeadersJsonText(`{"${name}": "secret"}`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("protected_name");
    }
  });
});

describe("normalizeCustomHeadersRecord", () => {
  test("null is not_object", () => {
    const r = normalizeCustomHeadersRecord(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("undefined is not_object", () => {
    const r = normalizeCustomHeadersRecord(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("array is not_object", () => {
    const r = normalizeCustomHeadersRecord(["bad"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("number is not_object", () => {
    const r = normalizeCustomHeadersRecord(123);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_object");
  });

  test("empty record returns null value", () => {
    expect(normalizeCustomHeadersRecord({})).toEqual({ ok: true, value: null });
  });

  test("valid record passes through", () => {
    expect(normalizeCustomHeadersRecord({ "cf-aig-authorization": "Bearer x" })).toEqual({
      ok: true,
      value: { "cf-aig-authorization": "Bearer x" },
    });
  });
});

describe("stringifyCustomHeadersForTextarea", () => {
  test("null returns empty string", () => {
    expect(stringifyCustomHeadersForTextarea(null)).toBe("");
  });

  test("undefined returns empty string", () => {
    expect(stringifyCustomHeadersForTextarea(undefined)).toBe("");
  });

  test("empty record returns empty string", () => {
    expect(stringifyCustomHeadersForTextarea({})).toBe("");
  });

  test("non-empty record formats with 2-space indent", () => {
    expect(stringifyCustomHeadersForTextarea({ "x-foo": "bar" })).toBe(
      JSON.stringify({ "x-foo": "bar" }, null, 2)
    );
  });

  test("round-trips through parseCustomHeadersJsonText", () => {
    const original = { "cf-aig-authorization": "Bearer test" };
    const text = stringifyCustomHeadersForTextarea(original);
    const parsed = parseCustomHeadersJsonText(text);
    expect(parsed).toEqual({ ok: true, value: original });
  });
});

describe("CUSTOM_HEADERS_PLACEHOLDER", () => {
  test("is a parseable, valid JSON object", () => {
    const r = parseCustomHeadersJsonText(CUSTOM_HEADERS_PLACEHOLDER);
    expect(r.ok).toBe(true);
  });

  test("contains a non-protected header name", () => {
    const r = parseCustomHeadersJsonText(CUSTOM_HEADERS_PLACEHOLDER);
    if (r.ok && r.value) {
      const protectedNames = new Set(["authorization", "x-api-key", "x-goog-api-key"]);
      for (const name of Object.keys(r.value)) {
        expect(protectedNames.has(name.toLowerCase())).toBe(false);
      }
    }
  });
});
