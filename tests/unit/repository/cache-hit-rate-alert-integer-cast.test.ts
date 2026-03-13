import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for: CASE types integer and text cannot be matched
 *
 * The ttlFallbackSecondsExpr CASE generates THEN values via parameterized $N
 * which PostgreSQL infers as text. The outer ttlSecondsExpr CASE mixes these
 * text-inferred branches with integer literals like 3600, 300, causing the
 * type mismatch. The fix adds explicit ::integer casts to the THEN/ELSE values.
 */

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;
    if (typeof node === "number") return String(node);

    if (typeof node === "object") {
      const anyNode = node as Record<string, unknown>;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value !== undefined) {
        if (Array.isArray(anyNode.value)) {
          return (anyNode.value as unknown[]).map(walk).join("");
        }
        return walk(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }

      // Walk all own values for deeply nested SQL objects
      const values = Object.values(anyNode);
      if (values.length > 0) {
        return values.map(walk).join("");
      }
    }

    return "";
  };

  return walk(sqlObj);
}

let capturedSelectArgs: unknown = null;

vi.mock("server-only", () => ({}));

vi.mock("@/drizzle/db", () => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown[]) => void) => resolve([]);
      }
      if (prop === "select") {
        return (args: unknown) => {
          capturedSelectArgs = args;
          return new Proxy({}, handler);
        };
      }
      return (..._args: unknown[]) => new Proxy({}, handler);
    },
  };
  return {
    db: new Proxy({}, handler),
  };
});

vi.mock("@/drizzle/schema", () => ({
  messageRequest: {
    providerId: "provider_id",
    model: "model",
    originalModel: "original_model",
    sessionId: "session_id",
    requestSequence: "request_sequence",
    createdAt: "created_at",
    deletedAt: "deleted_at",
    blockedBy: "blocked_by",
    statusCode: "status_code",
    inputTokens: "input_tokens",
    cacheCreationInputTokens: "cache_creation_input_tokens",
    cacheReadInputTokens: "cache_read_input_tokens",
    cacheCreation5mInputTokens: "cache_creation_5m_input_tokens",
    cacheCreation1hInputTokens: "cache_creation_1h_input_tokens",
    cacheTtlApplied: "cache_ttl_applied",
    swapCacheTtlApplied: "swap_cache_ttl_applied",
  },
  providers: {
    id: "id",
    providerType: "provider_type",
    deletedAt: "deleted_at",
  },
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(() =>
    Promise.resolve({ billingModelSource: "original" })
  ),
}));

vi.mock("@/repository/_shared/message-request-conditions", () => ({
  EXCLUDE_WARMUP_CONDITION: "1=1",
}));

vi.mock("drizzle-orm/pg-core", async () => {
  const actual = await vi.importActual("drizzle-orm/pg-core");
  return {
    ...(actual as object),
    alias: (table: Record<string, unknown>) => ({ ...table }),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("cache-hit-rate-alert - integer cast regression", () => {
  beforeEach(() => {
    capturedSelectArgs = null;
  });

  it("ttlFallbackSecondsExpr CASE must cast THEN/ELSE values to ::integer", async () => {
    const { findProviderModelCacheHitRateMetricsForAlert } = await import(
      "@/repository/cache-hit-rate-alert"
    );

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);

    await findProviderModelCacheHitRateMetricsForAlert({
      start: oneHourAgo,
      end: now,
    });

    expect(capturedSelectArgs).toBeTruthy();
    const sqlStr = sqlToString(capturedSelectArgs);

    // The ttlFallbackSecondsExpr CASE has N provider-type WHEN clauses + 1 ELSE,
    // each requiring ::integer cast. The AST walker may merge some fragments, but
    // we must see at least 2 distinct ::integer casts (THEN + ELSE branches).
    const integerCastCount = (sqlStr.match(/::integer/g) || []).length;
    expect(integerCastCount).toBeGreaterThanOrEqual(2);
  });
});
