import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { inferPhase } from "@/lib/redis/live-chain-store";
import type { RoutingTraceV1 } from "@/types/routing-trace";

describe("live Discovery chain phase", () => {
  it("uses the request_finished outcome over an earlier summary outcome", () => {
    const trace = {
      version: 1,
      mode: "discovery",
      startedAt: 1_000,
      updatedAt: 1_200,
      discoveryEnabled: true,
      eligible: true,
      summary: {
        outcome: "success",
        statusCode: 200,
      },
      events: [
        {
          type: "winner_committed",
          at: 1_050,
          elapsedMs: 50,
          round: 1,
          attemptId: "attempt-1",
          attemptKind: "normal",
          provider: { id: 1 },
          outcome: "winner",
          statusCode: 200,
        },
        {
          type: "request_finished",
          at: 1_200,
          elapsedMs: 200,
          outcome: "failed",
          statusCode: 502,
        },
      ],
    } as RoutingTraceV1;

    expect(inferPhase([], trace)).toBe("failed");
  });
});
