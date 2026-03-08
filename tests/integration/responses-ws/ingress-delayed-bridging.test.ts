import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function createSseResponse(events, delayMs = 0) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        for (const event of events) {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`)
          );
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
      },
    }
  );
}

async function createIngressHarness(forwardResponsesRequest) {
  const mod = await import("../../../server.js");
  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end("Not Found");
  });
  const wss = mod.createResponsesUpgradeServer({
    targetOrigin: "http://127.0.0.1:1",
    forwardResponsesRequest,
  });

  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/v1/responses") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const port = await getFreePort();
  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", (error) => (error ? reject(error) : resolve(undefined)));
  });

  return {
    port,
    server,
    wss,
    async close() {
      await Promise.all([
        new Promise((resolve) => wss.close(() => resolve(undefined))),
        new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve(undefined)))
        ),
      ]);
    },
  };
}

describe("responses websocket ingress delayed bridging", () => {
  let harness = null;

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = null;
    }
  });

  it("buffers until response.create then resolves provider", async () => {
    const forwardResponsesRequest = vi.fn(async ({ bodyText }) => {
      const body = JSON.parse(bodyText);
      return createSseResponse([
        {
          type: "response.completed",
          payload: {
            response: {
              id: "resp_1",
              object: "response",
              created: 1,
              model: body.model,
              status: "completed",
              output: [],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        },
      ]);
    });

    harness = await createIngressHarness(forwardResponsesRequest);
    const ws = new WebSocket(`ws://127.0.0.1:${harness.port}/v1/responses`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(forwardResponsesRequest).not.toHaveBeenCalled();

    const completedPromise = new Promise((resolve) => {
      ws.on("message", (raw) => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === "response.completed") {
          resolve(frame);
        }
      });
    });

    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          model: "gpt-5-codex",
          input: [{ role: "user", content: [{ type: "input_text", text: "ping" }] }],
        },
      })
    );

    const completed = await completedPromise;
    expect(forwardResponsesRequest).toHaveBeenCalledTimes(1);
    expect(forwardResponsesRequest.mock.calls[0][0].bodyText).toContain('"model":"gpt-5-codex"');
    expect(completed.response.model).toBe("gpt-5-codex");

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });

  it("rejects second response.create while active and recovers for a later sequential turn", async () => {
    const forwardResponsesRequest = vi
      .fn()
      .mockImplementationOnce(async () =>
        createSseResponse(
          [
            {
              type: "response.completed",
              payload: {
                response: {
                  id: "resp_1",
                  object: "response",
                  created: 1,
                  model: "gpt-5-codex",
                  status: "completed",
                  output: [],
                  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
                },
              },
            },
          ],
          100
        )
      )
      .mockImplementationOnce(async () =>
        createSseResponse([
          {
            type: "response.completed",
            payload: {
              response: {
                id: "resp_2",
                object: "response",
                created: 2,
                model: "gpt-5-codex",
                status: "completed",
                output: [],
                usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
              },
            },
          },
        ])
      );

    harness = await createIngressHarness(forwardResponsesRequest);
    const ws = new WebSocket(`ws://127.0.0.1:${harness.port}/v1/responses`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const receivedFrames = [];
    ws.on("message", (raw) => {
      receivedFrames.push(JSON.parse(raw.toString()));
    });

    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          model: "gpt-5-codex",
        },
      })
    );
    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          model: "gpt-5-codex",
        },
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(receivedFrames).toContainEqual(
      expect.objectContaining({
        type: "error",
        error: expect.objectContaining({ code: "response_already_in_progress" }),
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 150));

    ws.send(
      JSON.stringify({
        type: "response.create",
        response: {
          model: "gpt-5-codex",
        },
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedFrames.filter((frame) => frame.type === "response.completed")).toHaveLength(2);

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });
});
