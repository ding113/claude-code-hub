import { describe, expect, test } from "vitest";
import { validateVideoGenerationV2TextRequest } from "@/app/v1/_lib/proxy/video-generation-v2";

const validRequest = {
  model: "MiniMax-H3",
  content: [{ type: "text", text: "A lighthouse above a stormy sea" }],
  resolution: "2K",
  duration: 5,
  ratio: "16:9",
};

function validate(body: Record<string, unknown>) {
  return validateVideoGenerationV2TextRequest({
    pathname: "/v2/video_generation",
    method: "POST",
    body,
  });
}

describe("video generation v2 text request", () => {
  test("accepts the supported text-to-video schema", () => {
    expect(validate(validRequest)).toEqual(expect.objectContaining({ ok: true }));
  });

  test.each([
    [{ ...validRequest, model: "unsupported" }, "model"],
    [{ ...validRequest, content: [] }, "exactly one text item"],
    [
      { ...validRequest, content: [{ type: "image_url", image_url: { url: "https://x" } }] },
      "content type",
    ],
    [{ ...validRequest, content: [{ type: "text", text: "" }] }, "non-empty text prompt"],
    [{ ...validRequest, resolution: "768P" }, "resolution"],
    [{ ...validRequest, duration: 3 }, "duration"],
    [{ ...validRequest, ratio: "adaptive" }, "non-adaptive ratio"],
    [{ ...validRequest, callback_url: "file:///tmp/result" }, "callback_url"],
  ])("rejects invalid schema input %#", (body, message) => {
    expect(validate(body)).toEqual({ ok: false, message: expect.stringContaining(message) });
  });

  test("does not validate non-create requests", () => {
    expect(
      validateVideoGenerationV2TextRequest({
        pathname: "/v2/query/video_generation/task_123",
        method: "GET",
        body: {},
      })
    ).toEqual(expect.objectContaining({ ok: true }));
  });
});
