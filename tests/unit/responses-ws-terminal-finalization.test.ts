import { describe, expect, it } from "vitest";
import {
  createResponsesWsTerminalCollector,
  normalizeResponsesWsTerminalEvent,
} from "@/app/v1/_lib/proxy/responses-ws-terminal-finalization";

describe("responses websocket terminal finalization", () => {
  it("bounds memory under delta burst", () => {
    const collector = createResponsesWsTerminalCollector({
      maxHeadEvents: 4,
      maxTailEvents: 4,
    });

    for (let index = 0; index < 100; index += 1) {
      collector.push({
        type: "response.output_text.delta",
        delta: `chunk-${index}`,
      });
    }
    collector.push({
      type: "response.completed",
      response: {
        id: "resp_1",
        object: "response",
        status: "completed",
        usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
      },
    });

    const snapshot = collector.getSnapshot();
    expect(snapshot.eventCount).toBe(101);
    expect(snapshot.headEvents).toHaveLength(4);
    expect(snapshot.tailEvents).toHaveLength(4);
    expect(snapshot.terminalEvent?.type).toBe("response.completed");
    expect(collector.getNormalizedTerminalEvent()).toMatchObject({
      terminalState: "completed",
    });
  });

  it("settles response.failed without fake success", () => {
    const normalized = normalizeResponsesWsTerminalEvent({
      type: "response.failed",
      response: {
        id: "resp_2",
        object: "response",
        status: "failed",
        error: { code: "invalid_api_key" },
      },
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        terminalState: "failed",
      })
    );
    expect(normalized?.payload).toMatchObject({
      response: expect.objectContaining({ status: "failed" }),
    });
  });

  it("settles response.incomplete to deterministic terminal state", () => {
    const normalized = normalizeResponsesWsTerminalEvent({
      type: "response.incomplete",
      response: {
        id: "resp_3",
        object: "response",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      },
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        terminalState: "incomplete",
      })
    );
    expect(normalized?.payload).toMatchObject({
      response: expect.objectContaining({ status: "incomplete" }),
    });
  });

  it("normalizes error event to failed terminal state", () => {
    const normalized = normalizeResponsesWsTerminalEvent({
      type: "error",
      error: {
        type: "previous_response_not_found",
        code: "previous_response_not_found",
        message: "No response found with id 'resp_nonexistent'.",
      },
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        terminalState: "failed",
      })
    );
    expect(normalized?.payload).toMatchObject({
      error: expect.objectContaining({ code: "previous_response_not_found" }),
    });
  });
});
