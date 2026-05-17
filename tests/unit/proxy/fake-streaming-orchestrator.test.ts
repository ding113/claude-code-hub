import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  orchestrateFakeStreamingAttempts,
  type FakeStreamingAttemptOutcome,
} from "@/app/v1/_lib/proxy/fake-streaming/orchestrator";

const validBody = JSON.stringify({
  id: "msg",
  type: "message",
  content: [{ type: "text", text: "ok" }],
});

const emptyBody = "";

function makeAttempt(outcome: {
  status: number;
  body: string;
  providerId: string;
}): FakeStreamingAttemptOutcome {
  return outcome;
}

describe("orchestrateFakeStreamingAttempts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns success on first valid attempt", async () => {
    const performAttempt = vi.fn(async (_index: number) =>
      makeAttempt({ status: 200, body: validBody, providerId: "p1" })
    );

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.finalBody).toBe(validBody);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].providerId).toBe("p1");
    expect(performAttempt).toHaveBeenCalledTimes(1);
  });

  test("never runs more than one upstream attempt at once (no race)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const performAttempt = vi.fn(async (index: number) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (index === 0) {
          return makeAttempt({ status: 200, body: emptyBody, providerId: "p1" });
        }
        return makeAttempt({ status: 200, body: validBody, providerId: "p2" });
      } finally {
        inFlight -= 1;
      }
    });

    const promise = orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].validation.ok).toBe(false);
    expect(result.attempts[1].validation.ok).toBe(true);
    expect(maxInFlight).toBe(1);
    expect(performAttempt).toHaveBeenCalledTimes(2);
  });

  test("retries on empty upstream until success or providers exhaust", async () => {
    const performAttempt = vi.fn(
      async (index: number): Promise<FakeStreamingAttemptOutcome | null> => {
        if (index === 0) return makeAttempt({ status: 200, body: emptyBody, providerId: "p1" });
        if (index === 1) return makeAttempt({ status: 200, body: "  ", providerId: "p2" });
        if (index === 2) return makeAttempt({ status: 200, body: validBody, providerId: "p3" });
        return null;
      }
    );

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    expect(result.ok).toBe(true);
    expect(result.attempts).toHaveLength(3);
    expect(result.finalBody).toBe(validBody);
  });

  test("returns failure when all providers fail", async () => {
    let calls = 0;
    const performAttempt = vi.fn(async (): Promise<FakeStreamingAttemptOutcome | null> => {
      calls += 1;
      if (calls > 3) return null;
      return makeAttempt({ status: 200, body: emptyBody, providerId: `p${calls}` });
    });

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("upstream_all_attempts_failed");
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.every((a) => !a.validation.ok)).toBe(true);
  });

  test("aborts current attempt and stops fallback on client disconnect", async () => {
    const abortController = new AbortController();
    const seenAborts: AbortSignal[] = [];

    const performAttempt = vi.fn(async (index: number, signal: AbortSignal) => {
      seenAborts.push(signal);
      if (index === 0) {
        return await new Promise<FakeStreamingAttemptOutcome>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }
      return makeAttempt({ status: 200, body: validBody, providerId: "p2" });
    });

    const promise = orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 5,
    });

    // Abort while first attempt is pending
    await Promise.resolve();
    abortController.abort();

    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("client_abort");
    expect(performAttempt).toHaveBeenCalledTimes(1);
    expect(seenAborts.length).toBe(1);
    expect(seenAborts[0].aborted).toBe(true);
  });

  test("maxAttempts caps the loop even if more providers are available", async () => {
    const performAttempt = vi.fn(async (index: number) =>
      makeAttempt({ status: 200, body: emptyBody, providerId: `p${index}` })
    );

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 2,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("upstream_all_attempts_failed");
    expect(result.attempts).toHaveLength(2);
    expect(performAttempt).toHaveBeenCalledTimes(2);
  });

  test("preserves attempt metadata across attempts", async () => {
    const performAttempt = vi.fn(async (index: number) => {
      if (index === 0) {
        return makeAttempt({ status: 502, body: "bad gateway", providerId: "p1" });
      }
      return makeAttempt({ status: 200, body: validBody, providerId: "p2" });
    });

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    expect(result.attempts[0].providerId).toBe("p1");
    expect(result.attempts[0].status).toBe(502);
    expect(result.attempts[0].validation.ok).toBe(false);
    expect(result.attempts[0].validation.code).toBe("non_2xx_status");

    expect(result.attempts[1].providerId).toBe("p2");
    expect(result.attempts[1].status).toBe(200);
    expect(result.attempts[1].validation.ok).toBe(true);
  });

  test("returns no_providers when first call returns null", async () => {
    const performAttempt = vi.fn(async () => null);

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: new AbortController().signal,
      maxAttempts: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("no_providers");
    expect(result.attempts).toHaveLength(0);
  });

  test("client abort signal flows into in-flight perform attempts", async () => {
    const abortController = new AbortController();
    let observedSignalDuringAttempt: AbortSignal | null = null;
    const performAttempt = vi.fn(async (_index: number, signal: AbortSignal) => {
      observedSignalDuringAttempt = signal;
      // While the attempt is in flight, parent abort should propagate.
      await Promise.resolve();
      abortController.abort();
      expect(signal.aborted).toBe(true);
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });

    const result = await orchestrateFakeStreamingAttempts({
      family: "anthropic",
      performAttempt,
      abortSignal: abortController.signal,
      maxAttempts: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("client_abort");
    expect(observedSignalDuringAttempt).not.toBeNull();
  });
});
