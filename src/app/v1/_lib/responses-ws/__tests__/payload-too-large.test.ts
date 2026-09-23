import { describe, expect, it } from "vitest";
import { getUpstreamPayloadTooLargeMessage } from "../payload-too-large";

describe("getUpstreamPayloadTooLargeMessage", () => {
  it.each(["status", "status_code"])("recognizes 413 in %s without a size message", (field) => {
    expect(getUpstreamPayloadTooLargeMessage(JSON.stringify({ type: "error", [field]: 413 }))).toBe(
      ""
    );
  });

  it.each([400, 413, 422, 507])("preserves the upstream size message for status %i", (status) => {
    expect(
      getUpstreamPayloadTooLargeMessage(
        JSON.stringify({
          type: "error",
          status,
          error: { message: "Request body too large: 40 MiB" },
        })
      )
    ).toBe("Request body too large: 40 MiB");
  });

  it.each([
    "payload too large",
    "payload exceeds",
    "payload size",
    "request too large",
    "request body too large",
    "body too large",
    "content too large",
    "context length",
    "context too large",
    "maximum bytes",
    "max bytes",
    "image exceeds",
    "too many bytes",
    "too large",
  ])("recognizes the size signal %s case-insensitively", (signal) => {
    expect(
      getUpstreamPayloadTooLargeMessage(
        JSON.stringify({
          type: "error",
          status: 400,
          error: { message: signal.toUpperCase() },
        })
      )
    ).toBe(signal.toUpperCase());
  });

  it.each(["code", "type"])("recognizes size signals in error.%s", (field) => {
    expect(
      getUpstreamPayloadTooLargeMessage(
        JSON.stringify({
          type: "error",
          status: 422,
          error: { [field]: "payload too large" },
        })
      )
    ).toBe("");
  });

  it.each([400, 422, 507])("recognizes machine size codes for status %i", (status) => {
    for (const field of ["code", "type"]) {
      for (const signal of [
        "request_payload_too_large",
        "context_length_exceeded",
        "payload-too-large",
      ]) {
        expect(
          getUpstreamPayloadTooLargeMessage(
            JSON.stringify({ type: "error", status, error: { [field]: signal } })
          )
        ).toBe("");
      }
    }
  });

  it.each([400, 413, 422, 507])("preserves top-level size messages for status %i", (status) => {
    expect(
      getUpstreamPayloadTooLargeMessage(
        JSON.stringify({ type: "error", status, message: "Request body too large: 40 MiB" })
      )
    ).toBe("Request body too large: 40 MiB");
  });

  it.each([400, 422, 507])("recognizes top-level size codes for status %i", (status) => {
    expect(
      getUpstreamPayloadTooLargeMessage(
        JSON.stringify({ type: "error", status, code: "context_length_exceeded" })
      )
    ).toBe("");
  });

  it.each([
    { code: "context_length_exceeded", error: { message: "Request rejected" } },
    { message: "Payload too large", error: { message: "Request rejected" } },
  ])("checks both error shapes and preserves the nested message: %j", (fields) => {
    expect(
      getUpstreamPayloadTooLargeMessage(JSON.stringify({ type: "error", status: 400, ...fields }))
    ).toBe("Request rejected");
  });

  it.each([
    "not json",
    "null",
    "true",
    "1",
    '"error"',
    "[]",
    '{"type":"response.failed","status":413}',
    '{"type":"error","status":"413"}',
    '{"type":"error","status":1e999}',
    '{"type":"error","error":{"message":"payload too large"}}',
    '{"type":"error","status":500,"error":{"message":"payload too large"}}',
    '{"type":"error","status":401,"error":{"message":"payload too large"}}',
    '{"type":"error","status":400,"error":{"message":"invalid model"}}',
    '{"type":"error","status":400,"error":{"code":"model_not_found"}}',
    '{"type":"error","status":422,"error":{"type":"rate-limit-exceeded"}}',
    '{"type":"error","status":400,"code":"model_not_found","message":"Unknown model"}',
    '{"type":"error","status":422,"code":413,"message":{}}',
    '{"type":"error","status":422,"error":null}',
    '{"type":"error","status":507,"error":"too large"}',
    '{"type":"error","status":400,"error":{"code":413,"type":true,"message":{}}}',
  ])("does not retry an unrelated or malformed event: %s", (payload) => {
    expect(getUpstreamPayloadTooLargeMessage(payload)).toBeNull();
  });

  it("uses a finite status_code when status is not a finite number", () => {
    expect(
      getUpstreamPayloadTooLargeMessage('{"type":"error","status":1e999,"status_code":413}')
    ).not.toBeNull();
  });

  it("does not override a valid non-size status with status_code", () => {
    expect(
      getUpstreamPayloadTooLargeMessage('{"type":"error","status":401,"status_code":413}')
    ).toBeNull();
  });
});
