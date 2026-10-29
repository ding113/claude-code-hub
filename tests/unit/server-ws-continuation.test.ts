import { EventEmitter } from "node:events";
import http from "node:http";
import { createRequire } from "node:module";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireFromHere = createRequire(import.meta.url);
type ClientSocket = EventEmitter & {
  readyState: number;
  send: (payload: string, callback?: (error?: Error) => void) => void;
  close: (code: number, reason: string) => void;
};
type Binding = { generation: string; connectionLocal: boolean; active: boolean };
type Turn = {
  request: http.ClientRequest;
  response: http.IncomingMessage;
  headers: Record<string, string>;
  respond: () => void;
};
const serverModule = requireFromHere("../../server.js") as {
  handleWebSocketConnection: (
    ws: ClientSocket,
    request: { headers: Record<string, string>; url: string }
  ) => Promise<void>;
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const localHeaders = {
  "x-cch-upstream-connection-local": "1",
  "x-cch-upstream-transport": "websocket",
  "x-cch-responses-ws-generation": "generation-one",
};

async function startBridge(
  options: { delayedAck?: boolean; headers?: Record<string, string> } = {}
) {
  const turns: Turn[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const acknowledgements: Array<() => void> = [];
  const cleanup = vi.fn();
  vi.stubGlobal("__cchCleanupResponsesWsSession", cleanup);
  vi.spyOn(http, "request").mockImplementation((requestOptions, callback) => {
    const request: http.ClientRequest = Object.create(http.ClientRequest.prototype);
    EventEmitter.call(request);
    Object.assign(request, {
      destroyed: false,
      write: () => true,
      end: () => request,
      destroy: () => {
        request.destroyed = true;
        return request;
      },
    });
    const response = new http.IncomingMessage(new Socket());
    response.headers = { "content-type": "text/event-stream" };
    response.statusCode = 200;
    turns.push({
      request,
      response,
      headers: (requestOptions as http.RequestOptions).headers as Record<string, string>,
      respond: () => callback?.(response),
    });
    return request;
  });
  const ws: ClientSocket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (payload: string, callback?: (error?: Error) => void) => {
      messages.push(JSON.parse(payload));
      if (options.delayedAck) acknowledgements.push(() => callback?.());
      else callback?.();
    },
    close: vi.fn((_code: number, _reason: string) => {
      ws.readyState = 2;
    }),
  });
  await serverModule.handleWebSocketConnection(ws, {
    headers: { host: "localhost", ...options.headers },
    url: "/v1/responses",
  });
  const send = (body: Record<string, unknown> = {}) => {
    ws.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "response.create", model: "test", input: "hello", ...body })
      ),
      false
    );
  };
  const finish = async (
    turn: Turn,
    headers: Record<string, string> = {},
    event: Record<string, unknown> = { type: "response.completed", response: { id: "resp-one" } }
  ) => {
    Object.assign(turn.response.headers, headers);
    turn.respond();
    turn.response.emit("data", `data: ${JSON.stringify(event)}\n\n`);
    turn.response.emit("end");
    await tick();
  };
  return { turns, messages, acknowledgements, cleanup, ws, send, finish };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("server WebSocket continuation binding", () => {
  it("derives prior-local from the previous terminal, preserving it across store:true requests", async () => {
    vi.stubEnv("CCH_RESPONSES_WS_INTERNAL_SECRET", "test-process-secret");
    const bridge = await startBridge({
      headers: {
        "x-cch-responses-ws-prior-local": "1",
        "x-cch-responses-ws-generation": "forged-generation",
        "x-cch-upstream-connection-local": "1",
        "x-cch-upstream-transport": "websocket",
        "x-cch-internal-secret": "forged-secret",
        "x-cch-responses-ws-session": "forged-session",
      },
    });
    const getBinding = vi.fn(() => ({
      generation: "generation-one",
      connectionLocal: true,
      active: false,
    }));
    vi.stubGlobal("__cchGetResponsesWsSessionBinding", getBinding);

    bridge.send({ previous_response_id: "untrusted-first", store: false });
    const first = bridge.turns[0];
    expect(first.headers["x-cch-responses-ws-prior-local"]).toBeUndefined();
    expect(first.headers["x-cch-responses-ws-generation"]).toBeUndefined();
    expect(first.headers["x-cch-upstream-connection-local"]).toBeUndefined();
    expect(first.headers["x-cch-upstream-transport"]).toBeUndefined();
    expect(first.headers["x-cch-internal-secret"]).toBe("test-process-secret");
    expect(first.headers["x-cch-responses-ws-session"]).not.toBe("forged-session");
    await bridge.finish(first, localHeaders);

    bridge.send({ previous_response_id: "resp-one", store: true });
    expect(bridge.turns[1].headers["x-cch-responses-ws-prior-local"]).toBe("1");
    expect(getBinding).toHaveBeenCalledWith(first.headers["x-cch-responses-ws-session"]);
    await bridge.finish(bridge.turns[1], {
      "x-cch-upstream-connection-local": "0",
      "x-cch-upstream-transport": "websocket",
    });

    bridge.send({ previous_response_id: "resp-two", store: false });
    expect(bridge.turns[2].headers["x-cch-responses-ws-prior-local"]).toBeUndefined();
    await bridge.finish(bridge.turns[2], localHeaders);
    bridge.send({ store: false });
    expect(bridge.turns[3].headers["x-cch-responses-ws-prior-local"]).toBeUndefined();
    await bridge.finish(bridge.turns[3], localHeaders);
    bridge.send({ previous_response_id: "" });
    expect(bridge.turns[4].headers["x-cch-responses-ws-prior-local"]).toBeUndefined();
    await bridge.finish(bridge.turns[4]);
    expect(bridge.ws.close).not.toHaveBeenCalled();
  });

  it.each(["response.incomplete", "response.failed"])(
    "retains local semantics after an authoritative %s terminal",
    async (type) => {
      const bridge = await startBridge();
      vi.stubGlobal("__cchGetResponsesWsSessionBinding", () => ({
        generation: "generation-one",
        connectionLocal: true,
        active: false,
      }));
      bridge.send({ store: false });
      await bridge.finish(bridge.turns[0], localHeaders, { type, response: { id: "resp-one" } });
      bridge.send({ previous_response_id: "resp-one", store: true });
      expect(bridge.turns[1].headers["x-cch-responses-ws-prior-local"]).toBe("1");
      await bridge.finish(bridge.turns[1]);
      bridge.ws.emit("close");
    }
  );

  it("keeps legacy responses without metadata persistent and nonlocal", async () => {
    const bridge = await startBridge();
    bridge.send();
    bridge.send({ previous_response_id: "resp-one" });
    await bridge.finish(bridge.turns[0]);
    expect(bridge.turns).toHaveLength(2);
    expect(bridge.turns[1].headers["x-cch-responses-ws-prior-local"]).toBeUndefined();
    await bridge.finish(bridge.turns[1]);
    expect(bridge.ws.close).not.toHaveBeenCalled();
    bridge.ws.emit("close");
  });

  it.each([
    ["no getter", undefined, localHeaders],
    ["missing binding", () => undefined, localHeaders],
    [
      "active binding",
      () => ({ generation: "generation-one", connectionLocal: true, active: true }),
      localHeaders,
    ],
    [
      "different generation",
      () => ({ generation: "generation-two", connectionLocal: true, active: false }),
      localHeaders,
    ],
    [
      "nonlocal binding",
      () => ({ generation: "generation-one", connectionLocal: false, active: false }),
      localHeaders,
    ],
    [
      "throwing getter",
      () => {
        throw new Error("binding unavailable");
      },
      localHeaders,
    ],
    [
      "HTTP fallback",
      () => ({ generation: "generation-one", connectionLocal: true, active: false }),
      { ...localHeaders, "x-cch-upstream-transport": "http" },
    ],
    [
      "missing generation",
      () => ({ generation: "generation-one", connectionLocal: true, active: false }),
      { "x-cch-upstream-connection-local": "1", "x-cch-upstream-transport": "websocket" },
    ],
    [
      "empty generation",
      () => ({ generation: "generation-one", connectionLocal: true, active: false }),
      { ...localHeaders, "x-cch-responses-ws-generation": "" },
    ],
  ])(
    "closes a completed local turn with %s and drops queued work",
    async (_label, getter, headers) => {
      const bridge = await startBridge();
      vi.stubGlobal("__cchGetResponsesWsSessionBinding", getter);
      bridge.send({ store: false });
      bridge.send({ previous_response_id: "resp-one" });
      await bridge.finish(bridge.turns[0], headers);
      expect(bridge.messages).toEqual([
        { type: "response.completed", response: { id: "resp-one" } },
      ]);
      expect(bridge.ws.close).toHaveBeenCalledWith(1000, "upstream_transport_reset");
      expect(bridge.turns).toHaveLength(1);
      expect(bridge.cleanup).toHaveBeenCalledOnce();
    }
  );

  it.each(["ack first", "EOF first"])(
    "rechecks the live binding only after both terminal ACK and EOF: %s",
    async (order) => {
      const bridge = await startBridge({ delayedAck: true });
      let binding: Binding | undefined = {
        generation: "generation-one",
        connectionLocal: true,
        active: false,
      };
      const getBinding = vi.fn(() => binding);
      vi.stubGlobal("__cchGetResponsesWsSessionBinding", getBinding);
      bridge.send({ store: false });
      bridge.send({ previous_response_id: "resp-one" });
      const turn = bridge.turns[0];
      Object.assign(turn.response.headers, localHeaders);
      turn.respond();
      turn.response.emit(
        "data",
        'data: {"type":"response.completed","response":{"id":"resp-one"}}\n\n'
      );
      if (order === "ack first") bridge.acknowledgements.shift()?.();
      else turn.response.emit("end");
      await tick();
      expect(getBinding).not.toHaveBeenCalled();
      expect(bridge.ws.close).not.toHaveBeenCalled();
      expect(bridge.turns).toHaveLength(1);

      binding = undefined;
      if (order === "ack first") turn.response.emit("end");
      else bridge.acknowledgements.shift()?.();
      await tick();
      expect(getBinding).toHaveBeenCalledOnce();
      expect(bridge.ws.close).toHaveBeenCalledWith(1000, "upstream_transport_reset");
      expect(bridge.turns).toHaveLength(1);
    }
  );

  it.each(["HTTP 400", "WS error"])(
    "acknowledges canonical previous_response_not_found before closing and discarding queued turns: %s",
    async (kind) => {
      const bridge = await startBridge({ delayedAck: true });
      bridge.send({ previous_response_id: "missing-response" });
      bridge.send({ previous_response_id: "must-not-dispatch" });
      const turn = bridge.turns[0];
      const error = { code: "previous_response_not_found", message: "Continuation unavailable" };
      if (kind === "HTTP 400") {
        turn.response.headers["content-type"] = "application/json";
        turn.response.statusCode = 400;
        turn.respond();
        turn.response.emit("data", Buffer.from(JSON.stringify({ error })));
      } else {
        turn.respond();
        turn.response.emit("data", `data: ${JSON.stringify({ type: "error", error })}\n\n`);
      }
      turn.response.emit("end");
      await tick();
      expect(bridge.messages[0]).toMatchObject({ type: "error", error });
      expect(bridge.ws.close).not.toHaveBeenCalled();
      expect(bridge.turns).toHaveLength(1);
      bridge.acknowledgements.shift()?.();
      await tick();
      expect(bridge.ws.close).toHaveBeenCalledWith(1000, "upstream_transport_reset");
      expect(bridge.turns).toHaveLength(1);
    }
  );

  it("updates prior-local from JSON terminal metadata too", async () => {
    const bridge = await startBridge();
    vi.stubGlobal("__cchGetResponsesWsSessionBinding", () => ({
      generation: "generation-one",
      connectionLocal: true,
      active: false,
    }));
    bridge.send({ store: false });
    const turn = bridge.turns[0];
    Object.assign(turn.response.headers, localHeaders, { "content-type": "application/json" });
    turn.respond();
    turn.response.emit("data", Buffer.from('{"id":"json-response"}'));
    turn.response.emit("end");
    await tick();
    bridge.send({ previous_response_id: "json-response" });
    expect(bridge.turns[1].headers["x-cch-responses-ws-prior-local"]).toBe("1");
    await bridge.finish(bridge.turns[1]);
    bridge.ws.emit("close");
  });

  it("treats a synthesized DONE terminal as authoritative local metadata", async () => {
    const bridge = await startBridge();
    vi.stubGlobal("__cchGetResponsesWsSessionBinding", () => ({
      generation: "generation-one",
      connectionLocal: true,
      active: false,
    }));
    bridge.send({ store: false });
    const turn = bridge.turns[0];
    Object.assign(turn.response.headers, localHeaders);
    turn.respond();
    turn.response.emit("data", "data: [DONE]\n\n");
    turn.response.emit("end");
    await tick();
    bridge.send({ previous_response_id: "prior-response" });
    expect(bridge.turns[1].headers["x-cch-responses-ws-prior-local"]).toBe("1");
    await bridge.finish(bridge.turns[1]);
    bridge.ws.emit("close");
  });

  it("keeps the prior-local constraint after a noncanonical error on a store:true request", async () => {
    const bridge = await startBridge();
    vi.stubGlobal("__cchGetResponsesWsSessionBinding", () => ({
      generation: "generation-one",
      connectionLocal: true,
      active: false,
    }));
    bridge.send({ store: false });
    await bridge.finish(bridge.turns[0], localHeaders);
    bridge.send({ previous_response_id: "resp-one", store: true });
    await bridge.finish(
      bridge.turns[1],
      {},
      { type: "error", error: { code: "rate_limit_exceeded" } }
    );
    bridge.send({ previous_response_id: "resp-one", store: true });
    expect(bridge.turns[2].headers["x-cch-responses-ws-prior-local"]).toBe("1");
    await bridge.finish(bridge.turns[2]);
    expect(bridge.ws.close).not.toHaveBeenCalled();
    bridge.ws.emit("close");
  });
});
