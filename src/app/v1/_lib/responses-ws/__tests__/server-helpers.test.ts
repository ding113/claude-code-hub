// Co-located smoke test for the small helpers exported from `server.js`. We
// only validate the log-sanitization helper here; the full custom server is
// integration-tested separately.
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sanitizedRequestPath } = require("../../../../../../server.js") as {
  sanitizedRequestPath: (rawUrl: string) => string;
};

describe("server.js sanitizedRequestPath", () => {
  it("returns the path unchanged when there is no query string", () => {
    expect(sanitizedRequestPath("/v1/responses")).toBe("/v1/responses");
  });

  it("preserves the model query parameter (allow-listed)", () => {
    expect(sanitizedRequestPath("/v1/responses?model=gpt-5")).toBe("/v1/responses?model=gpt-5");
  });

  it("masks unknown / sensitive query parameters", () => {
    const out = sanitizedRequestPath("/v1/responses?api_key=sk-secret&token=abc&user=alice");
    expect(out).toContain("api_key=***");
    expect(out).toContain("token=***");
    expect(out).toContain("user=***");
    expect(out).not.toContain("sk-secret");
    expect(out).not.toContain("alice");
  });

  it("falls back to root when the URL is unparseable", () => {
    // `new URL` accepts most inputs against http://localhost; pass an obvious
    // non-string sentinel to trigger the catch branch.
    expect(sanitizedRequestPath(undefined as unknown as string)).toBe("/");
  });
});
