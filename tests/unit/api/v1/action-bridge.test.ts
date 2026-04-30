import { describe, expect, test, vi } from "vitest";

const runWithAuthSessionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    runWithAuthSession: runWithAuthSessionMock,
  };
});

const { callAction } = await import("@/lib/api/v1/_shared/action-bridge");

function createContext() {
  const request = new Request("http://localhost/api/v1/test", {
    headers: {
      "user-agent": "vitest",
      "x-forwarded-for": "203.0.113.9",
    },
  });

  return {
    req: {
      raw: request,
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
  };
}

describe("v1 action bridge", () => {
  test("wraps raw action returns into successful ActionResult envelopes", async () => {
    const result = await callAction(createContext() as never, async () => ({ id: 1 }), []);

    expect(result).toEqual({ ok: true, data: { id: 1 } });
    expect(runWithAuthSessionMock).not.toHaveBeenCalled();
  });

  test("preserves existing ActionResult failures without wrapping them as data", async () => {
    const result = await callAction(
      createContext() as never,
      async () => ({ ok: false, error: "失败", errorCode: "demo.failed" }) as const,
      []
    );

    expect(result).toEqual({ ok: false, error: "失败", errorCode: "demo.failed" });
  });

  test("runs actions inside the injected auth session when auth is present", async () => {
    runWithAuthSessionMock.mockImplementationOnce(async (_session, callback) => callback());
    const auth = {
      kind: "session",
      allowReadOnlyAccess: true,
      session: {
        user: { id: 1, role: "admin" },
        key: { id: 1, userId: 1, key: "admin-token" },
      },
    };

    const result = await callAction(createContext() as never, async () => "ok", [], auth as never);

    expect(result).toEqual({ ok: true, data: "ok" });
    expect(runWithAuthSessionMock).toHaveBeenCalledWith(auth.session, expect.any(Function), {
      allowReadOnlyAccess: true,
    });
  });
});
