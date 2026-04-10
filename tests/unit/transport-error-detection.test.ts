/**
 * Transport Error Detection Tests
 *
 * Validates that isTransportError correctly classifies errors from:
 * - Agent pool destruction (UND_ERR_DESTROYED)
 * - HTTP/2 stream errors (ERR_HTTP2_STREAM_ERROR, NGHTTP2_INTERNAL_ERROR)
 * - Existing transport errors (ECONNRESET, etc.)
 */
import { describe, expect, it } from "vitest";
import { isTransportError, isHttp2Error } from "@/app/v1/_lib/proxy/errors";

describe("isTransportError", () => {
  describe("existing transport errors (regression)", () => {
    it("should detect ECONNRESET", () => {
      const err = new Error("read ECONNRESET");
      (err as NodeJS.ErrnoException).code = "ECONNRESET";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect UND_ERR_SOCKET", () => {
      const err = new Error("Socket error");
      (err as NodeJS.ErrnoException).code = "UND_ERR_SOCKET";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect SocketError by name", () => {
      const err = new Error("Socket closed");
      err.name = "SocketError";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect 'other side closed' message", () => {
      const err = new Error("other side closed");
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect 'fetch failed' message", () => {
      const err = new Error("fetch failed");
      expect(isTransportError(err)).toBe(true);
    });

    it("should not detect generic errors", () => {
      const err = new Error("Something went wrong");
      expect(isTransportError(err)).toBe(false);
    });
  });

  describe("agent destruction errors", () => {
    it("should detect UND_ERR_DESTROYED by code", () => {
      const err = new Error("The client is destroyed");
      (err as NodeJS.ErrnoException).code = "UND_ERR_DESTROYED";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect ClientDestroyedError by name", () => {
      const err = new Error("The client is destroyed");
      err.name = "ClientDestroyedError";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect UND_ERR_CLOSED by code", () => {
      const err = new Error("The client is closed");
      (err as NodeJS.ErrnoException).code = "UND_ERR_CLOSED";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect ClientClosedError by name", () => {
      const err = new Error("The client is closed");
      err.name = "ClientClosedError";
      expect(isTransportError(err)).toBe(true);
    });
  });

  describe("HTTP/2 stream errors", () => {
    it("should detect ERR_HTTP2_STREAM_ERROR via code", () => {
      const err = new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR");
      (err as NodeJS.ErrnoException).code = "ERR_HTTP2_STREAM_ERROR";
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect NGHTTP2_INTERNAL_ERROR in message", () => {
      const err = new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR");
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect GOAWAY errors", () => {
      const err = new Error("GOAWAY session");
      expect(isTransportError(err)).toBe(true);
    });

    it("should detect RST_STREAM errors", () => {
      const err = new Error("RST_STREAM received");
      expect(isTransportError(err)).toBe(true);
    });
  });

  describe("error code on cause", () => {
    it("should detect UND_ERR_DESTROYED on cause", () => {
      const cause = new Error("destroyed");
      (cause as NodeJS.ErrnoException).code = "UND_ERR_DESTROYED";
      const err = new Error("fetch failed");
      (err as Error & { cause: Error }).cause = cause;
      expect(isTransportError(err)).toBe(true);
    });
  });
});

describe("isHttp2Error", () => {
  it("should detect ERR_HTTP2_GOAWAY_SESSION", () => {
    const err = new Error("ERR_HTTP2_GOAWAY_SESSION");
    expect(isHttp2Error(err)).toBe(true);
  });

  it("should detect NGHTTP2_INTERNAL_ERROR in message", () => {
    const err = new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR");
    expect(isHttp2Error(err)).toBe(true);
  });

  it("should detect ERR_HTTP2_STREAM_ERROR by code", () => {
    const err = new Error("Stream error");
    (err as NodeJS.ErrnoException).code = "ERR_HTTP2_STREAM_ERROR";
    expect(isHttp2Error(err)).toBe(true);
  });

  it("should not detect non-HTTP/2 errors", () => {
    const err = new Error("Connection refused");
    expect(isHttp2Error(err)).toBe(false);
  });
});
