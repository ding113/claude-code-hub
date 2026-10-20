import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

type MockFixtureModule = {
  buildSseFrames: (targetBytes: number, mode?: "disconnect" | "complete") => string[];
  sseCompletedFrame: string;
  sseFrameOverheadBytes: number;
};

const require = createRequire(import.meta.url);
const { buildSseFrames, sseCompletedFrame, sseFrameOverheadBytes } =
  require("../../load/issue-1408-replay-oom/mock-upstream.cjs") as MockFixtureModule;

function assertValidExactSseBody(targetBytes: number): void {
  const frames = buildSseFrames(targetBytes);
  expect(Buffer.byteLength(frames.join(""), "utf8")).toBe(targetBytes);

  for (const frame of frames) {
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.slice(6, -2))).toEqual({
      type: "response.output_text.delta",
      delta: expect.any(String),
    });
  }
}

describe("issue #1408 mock upstream response sizing", () => {
  it("builds a valid SSE body at the exact 5 MiB response limit", () => {
    assertValidExactSseBody(5 * 1024 * 1024);
  });

  it("keeps the final frame valid around frame-size remainders", () => {
    assertValidExactSseBody(sseFrameOverheadBytes);
    assertValidExactSseBody(sseFrameOverheadBytes + 1);
    assertValidExactSseBody(64 * 1024 + sseFrameOverheadBytes + 1);
  });

  it("rejects targets too small to contain one complete SSE frame", () => {
    expect(() => buildSseFrames(sseFrameOverheadBytes - 1)).toThrow(
      /targetBytes must be an integer/
    );
  });

  it("builds an exact-size terminal SSE body for complete-response acceptance", () => {
    const targetBytes = 5 * 1024 * 1024;
    const frames = buildSseFrames(targetBytes, "complete");

    expect(Buffer.byteLength(frames.join(""), "utf8")).toBe(targetBytes);
    expect(frames.at(-1)).toBe(sseCompletedFrame);
    expect(JSON.parse(frames.at(-1)?.split("data: ")[1].trim() ?? "{}")).toMatchObject({
      type: "response.completed",
      response: { status: "completed" },
    });
  });
});
