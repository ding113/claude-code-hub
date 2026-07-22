import { EventEmitter } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);

type WebSocketLike = {
  readyState: number;
  send: (payload: string, callback?: (error?: Error) => void) => void;
  close: (code: number, reason: string) => void;
};

type ServerModule = {
  handleWebSocketConnection: (
    ws: WebSocketLike & EventEmitter,
    request: { headers: Record<string, string>; url: string }
  ) => Promise<void>;
  forwardToInternalHttp: (
    ws: WebSocketLike,
    request: { headers: Record<string, string>; url: string },
    body: Record<string, unknown>,
    sessionId: string,
    registerRequest?: (
      request: http.ClientRequest,
      response?: http.IncomingMessage | null,
      settleTurn?: () => boolean
    ) => boolean | undefined,
    close?: (code: number, reason: string) => void
  ) => Promise<void>;
};

const serverModule: ServerModule = requireFromHere("../../server.js");

function createClientRequest(writeResult: boolean, events: string[]): http.ClientRequest {
  const request: http.ClientRequest = Object.create(http.ClientRequest.prototype);
  EventEmitter.call(request);
  Object.assign(request, {
    destroyed: false,
    write: () => {
      events.push("write");
      return writeResult;
    },
    end: () => {
      events.push("end");
      return request;
    },
    destroy: () => {
      events.push("destroy");
      request.destroyed = true;
      return request;
    },
  });
  return request;
}

function createIncomingResponse(): http.IncomingMessage {
  const response = new http.IncomingMessage(new Socket());
  response.headers = { "content-type": "text/event-stream" };
  vi.spyOn(response, "pause");
  vi.spyOn(response, "resume");
  return response;
}

function requestInput() {
  return {
    ws: {
      readyState: 1,
      send: vi.fn((_payload: string, callback?: (error?: Error) => void) => callback?.()),
      close: vi.fn(),
    },
    request: { headers: { authorization: "Bearer test" }, url: "/v1/responses" },
    body: { model: "gpt-5.5", input: "hello" },
  };
}

function createWebSocket(send: WebSocketLike["send"]) {
  return Object.assign(new EventEmitter(), { readyState: 1, send, close: vi.fn() });
}

function forwardRequest(
  request: http.ClientRequest,
  close?: (code: number, reason: string) => void
) {
  vi.spyOn(http, "request").mockImplementation(() => request);
  const input = requestInput();
  return serverModule.forwardToInternalHttp(
    input.ws,
    input.request,
    input.body,
    "test-session",
    undefined,
    close
  );
}

async function startSseBridge(send: WebSocketLike["send"]) {
  const events: string[] = [];
  const request = createClientRequest(true, events);
  const response = createIncomingResponse();
  let respond: ((response: http.IncomingMessage) => void) | undefined;
  vi.spyOn(http, "request").mockImplementation((_options, callback) => {
    if (callback) respond = callback;
    return request;
  });
  const ws = createWebSocket(send);
  await serverModule.handleWebSocketConnection(ws, {
    headers: { host: "localhost" },
    url: "/v1/responses",
  });
  ws.emit(
    "message",
    Buffer.from('{"type":"response.create","model":"gpt-5.5","input":"hello"}'),
    false
  );
  await Promise.resolve();
  respond?.(response);
  return { events, request, response, ws };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("server response write backpressure", () => {
  it("waits for request drain before ending a backpressured payload", async () => {
    const events: string[] = [];
    const request = createClientRequest(false, events);
    const forwarding = forwardRequest(request);

    expect(events).toEqual(["write"]);
    request.emit("drain");
    expect(events).toEqual(["write", "end"]);
    request.emit("error", Object.assign(new Error("closed"), { code: "ECONNRESET" }));
    await forwarding;
  });

  it.each(["ECONNREFUSED", "ECONNRESET"])(
    "sends one fatal frame and waits for its acknowledgement on active request error %s",
    async (code) => {
      const events: string[] = [];
      const request = createClientRequest(false, events);
      vi.spyOn(http, "request").mockImplementation(() => request);
      const input = requestInput();
      const sent: string[] = [];
      let sendCallback: ((error?: Error) => void) | undefined;
      input.ws.send = (payload, callback) => {
        sent.push(payload);
        sendCallback = callback;
      };
      const close = vi.fn();

      const forwarding = serverModule.forwardToInternalHttp(
        input.ws,
        input.request,
        input.body,
        "request-error-session",
        undefined,
        close
      );
      let settled = false;
      void forwarding.then(() => {
        settled = true;
      });

      request.emit("error", Object.assign(new Error(code), { code }));
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]).error.code).toBe("internal_request_error");
      expect(settled).toBe(false);
      expect(close).not.toHaveBeenCalled();

      sendCallback?.();
      await forwarding;
      expect(close).toHaveBeenCalledWith(1011, "internal_request_error");

      expect(() => request.emit("error", new Error("late request error"))).not.toThrow();
      expect(sent).toHaveLength(1);
    }
  );

  it("force-settles an active turn without relying on request destroy events", async () => {
    const events: string[] = [];
    const request = createClientRequest(false, events);
    vi.spyOn(http, "request").mockImplementation(() => request);
    const input = requestInput();
    let settleTurn: (() => boolean) | undefined;

    const forwarding = serverModule.forwardToInternalHttp(
      input.ws,
      input.request,
      input.body,
      "force-settle-session",
      (_request, _response, settle) => {
        settleTurn = settle;
        return true;
      }
    );

    expect(settleTurn?.()).toBe(true);
    await forwarding;
    expect(events).toContain("destroy");
    expect(input.ws.send).not.toHaveBeenCalled();
    expect(() => request.emit("error", new Error("late request error"))).not.toThrow();
  });

  it("lets close win before drain without ending twice or stranding completion", async () => {
    const events: string[] = [];
    const request = createClientRequest(false, events);
    const forwarding = forwardRequest(request);

    request.emit("close");
    await forwarding;

    request.emit("drain");
    expect(events).toEqual(["write"]);
  });

  it("terminates a request body when drain never arrives", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const request = createClientRequest(false, events);
    const close = vi.fn();
    const forwarding = forwardRequest(request, close);
    await vi.advanceTimersByTimeAsync(60_000);
    await forwarding;

    expect(close.mock.calls).toEqual([[1011, "internal_request_drain_timeout"]]);
    request.emit("drain");
    request.emit("error", new Error("late error"));
    expect(events).toEqual(["write", "destroy"]);
  });

  it("serializes outbound sends and pauses SSE until callbacks release pressure", async () => {
    const events: string[] = [];
    const request = createClientRequest(true, events);
    const response = createIncomingResponse();
    let respond: ((response: http.IncomingMessage) => void) | undefined;
    vi.spyOn(http, "request").mockImplementation((_options, callback) => {
      if (callback) respond = callback;
      return request;
    });
    const callbacks: Array<(error?: Error) => void> = [];
    const sent: string[] = [];
    const input = requestInput();
    input.ws.send = (payload, callback) => {
      sent.push(payload);
      if (callback) callbacks.push(callback);
    };

    const forwarding = serverModule.forwardToInternalHttp(
      input.ws,
      input.request,
      input.body,
      "session-2"
    );
    respond?.(response);
    response.emit(
      "data",
      'data: {"type":"response.output_text.delta","delta":"a"}\n\n' +
        'data: {"type":"response.output_text.delta","delta":"b"}\n\n' +
        'data: {"type":"response.completed","response":{"id":"r1"}}\n\n'
    );

    expect(sent).toHaveLength(1);
    expect(response.pause).toHaveBeenCalled();
    callbacks.shift()?.();
    expect(sent).toHaveLength(2);
    callbacks.shift()?.();
    expect(sent).toHaveLength(3);
    callbacks.shift()?.();
    expect(response.resume).toHaveBeenCalled();

    response.emit("end");
    await forwarding;
    response.destroy();
  });

  it("invalidates late send callbacks and destroys both internal transports on close", async () => {
    const callbacks: Array<(error?: Error) => void> = [];
    const sent: string[] = [];
    const bridge = await startSseBridge((payload, callback) => {
      sent.push(payload);
      if (callback) callbacks.push(callback);
    });
    const destroyResponse = vi.spyOn(bridge.response, "destroy");
    bridge.response.emit(
      "data",
      'data: {"type":"response.output_text.delta","delta":"a"}\n\n' +
        'data: {"type":"response.completed","response":{"id":"r1"}}\n\n'
    );

    expect(sent).toHaveLength(1);
    bridge.ws.emit("close");
    expect(bridge.events).toContain("destroy");
    expect(destroyResponse).toHaveBeenCalledOnce();
    callbacks.shift()?.();
    expect(sent).toHaveLength(1);
  });

  it.each(["error", "timeout"] as const)("cleans up on send %s", async (failure) => {
    if (failure === "timeout") vi.useFakeTimers();
    let callback: ((error?: Error) => void) | undefined;
    const bridge = await startSseBridge((_payload, done) => {
      callback = done;
    });
    const destroyResponse = vi.spyOn(bridge.response, "destroy");
    bridge.response.emit("data", 'data: {"type":"response.output_text.delta","delta":"a"}\n\n');

    if (failure === "error") callback?.(new Error("send failed"));
    else await vi.advanceTimersByTimeAsync(60_000);

    expect(bridge.events).toContain("destroy");
    expect(destroyResponse).toHaveBeenCalledOnce();
    callback?.();
    expect(bridge.ws.close.mock.calls).toEqual([[1011, `outbound_send_${failure}`]]);
  });

  it("destroys upstream and closes once when outbound pending bytes overflow", async () => {
    const bridge = await startSseBridge(vi.fn());
    const destroyResponse = vi.spyOn(bridge.response, "destroy");
    const delta = "x".repeat(1024 * 1024 + 1);

    bridge.response.emit(
      "data",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`
    );

    expect(bridge.events).toContain("destroy");
    expect(destroyResponse).toHaveBeenCalledOnce();
    expect(bridge.ws.close.mock.calls).toEqual([[1011, "outbound_backpressure"]]);
  });

  it("sends a fatal terminal frame before initiating close", async () => {
    let callback: ((error?: Error) => void) | undefined;
    let payload = "";
    const bridge = await startSseBridge((sent, done) => {
      payload = sent;
      callback = done;
    });

    bridge.response.emit("end");

    expect(JSON.parse(payload).error.code).toBe("stream_ended_without_terminal");
    expect(bridge.ws.close).not.toHaveBeenCalled();
    callback?.();
    expect(bridge.ws.close.mock.calls).toEqual([[1011, "stream_ended_without_terminal"]]);
  });

  it("sends a protocol error frame before closing the client", async () => {
    const send = vi.fn<WebSocketLike["send"]>();
    const ws = createWebSocket(send);
    await serverModule.handleWebSocketConnection(ws, { headers: {}, url: "/v1/responses" });

    ws.emit("message", Buffer.from("binary"), true);

    const payload = send.mock.calls[0]?.[0] ?? "";
    const callback = send.mock.calls[0]?.[1];
    expect(JSON.parse(payload)).toMatchObject({ error: { code: "invalid_frame_type" } });
    expect(ws.close).not.toHaveBeenCalled();
    callback?.();
    expect(ws.close).toHaveBeenCalledWith(1003, "binary_not_supported");
  });

  it("aborts an active internal turn before a fatal protocol frame is acknowledged", async () => {
    const callbacks: Array<(error?: Error) => void> = [];
    const ws = createWebSocket((_payload, callback) => {
      if (callback) callbacks.push(callback);
    });
    const events: string[] = [];
    const request = createClientRequest(true, events);
    vi.spyOn(http, "request").mockImplementation(() => request);
    await serverModule.handleWebSocketConnection(ws, { headers: {}, url: "/v1/responses" });

    ws.emit(
      "message",
      Buffer.from('{"type":"response.create","model":"gpt-5.5","input":"hello"}'),
      false
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    ws.emit("message", Buffer.from("binary"), true);

    expect(request.destroyed).toBe(true);
    expect(ws.close).not.toHaveBeenCalled();
    callbacks.at(-1)?.();
    expect(ws.close).toHaveBeenCalledWith(1003, "binary_not_supported");
  });

  it("settles an SSE turn when terminal acknowledgement precedes a premature close", async () => {
    const events: string[] = [];
    const request = createClientRequest(true, events);
    const response = createIncomingResponse();
    response.complete = false;
    let respond: ((response: http.IncomingMessage) => void) | undefined;
    vi.spyOn(http, "request").mockImplementation((_options, callback) => {
      if (callback) respond = callback;
      return request;
    });
    const close = vi.fn();
    const input = requestInput();
    const forwarding = serverModule.forwardToInternalHttp(
      input.ws,
      input.request,
      input.body,
      "terminal-close-session",
      undefined,
      close
    );
    respond?.(response);
    response.emit(
      "data",
      `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1" } })}\n\n`
    );
    response.emit("close");

    await forwarding;
    expect(close).not.toHaveBeenCalled();
  });

  it("waits for the JSON terminal send acknowledgement across end and close", async () => {
    const events: string[] = [];
    const request = createClientRequest(true, events);
    const response = new http.IncomingMessage(new Socket());
    response.headers = { "content-type": "application/json" };
    let respond: ((response: http.IncomingMessage) => void) | undefined;
    vi.spyOn(http, "request").mockImplementation((_options, callback) => {
      if (callback) respond = callback;
      return request;
    });
    let sendCallback: ((error?: Error) => void) | undefined;
    const sent: string[] = [];
    const close = vi.fn();
    const input = requestInput();
    input.ws.send = (payload, callback) => {
      sent.push(payload);
      sendCallback = callback;
    };

    const forwarding = serverModule.forwardToInternalHttp(
      input.ws,
      input.request,
      input.body,
      "json-session",
      undefined,
      close
    );
    respond?.(response);
    response.emit("data", Buffer.from('{"id":"response-1"}'));
    response.emit("end");
    response.emit("close");

    let settled = false;
    void forwarding.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(sent.map((payload) => JSON.parse(payload).type)).toEqual(["response.completed"]);
    expect(close).not.toHaveBeenCalled();

    sendCallback?.();
    await forwarding;
    expect(close).not.toHaveBeenCalled();
  });

  it("does not start a request while a fatal protocol frame awaits acknowledgement", async () => {
    const callbacks: Array<(error?: Error) => void> = [];
    const ws = createWebSocket((_payload, callback) => {
      if (callback) callbacks.push(callback);
    });
    const requestSpy = vi
      .spyOn(http, "request")
      .mockImplementation(() => createClientRequest(true, []));
    await serverModule.handleWebSocketConnection(ws, { headers: {}, url: "/v1/responses" });

    ws.emit("message", Buffer.from("binary"), true);
    ws.emit(
      "message",
      Buffer.from('{"type":"response.create","model":"gpt-5.5","input":"hello"}'),
      false
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requestSpy).not.toHaveBeenCalled();
    callbacks.shift()?.();
    expect(ws.close).toHaveBeenCalledWith(1003, "binary_not_supported");
  });
});
