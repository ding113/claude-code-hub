import { describe, expect, test, vi } from "vitest";

const runWithRequestContextMock = vi.hoisted(() =>
  vi.fn(async (_context: unknown, callback: () => unknown) => callback())
);

vi.mock("@/lib/audit/request-context", () => ({
  runWithRequestContext: runWithRequestContextMock,
}));

vi.mock("@/lib/ip", () => ({
  getClientIp: () => "203.0.113.77",
}));

const { runWithHonoRequestContext } = await import("@/lib/api/v1/_shared/request-context");

describe("v1 audit request context", () => {
  test("propagates client ip and user agent into request context", async () => {
    const request = new Request("http://localhost/api/v1/providers", {
      headers: { "user-agent": "vitest-agent" },
    });

    const result = await runWithHonoRequestContext(
      {
        req: {
          raw: request,
          header: (name: string) => request.headers.get(name) ?? undefined,
        },
      } as never,
      () => "ok"
    );

    expect(result).toBe("ok");
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      { ip: "203.0.113.77", userAgent: "vitest-agent" },
      expect.any(Function)
    );
  });
});
