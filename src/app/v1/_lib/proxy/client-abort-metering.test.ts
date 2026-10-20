import { describe, expect, it } from "vitest";
import {
  CLIENT_ABORT_METER_MAX_RETAINED_BYTES,
  createClientAbortMeteringObserver,
} from "./client-abort-metering";

const encoder = new TextEncoder();

describe("createClientAbortMeteringObserver", () => {
  it("keeps only compact Responses accounting evidence", () => {
    const observer = createClientAbortMeteringObserver("response");
    observer.observe(
      encoder.encode(
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "x".repeat(32 * 1024),
        })}\n\n`
      )
    );
    const result = observer.observe(
      encoder.encode(
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_1",
            model: "gpt-test",
            output: [{ content: [{ text: "discard me" }] }],
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        })}\n\n`
      )
    );

    const snapshot = observer.finish();
    expect(result.terminalSeen).toBe(true);
    expect(snapshot.text).toContain("response.completed");
    expect(snapshot.text).toContain('"input_tokens":10');
    expect(snapshot.text).not.toContain("discard me");
    expect(snapshot.retainedBytes).toBeLessThanOrEqual(CLIENT_ABORT_METER_MAX_RETAINED_BYTES);
  });

  it("retains Claude initial and terminal usage until message_stop", () => {
    const observer = createClientAbortMeteringObserver("claude");
    observer.observe(
      encoder.encode(
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { model: "claude-test", usage: { input_tokens: 20, output_tokens: 1 } },
        })}\n\n`
      )
    );
    expect(
      observer.observe(
        encoder.encode(
          `event: message_delta\ndata: ${JSON.stringify({
            type: "message_delta",
            usage: { output_tokens: 7 },
          })}\n\n`
        )
      ).terminalSeen
    ).toBe(false);
    expect(
      observer.observe(encoder.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`))
        .terminalSeen
    ).toBe(true);

    const snapshot = observer.finish();
    expect(snapshot.text).toContain("message_start");
    expect(snapshot.text).toContain("message_delta");
    expect(snapshot.text).toContain("message_stop");
  });

  it("skips an oversized content frame and resumes at the next frame boundary", () => {
    const observer = createClientAbortMeteringObserver("response");
    const result = observer.observe(
      encoder.encode(
        `event: response.output_text.delta\ndata: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "x".repeat(70 * 1024),
        })}\n\nevent: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: { usage: { input_tokens: 10, output_tokens: 5 } },
        })}\n\n`
      )
    );

    const snapshot = observer.finish();
    expect(result.terminalSeen).toBe(true);
    expect(snapshot.skippedOversizedFrames).toBe(1);
    expect(snapshot.text).toContain("response.completed");
  });

  it("stops metering at an OpenAI done marker without requiring usage", () => {
    const observer = createClientAbortMeteringObserver("openai");
    expect(observer.observe(encoder.encode("data: [DONE]\n\n")).terminalSeen).toBe(true);
    expect(observer.finish().terminalSeen).toBe(true);
  });

  it("treats a valid Responses terminal without usage as complete", () => {
    const observer = createClientAbortMeteringObserver("response");
    const result = observer.observe(
      encoder.encode(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n'
      )
    );

    expect(result).toEqual({
      drainComplete: true,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: true,
      terminalSeen: true,
    });
    expect(observer.finish().terminalSeen).toBe(true);
  });

  it("does not treat standard nullable Responses error fields as protocol failures", () => {
    const observer = createClientAbortMeteringObserver("response");
    const result = observer.observe(
      encoder.encode(
        'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","error":null,"usage":{"input_tokens":4,"output_tokens":2}}}\n\n'
      )
    );

    expect(result).toEqual({
      drainComplete: true,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: true,
      terminalSeen: true,
    });
    expect(observer.finish().protocolFailure).toBeNull();
  });

  it("retains zero-valued usage without making it a completion requirement", () => {
    const observer = createClientAbortMeteringObserver("response");
    observer.observe(
      encoder.encode(
        'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n'
      )
    );

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(true);
    expect(snapshot.text).toContain('"input_tokens":0');
    expect(snapshot.text).toContain('"output_tokens":0');
  });

  it("does not treat initial Claude usage as a completed stream", () => {
    const observer = createClientAbortMeteringObserver("claude");
    observer.observe(
      encoder.encode(
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n'
      )
    );

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(false);
    expect(snapshot.text).toContain('"input_tokens":12');
  });

  it("combines an OpenAI usage chunk with a later done marker across arbitrary splits", () => {
    const observer = createClientAbortMeteringObserver("openai");
    const text = `data: ${JSON.stringify({
      id: "chatcmpl_1",
      choices: [],
      usage: { prompt_tokens: 12, completion_tokens: 4 },
    })}\r\n\r\ndata: [DONE]\r\n\r\n`;
    const bytes = encoder.encode(text);
    for (let offset = 0; offset < bytes.length; offset += 7) {
      observer.observe(bytes.subarray(offset, offset + 7));
    }

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(true);
    expect(snapshot.text).toContain('"prompt_tokens":12');
    expect(snapshot.text).toContain("[DONE]");
  });

  it("waits for OpenAI usage after finish_reason before ending the drain", () => {
    const observer = createClientAbortMeteringObserver("openai");

    expect(
      observer.observe(
        encoder.encode('data: {"choices":[{"finish_reason":"stop"}],"usage":null}\n\n')
      )
    ).toEqual({
      drainComplete: false,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: false,
      terminalSeen: true,
    });
    expect(
      observer.observe(
        encoder.encode(
          'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\n'
        )
      )
    ).toEqual({
      drainComplete: true,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: false,
      terminalSeen: true,
    });

    expect(observer.finish().text).toContain('"completion_tokens":4');
  });

  it("uses the last Gemini NDJSON usage and finishReason as terminal evidence", () => {
    const observer = createClientAbortMeteringObserver("gemini");
    observer.observe(
      encoder.encode(
        `${JSON.stringify({
          candidates: [{ content: { parts: [{ text: "discard" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
        })}\n`
      )
    );
    const result = observer.observe(
      encoder.encode(
        `${JSON.stringify({
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 8 },
        })}\n`
      )
    );

    const snapshot = observer.finish();
    expect(result.terminalSeen).toBe(true);
    expect(snapshot.text).toContain('"candidatesTokenCount":8');
    expect(snapshot.text).not.toContain("discard");
  });

  it("retains compact protocol errors without retaining content", () => {
    const observer = createClientAbortMeteringObserver("response");
    observer.observe(
      encoder.encode(
        `event: error\ndata: ${JSON.stringify({
          type: "response.error",
          error: { code: "upstream_failed", message: "failure" },
          debug: "x".repeat(32 * 1024),
        })}\n\n`
      )
    );

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(false);
    expect(snapshot.text).toContain("upstream_failed");
    expect(snapshot.text).not.toContain('"debug"');
  });

  it("compacts extended usage, metadata, cache, and signature evidence", () => {
    const observer = createClientAbortMeteringObserver("response");
    observer.observe(
      encoder.encode(
        `event: response.in_progress\ndata: ${JSON.stringify({
          id: "resp_extended",
          model: "gpt-extended",
          prompt_cache_key: "cache-key",
          service_tier: "priority",
          status: "in_progress",
          type: "response.in_progress",
          message: {
            id: "message-1",
            model: "gpt-message",
            usage: { input_tokens: 1 },
          },
          delta: {
            type: "signature_delta",
            stop_reason: "end_turn",
            signature: "signed-model",
            usage: { output_tokens: 2 },
          },
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            cache_creation_input_tokens: 2,
            cache_creation_5m_input_tokens: 1,
            cache_creation_1h_input_tokens: 1,
            cache_read_input_tokens: 4,
            input_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
            prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 },
            cache_creation: {
              ephemeral_5m_input_tokens: 1,
              ephemeral_1h_input_tokens: 1,
            },
            candidatesTokensDetails: [
              null,
              {},
              { modality: "TEXT", tokenCount: 2 },
              { tokenCount: 1 },
            ],
            promptTokensDetails: [{ modality: "IMAGE", tokenCount: 3 }],
          },
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
          choices: [null, {}, { finish_reason: "stop" }],
          candidates: [null, {}, { finishReason: "STOP" }],
          ignored: "not retained",
        })}\n\n`
      )
    );
    observer.observe(
      encoder.encode(
        `event: response.completed\ndata: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_extended",
            model: "gpt-extended",
            service_tier: "priority",
            usage: { input_tokens: 10, output_tokens: 3 },
          },
        })}\n\n`
      )
    );

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(true);
    expect(snapshot.text).toContain('"prompt_cache_key":"cache-key"');
    expect(snapshot.text).toContain('"signature":"signed-model"');
    expect(snapshot.text).toContain('"cache_write_tokens":2');
    expect(snapshot.text).toContain('"modality":"IMAGE"');
    expect(snapshot.text).not.toContain("not retained");
  });

  it("handles comments, multi-line data, bare JSON tails, and malformed frames", () => {
    const observer = createClientAbortMeteringObserver("gemini-cli");
    observer.observe(new Uint8Array());
    observer.observe(
      encoder.encode(
        ': keepalive\rretry: 1000\revent: message\rdata: {"usageMetadata":\rdata: {"promptTokenCount":10,"candidatesTokenCount":2}}\r\r'
      )
    );
    observer.observe(encoder.encode("data: true\n\n"));
    observer.observe(encoder.encode("data: not-json\n\n"));
    observer.observe(encoder.encode("data: still-not-json\n\n"));
    observer.observe(
      encoder.encode(
        JSON.stringify({
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        })
      )
    );

    const snapshot = observer.finish();
    expect(snapshot.terminalSeen).toBe(true);
    expect(snapshot.protocolFailure).toEqual({
      afterContent: false,
      verdict: "malformed",
      eventName: null,
    });
  });

  it("recovers after an oversized bare JSON line and ignores post-finish input", () => {
    const observer = createClientAbortMeteringObserver("gemini");
    observer.observe(encoder.encode(`{"ignored":"${"x".repeat(70 * 1024)}"}\n`));
    observer.observe(
      encoder.encode(
        `${JSON.stringify({
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
        })}`
      )
    );
    const first = observer.finish();
    observer.observe(encoder.encode('{"error":true}\n'));
    const second = observer.finish();

    expect(first.terminalSeen).toBe(true);
    expect(first.skippedOversizedFrames).toBe(1);
    expect(second).toEqual(first);
  });

  it("does not fabricate completion from an oversized unvalidated terminal frame", () => {
    const observer = createClientAbortMeteringObserver("response");
    const partial = observer.observe(
      encoder.encode(
        'event: response.completed\ndata: {"type":"response.completed","padding":"' +
          "x".repeat(70 * 1024)
      )
    );

    expect(partial).toEqual({
      drainComplete: false,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: false,
      terminalSeen: false,
    });
    const completed = observer.observe(encoder.encode('"}\n\n'));
    expect(completed).toEqual({
      drainComplete: false,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: false,
      terminalSeen: false,
    });
    const snapshot = observer.finish();
    expect(snapshot.skippedOversizedFrames).toBe(1);
    expect(snapshot.text).not.toContain("response.completed");
  });

  it("recovers at the next NDJSON line after tightening an in-flight frame", () => {
    const observer = createClientAbortMeteringObserver("gemini", {
      attachedMaxFrameBytes: 128 * 1024,
    });
    observer.observe(
      encoder.encode(`{"candidates":[{"content":{"parts":[{"text":"${"x".repeat(70 * 1024)}`)
    );

    observer.switchToDetachedMode();
    const result = observer.observe(
      encoder.encode(
        '"}]}}]}\n{"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":3}}\n'
      )
    );

    expect(result.drainComplete).toBe(true);
    expect(observer.finish().text).toContain('"candidatesTokenCount":3');
  });

  it.each([
    'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n',
    'data: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n',
  ])("stops at Responses incomplete without treating it as successful completion", (frame) => {
    const observer = createClientAbortMeteringObserver("response");

    expect(observer.observe(encoder.encode(frame))).toEqual({
      drainComplete: true,
      errorSeen: false,
      protocolFailure: null,
      replayDrainComplete: true,
      terminalSeen: false,
    });
    expect(observer.finish()).toMatchObject({ incompleteSeen: true, protocolFailure: null });
  });

  it("records protocol failure after content independently from completion", () => {
    const observer = createClientAbortMeteringObserver("response");
    observer.observe(
      encoder.encode(
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"ok"}\n\n'
      )
    );
    const result = observer.observe(
      encoder.encode(
        'event: response.failed\ndata: {"type":"response.failed","response":{"status":"failed"}}\n\n'
      )
    );

    expect(result).toEqual({
      drainComplete: true,
      errorSeen: true,
      protocolFailure: {
        afterContent: true,
        eventName: "response.failed",
        verdict: "error",
      },
      replayDrainComplete: true,
      terminalSeen: false,
    });
    expect(observer.finish().protocolFailure).toEqual({
      afterContent: true,
      verdict: "error",
      eventName: "response.failed",
    });
  });
});
