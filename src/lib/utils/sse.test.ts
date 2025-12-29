import { describe, expect, test } from "vitest";
import { isSSEText, parseSSEData, parseSSEDataForDisplay } from "./sse";

describe("sse utils", () => {
  test("isSSEText detects standard SSE by line prefixes", () => {
    expect(
      isSSEText(
        [
          "event: content_block_delta",
          'data: {"type":"content_block_delta"}',
          "",
          "data: [DONE]",
        ].join("\n")
      )
    ).toBe(true);
    expect(isSSEText('{"data":123}')).toBe(false);
    expect(isSSEText("not sse\ndata: nope")).toBe(false);
    expect(isSSEText("")).toBe(false);
    expect(isSSEText([": keep-alive", "data: 1"].join("\n"))).toBe(true);
  });

  test("parseSSEDataForDisplay parses and drops [DONE]", () => {
    const events = parseSSEDataForDisplay(
      [
        "event: message",
        'data: {"a":1}',
        "",
        "event: message",
        "data: hello",
        "",
        "data: [DONE]",
      ].join("\n")
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ event: "message", data: { a: 1 } });
    expect(events[1]).toEqual({ event: "message", data: "hello" });
  });

  test("parseSSEData strips the leading single space after data:", () => {
    const events = parseSSEData(["event: e", "data: 1", ""].join("\n"));
    expect(events).toEqual([{ event: "e", data: 1 }]);
  });

  test("parseSSEData keeps data value when there is no space after data:", () => {
    const events = parseSSEData(["event: e", "data:1", ""].join("\n"));
    expect(events).toEqual([{ event: "e", data: 1 }]);
  });

  test("parseSSEData ignores unsupported SSE fields (e.g. id:)", () => {
    const events = parseSSEData(["id: 1", "data: 1", ""].join("\n"));
    expect(events).toEqual([{ event: "message", data: 1 }]);
  });

  test("parseSSEDataForDisplay supports data-only events and multi-line JSON", () => {
    const events = parseSSEDataForDisplay(["data: {", 'data: "k": 1', "data: }", ""].join("\n"));
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("message");
    expect(events[0]?.data).toEqual({ k: 1 });
  });

  test("parseSSEDataForDisplay ignores comments and flushes on blank line", () => {
    const events = parseSSEDataForDisplay(
      [": keep-alive", "event: e", "data: 1", "", ""].join("\n")
    );
    expect(events).toEqual([{ event: "e", data: 1 }]);
  });
});
