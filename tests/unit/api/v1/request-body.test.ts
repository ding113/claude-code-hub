import { z } from "zod";
import { describe, expect, test } from "vitest";
import { parseJsonBody } from "@/lib/api/v1/_shared/request-body";

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/v1/test", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
}

describe("v1 request body parser", () => {
  test("parses valid JSON through strict schemas", async () => {
    const result = await parseJsonBody(
      jsonRequest(JSON.stringify({ name: "test" })),
      z.object({ name: z.string() }).strict()
    );

    expect(result).toEqual({ ok: true, data: { name: "test" } });
  });

  test("rejects unsupported media types", async () => {
    const result = await parseJsonBody(jsonRequest("name=test", "text/plain"), z.object({}));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(415);
      expect(result.response.headers.get("content-type")).toBe("application/problem+json");
    }
  });

  test("rejects malformed JSON and unknown strict fields", async () => {
    const malformed = await parseJsonBody(jsonRequest("{"), z.object({}));
    const unknownField = await parseJsonBody(
      jsonRequest(JSON.stringify({ name: "test", extra: true })),
      z.object({ name: z.string() }).strict()
    );

    expect(malformed.ok).toBe(false);
    expect(unknownField.ok).toBe(false);
    if (!unknownField.ok) {
      const body = await unknownField.response.json();
      expect(body).toMatchObject({ status: 400, errorCode: "request.validation_failed" });
    }
  });
});
