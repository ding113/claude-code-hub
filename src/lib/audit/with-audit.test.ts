import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { runWithRequestContext } from "./request-context";

const emittedEntries: unknown[] = [];

vi.mock("@/repository/audit-log", () => ({
  createAuditLogAsync: vi.fn((entry: unknown) => {
    emittedEntries.push(entry);
  }),
}));

vi.mock("@/lib/auth", () => ({
  getScopedAuthSession: vi.fn(() => ({
    user: { id: 42, name: "alice", role: "admin" },
    key: { id: 7, name: "admin-key", userId: 42 },
  })),
}));

beforeEach(() => {
  emittedEntries.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("withAudit — happy path", () => {
  test("emits success row with before + after, including redacted sensitive fields", async () => {
    const { withAudit } = await import("./with-audit");

    const result = await runWithRequestContext({ ip: "1.2.3.4", userAgent: "UA/1.0" }, async () => {
      return withAudit(
        {
          category: "user",
          action: "user.update",
          target: { type: "user", id: 123, name: "bob" },
          snapshotBefore: () => ({ id: 123, name: "bob-old", apiKey: "sk-old" }),
        },
        async () => ({ id: 123, name: "bob-new", apiKey: "sk-new" })
      );
    });

    expect(result).toEqual({ id: 123, name: "bob-new", apiKey: "sk-new" });
    expect(emittedEntries).toHaveLength(1);

    const entry = emittedEntries[0] as Record<string, unknown>;
    expect(entry.actionCategory).toBe("user");
    expect(entry.actionType).toBe("user.update");
    expect(entry.targetType).toBe("user");
    expect(entry.targetId).toBe("123");
    expect(entry.targetName).toBe("bob");
    expect(entry.success).toBe(true);
    expect(entry.operatorUserId).toBe(42);
    expect(entry.operatorUserName).toBe("alice");
    expect(entry.operatorKeyId).toBe(7);
    expect(entry.operatorKeyName).toBe("admin-key");
    expect(entry.operatorIp).toBe("1.2.3.4");
    expect(entry.userAgent).toBe("UA/1.0");
    expect(entry.beforeValue).toEqual({ id: 123, name: "bob-old", apiKey: "[REDACTED]" });
    expect(entry.afterValue).toEqual({ id: 123, name: "bob-new", apiKey: "[REDACTED]" });
  });

  test("target resolver derives target from result", async () => {
    const { withAudit } = await import("./with-audit");
    await withAudit(
      {
        category: "user",
        action: "user.create",
        target: (r: { id: number; name: string }) => ({ type: "user", id: r.id, name: r.name }),
      },
      async () => ({ id: 555, name: "new-user" })
    );
    const entry = emittedEntries[0] as Record<string, unknown>;
    expect(entry.targetId).toBe("555");
    expect(entry.targetName).toBe("new-user");
  });

  test("extractAfter controls which part of the result is stored", async () => {
    const { withAudit } = await import("./with-audit");
    await withAudit(
      {
        category: "user",
        action: "user.update",
        extractAfter: (r: { user: { id: number }; meta: unknown }) => r.user,
      },
      async () => ({ user: { id: 1 }, meta: { large: "payload" } })
    );
    const entry = emittedEntries[0] as Record<string, unknown>;
    expect(entry.afterValue).toEqual({ id: 1 });
  });
});

describe("withAudit — failure path", () => {
  test("emits success=false + errorMessage and rethrows", async () => {
    const { withAudit } = await import("./with-audit");

    await expect(
      withAudit(
        {
          category: "user",
          action: "user.delete",
          target: { type: "user", id: 1 },
          snapshotBefore: () => ({ id: 1, name: "doomed" }),
        },
        async () => {
          throw new Error("boom");
        }
      )
    ).rejects.toThrow("boom");

    const entry = emittedEntries[0] as Record<string, unknown>;
    expect(entry.success).toBe(false);
    expect(entry.errorMessage).toBe("boom");
    expect(entry.beforeValue).toEqual({ id: 1, name: "doomed" });
    expect(entry.afterValue ?? null).toBeNull();
  });

  test("snapshotBefore is called exactly once", async () => {
    const { withAudit } = await import("./with-audit");
    const snap = vi.fn(() => ({ v: 1 }));
    await withAudit(
      { category: "user", action: "user.update", snapshotBefore: snap },
      async () => ({ ok: true })
    );
    expect(snap).toHaveBeenCalledTimes(1);
  });
});

describe("withAudit — no session / no request ctx", () => {
  test("operator fields are null when unavailable; IP null", async () => {
    vi.doMock("@/lib/auth", () => ({
      getScopedAuthSession: vi.fn(() => null),
    }));
    vi.resetModules();

    const { withAudit } = await import("./with-audit");

    // No runWithRequestContext wrap → expect null ip/userAgent
    await withAudit({ category: "auth", action: "login.success" }, async () => ({ ok: true }));

    const entry = emittedEntries[0] as Record<string, unknown>;
    expect(entry.operatorUserId).toBeNull();
    expect(entry.operatorUserName).toBeNull();
    expect(entry.operatorIp).toBeNull();
    expect(entry.userAgent).toBeNull();
  });
});
