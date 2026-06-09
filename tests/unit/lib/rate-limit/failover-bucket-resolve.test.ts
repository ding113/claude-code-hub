import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveCountedFlags } from "@/lib/model-rate-limit/backfill";
import type { ModelLimitBucket } from "@/lib/model-rate-limit/types";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function makeSession(clientModel: string): ProxySession {
  // The proxy session needs a minimal init payload. We sidestep fromContext (which
  // depends on Hono Context) by reaching into the private constructor via a
  // structural cast — the bug under test is purely about the post-construction
  // setProvider / changeProvider lifecycle.
  const SessionCtor = ProxySession as unknown as {
    new (init: Record<string, unknown>): ProxySession;
  };
  const session = new SessionCtor({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: {
      message: { model: clientModel },
      log: "",
      model: clientModel,
    },
    userAgent: null,
    context: {} as never,
    clientAbortSignal: null,
  });
  return session;
}

function providerWithRedirects(id: number, redirects: Array<{ source: string; target: string }>) {
  return {
    id,
    name: `p${id}`,
    providerType: "claude",
    modelRedirects: redirects.map((r) => ({
      matchType: "exact" as const,
      source: r.source,
      target: r.target,
    })),
  } as unknown as Provider;
}

describe("session.getEffectiveUpstreamModel (bug02)", () => {
  it("returns the redirect target when the provider has a matching rule", () => {
    const session = makeSession("claude-haiku-4-5");
    const provider = providerWithRedirects(1, [{ source: "claude-haiku-4-5", target: "glm-4.7" }]);
    session.setProvider(provider);
    expect(session.getEffectiveUpstreamModel()).toBe("glm-4.7");
  });

  it("returns the client model when the new provider has no matching rule", () => {
    const session = makeSession("claude-haiku-4-5");
    const providerA = providerWithRedirects(1, [{ source: "claude-haiku-4-5", target: "glm-4.7" }]);
    const providerB = providerWithRedirects(2, []);

    session.setProvider(providerA);
    expect(session.getEffectiveUpstreamModel()).toBe("glm-4.7");

    session.setProvider(providerB);
    expect(session.getEffectiveUpstreamModel()).toBe("claude-haiku-4-5");
  });

  it("returns the client model when no provider is set yet", () => {
    const session = makeSession("claude-haiku-4-5");
    expect(session.getEffectiveUpstreamModel()).toBe("claude-haiku-4-5");
  });
});

describe("session.changeProvider listener (bug02)", () => {
  it("invokes the registered listener with the session on every provider change", async () => {
    const session = makeSession("claude-haiku-4-5");
    const listener = vi.fn(async () => {});
    session.setProviderChangeListener(listener);

    await session.changeProvider(providerWithRedirects(1, []));
    await session.changeProvider(providerWithRedirects(2, []));

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0]).toBe(session);
    expect(listener.mock.calls[1][0]).toBe(session);
  });

  it("a listener swap mid-request resets stale resolved limits before re-resolving", async () => {
    const session = makeSession("claude-haiku-4-5");
    session.setResolvedModelLimits([{ id: 99 } as unknown as ModelLimitBucket]);
    session.setBypassUserGlobalCost(true);

    session.setProviderChangeListener(async (s) => {
      // Real listener would call resolveModelLimits + checkCostLimits; we just clear
      // for B (no group hit) and reset bypass.
      s.setResolvedModelLimits([]);
      s.setBypassUserGlobalCost(false);
    });

    await session.changeProvider(providerWithRedirects(2, []));

    expect(session.getResolvedModelLimits()).toHaveLength(0);
    expect(session.getBypassUserGlobalCost()).toBe(false);
  });
});

describe("backfill.resolveCountedFlags (bug02 — reset enforced upstream)", () => {
  // The simple `counted = !bypass` contract is preserved. Failover safety is
  // enforced earlier: the model rate-limit guard's listener resets bypass to
  // false on every provider change before the listener returns.
  it("counted = !bypass for both axes (mainline contract)", () => {
    const session = {
      getBypassUserGlobalCost: () => true,
      getBypassKeyGlobalCost: () => false,
      getResolvedModelLimits: () => [] as ModelLimitBucket[],
    };
    const flags = resolveCountedFlags(session);
    expect(flags.countedInUserGlobal).toBe(false);
    expect(flags.countedInKeyGlobal).toBe(true);
  });
});
