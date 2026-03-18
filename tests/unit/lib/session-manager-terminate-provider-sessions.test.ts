import { beforeEach, describe, expect, it, vi } from "vitest";

let redisClientRef: any;
let pipelineRef: any;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: () => redisClientRef,
}));

describe("SessionManager.terminateProviderSessionsBatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();

    pipelineRef = {
      zrange: vi.fn(() => pipelineRef),
      exec: vi.fn(async () => [
        [null, ["sess-a", "sess-b"]],
        [null, ["sess-b", "sess-c"]],
      ]),
    };

    redisClientRef = {
      status: "ready",
      pipeline: vi.fn(() => pipelineRef),
    };
  });

  it("should collect unique session ids from provider active-session zsets and terminate them in batch", async () => {
    const { SessionManager } = await import("@/lib/session-manager");
    const terminateSessionsBatchSpy = vi
      .spyOn(SessionManager, "terminateSessionsBatch")
      .mockResolvedValue(3);

    const result = await SessionManager.terminateProviderSessionsBatch([42, 43, 42, 0]);

    expect(result).toBe(3);
    expect(pipelineRef.zrange).toHaveBeenCalledTimes(2);
    expect(pipelineRef.zrange).toHaveBeenCalledWith("provider:42:active_sessions", 0, -1);
    expect(pipelineRef.zrange).toHaveBeenCalledWith("provider:43:active_sessions", 0, -1);
    expect(terminateSessionsBatchSpy).toHaveBeenCalledWith(["sess-a", "sess-b", "sess-c"]);
  });
});
