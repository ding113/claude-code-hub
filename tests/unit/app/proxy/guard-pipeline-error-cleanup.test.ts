import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/rate-limit", () => ({
  RateLimitService: {
    releaseProviderSession: vi.fn(async () => {}),
  },
}));

// Pulled in after the mock declarations so the spy hoisting order is consistent.
const { RateLimitService } = await import("@/lib/rate-limit");
const releaseProviderSession = RateLimitService.releaseProviderSession as ReturnType<typeof vi.fn>;

import {
  __clearExtensionSteps,
  GuardPipelineBuilder,
  type GuardStep,
  registerExtensionStep,
} from "@/app/v1/_lib/proxy/guard-pipeline";
import { RateLimitError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

function makeSession(): ProxySession {
  const SessionCtor = ProxySession as unknown as {
    new (init: Record<string, unknown>): ProxySession;
  };
  const session = new SessionCtor({
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "", model: "claude-haiku-4-5" },
    userAgent: null,
    context: {} as never,
    clientAbortSignal: null,
  });
  session.sessionId = "test-session-1";
  return session;
}

describe("session.drainProviderSessionRefs (bug03)", () => {
  it("returns currently recorded refs and clears them so the second drain is empty", () => {
    const session = makeSession();
    session.recordProviderSessionRef(42);
    session.recordProviderSessionRef(7);

    const first = session.drainProviderSessionRefs();
    expect([...first].sort((a, b) => a - b)).toEqual([7, 42]);

    const second = session.drainProviderSessionRefs();
    expect(second).toEqual([]);
  });

  it("co-exists with consumeProviderSessionRef so the forwarder cannot double-release", () => {
    const session = makeSession();
    session.recordProviderSessionRef(11);

    expect(session.consumeProviderSessionRef(11)).toBe(true);
    expect(session.drainProviderSessionRefs()).toEqual([]);
  });
});

describe("GuardPipeline error cleanup (bug03)", () => {
  afterEach(() => {
    __clearExtensionSteps();
    vi.clearAllMocks();
  });

  it("releases recorded provider session refs when a later guard throws", async () => {
    const session = makeSession();
    session.recordProviderSessionRef(42);

    const failingStep: GuardStep = {
      name: "rateLimit",
      async execute() {
        throw new RateLimitError("rate_limit_error", "blocked", "usd_daily", 1, 1, null, null);
      },
    };

    const passingProvider: GuardStep = {
      name: "provider",
      async execute() {
        return null;
      },
    };

    const pipeline = GuardPipelineBuilder.build({
      steps: [],
    });

    // Inject our two steps directly via an extension anchored to "rateLimit".
    // We avoid the full preset to keep the test deterministic and free of
    // auth/session/etc. side effects.
    const ranSteps: string[] = [];
    const trackingPipeline = {
      run: async (s: ProxySession) => {
        const steps: GuardStep[] = [passingProvider, failingStep];
        try {
          for (const step of steps) {
            ranSteps.push(step.name);
            const res = await step.execute(s);
            if (res) return res;
          }
          return null;
        } catch (err) {
          // The real GuardPipelineBuilder.run wraps this in releaseAllProviderSessionRefs;
          // here we just delegate to the same helper to keep the test focused.
          const { releaseAllProviderSessionRefs } = await import(
            "@/app/v1/_lib/proxy/provider-session-cleanup"
          );
          await releaseAllProviderSessionRefs(s);
          throw err;
        }
      },
    };

    await expect(trackingPipeline.run(session)).rejects.toBeInstanceOf(RateLimitError);
    expect(releaseProviderSession).toHaveBeenCalledWith(42, "test-session-1");
    expect(session.drainProviderSessionRefs()).toEqual([]);

    // Sanity: this test never exercised the real builder, but proves the
    // contract: builder-level wiring is verified separately below.
    expect(ranSteps).toEqual(["provider", "rateLimit"]);
    void pipeline;
  });

  it("the built pipeline calls releaseAllProviderSessionRefs when a step throws", async () => {
    const session = makeSession();
    session.recordProviderSessionRef(99);

    registerExtensionStep({
      key: "bug03-fail",
      insertBefore: "rateLimit",
      step: {
        name: "boom",
        async execute() {
          throw new RateLimitError("rate_limit_error", "blocked", "usd_daily", 1, 1, null, null);
        },
      },
    });

    const pipeline = GuardPipelineBuilder.build({ steps: ["rateLimit"] });

    await expect(pipeline.run(session)).rejects.toBeInstanceOf(RateLimitError);
    expect(releaseProviderSession).toHaveBeenCalledWith(99, "test-session-1");
  });
});
