import { describe, expect, it } from "vitest";
import { detectFormatByEndpoint } from "@/app/v1/_lib/proxy/format-mapper";
import { isRawPassthroughEndpointPath } from "@/app/v1/_lib/proxy/endpoint-policy";
import {
  isStandardEndpointPath,
  isStrictStandardEndpointPath,
} from "@/app/v1/_lib/proxy/endpoint-paths";

describe("detectFormatByEndpoint - OpenAI embeddings", () => {
  it('returns "openai" for /v1/embeddings', () => {
    expect(detectFormatByEndpoint("/v1/embeddings")).toBe("openai");
  });

  it("classifies /v1/embeddings as a standard endpoint", () => {
    expect(isStandardEndpointPath("/v1/embeddings")).toBe(true);
  });

  it("classifies /v1/embeddings as a strict standard endpoint", () => {
    expect(isStrictStandardEndpointPath("/v1/embeddings")).toBe(true);
  });

  it("does not classify /v1/embeddings as raw passthrough", () => {
    expect(isRawPassthroughEndpointPath("/v1/embeddings")).toBe(false);
  });
});
