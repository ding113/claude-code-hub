import { describe, expect, it } from "vitest";
import { inferUpstreamErrorStatusCodeFromText } from "@/lib/utils/upstream-error-detection";

const httpStatusCases = [
  { statusCode: 429, matcherId: "rate_limit" },
  { statusCode: 402, matcherId: "payment_required" },
  { statusCode: 401, matcherId: "unauthorized" },
  { statusCode: 403, matcherId: "forbidden" },
  { statusCode: 404, matcherId: "not_found" },
  { statusCode: 413, matcherId: "payload_too_large" },
  { statusCode: 415, matcherId: "unsupported_media_type" },
  { statusCode: 409, matcherId: "conflict" },
  { statusCode: 422, matcherId: "unprocessable_entity" },
  { statusCode: 408, matcherId: "request_timeout" },
  { statusCode: 451, matcherId: "legal_restriction" },
  { statusCode: 503, matcherId: "service_unavailable" },
  { statusCode: 504, matcherId: "gateway_timeout" },
  { statusCode: 500, matcherId: "internal_server_error" },
  { statusCode: 400, matcherId: "bad_request" },
] as const;

const cloudflareErrorCases = [
  { code: 1015, statusCode: 429, matcherId: "rate_limit" },
  { code: 1020, statusCode: 403, matcherId: "forbidden" },
  { code: 521, statusCode: 503, matcherId: "service_unavailable" },
  { code: 522, statusCode: 504, matcherId: "gateway_timeout" },
  { code: 524, statusCode: 504, matcherId: "gateway_timeout" },
] as const;

describe("inferUpstreamErrorStatusCodeFromText numeric boundaries", () => {
  it.each(httpStatusCases)("keeps matching a standalone HTTP $statusCode status token", ({
    statusCode,
    matcherId,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`HTTP/1.1 ${statusCode}`)).toEqual({
      statusCode,
      matcherId,
    });
  });

  it.each(
    httpStatusCases
  )("does not treat HTTP $statusCode followed by a decimal fraction as a status token", ({
    statusCode,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`HTTP/1.1 ${statusCode}.12`)).toBeNull();
  });

  it.each(
    httpStatusCases
  )("does not treat HTTP $statusCode embedded in a longer number as a status token", ({
    statusCode,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`HTTP/1.1 ${statusCode}12`)).toBeNull();
  });

  it.each(
    httpStatusCases
  )("does not treat HTTP $statusCode followed by a letter as a status token", ({ statusCode }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`HTTP/1.1 ${statusCode}abc`)).toBeNull();
  });

  it.each(httpStatusCases)("keeps matching HTTP $statusCode followed by sentence punctuation", ({
    statusCode,
    matcherId,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`HTTP/1.1 ${statusCode}.`)).toEqual({
      statusCode,
      matcherId,
    });
  });

  it.each(cloudflareErrorCases)("keeps matching a standalone Cloudflare Error $code token", ({
    code,
    statusCode,
    matcherId,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`Error ${code}`)).toEqual({
      statusCode,
      matcherId,
    });
  });

  it.each(
    cloudflareErrorCases
  )("does not treat Cloudflare Error $code followed by a decimal fraction as a code token", ({
    code,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`Error ${code}.7`)).toBeNull();
  });

  it.each(
    cloudflareErrorCases
  )("does not treat Cloudflare Error $code embedded in a longer number as a code token", ({
    code,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`Error ${code}7`)).toBeNull();
  });

  it.each(
    cloudflareErrorCases
  )("does not treat Cloudflare Error $code followed by a letter as a code token", ({ code }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`Error ${code}x`)).toBeNull();
  });

  it.each(
    cloudflareErrorCases
  )("keeps matching Cloudflare Error $code followed by sentence punctuation", ({
    code,
    statusCode,
    matcherId,
  }) => {
    expect(inferUpstreamErrorStatusCodeFromText(`Error ${code}.`)).toEqual({
      statusCode,
      matcherId,
    });
  });

  it("does not infer service_unavailable from an AWS request id containing 503", () => {
    const text = "request id: 202604250550399959";

    expect(inferUpstreamErrorStatusCodeFromText(text)).toBeNull();
  });

  it("does not infer any status from a decimal price sample", () => {
    const text = "需要预扣费额度：¥0.352942";

    expect(inferUpstreamErrorStatusCodeFromText(text)).toBeNull();
  });
});
