import { afterEach, describe, expect, test, vi } from "vitest";
import type { SensitiveWord } from "@/repository/sensitive-words";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    getActiveSensitiveWords: vi.fn(),
    onRedisInvalidation: null as ((message: string) => void) | null,
    eventEmitter: {
      on(event: string, handler: (...args: unknown[]) => void) {
        const current = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
        current.add(handler);
        listeners.set(event, current);
      },
      off(event: string, handler: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(handler);
      },
      removeAllListeners() {
        listeners.clear();
      },
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  };
});

vi.mock("@/repository/sensitive-words", () => ({
  getActiveSensitiveWords: mocks.getActiveSensitiveWords,
}));

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: mocks.eventEmitter,
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_SENSITIVE_WORDS_UPDATED: "sensitiveWordsUpdated",
  subscribeCacheInvalidation: vi.fn(
    async (_channel: string, callback: (message: string) => void) => {
      mocks.onRedisInvalidation = callback;
      return () => {};
    }
  ),
}));

vi.mock("@/lib/logger", () => ({ logger: mocks.logger }));

function buildWord(id: number, word: string): SensitiveWord {
  return {
    id,
    word,
    matchType: "contains",
    description: null,
    isEnabled: true,
    createdAt: new Date("2026-08-29T00:00:00.000Z"),
    updatedAt: new Date("2026-08-29T00:00:00.000Z"),
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.eventEmitter.removeAllListeners();
  mocks.onRedisInvalidation = null;
  delete (globalThis as Record<string, unknown>).__CCH_SENSITIVE_WORD_DETECTOR__;
});

describe("SensitiveWordCache reload queue", () => {
  test("pub/sub resync 到达加载期间时应补跑并保留最新规则", async () => {
    let resolveFirstLoad: ((value: SensitiveWord[]) => void) | undefined;
    mocks.getActiveSensitiveWords
      .mockImplementationOnce(
        () =>
          new Promise<SensitiveWord[]>((resolve) => {
            resolveFirstLoad = resolve;
          })
      )
      .mockResolvedValueOnce([buildWord(2, "new-rule")]);

    const { sensitiveWordDetector } = await import("@/lib/sensitive-word-detector");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstReload = sensitiveWordDetector.reload();
    await Promise.resolve();
    expect(mocks.onRedisInvalidation).not.toBeNull();
    mocks.onRedisInvalidation!("cch:cache:resync");

    resolveFirstLoad?.([buildWord(1, "old-rule")]);
    await firstReload;

    expect(mocks.getActiveSensitiveWords).toHaveBeenCalledTimes(2);
    expect(sensitiveWordDetector.detect("contains new-rule here").matched).toBe(true);
    expect(sensitiveWordDetector.detect("contains old-rule here").matched).toBe(false);
    sensitiveWordDetector.destroy();
  });
});
