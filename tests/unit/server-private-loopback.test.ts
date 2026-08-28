import http from "node:http";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);
const { listenOnPrivateLoopback } = requireFromHere("../../server.js") as {
  listenOnPrivateLoopback: (server: http.Server) => Promise<{ hostname: string; port: number }>;
};

const openServers = new Set<http.Server>();

afterEach(async () => {
  await Promise.all(
    Array.from(
      openServers,
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  openServers.clear();
});

describe("private WebSocket loopback listener", () => {
  it("binds an ephemeral IPv4 loopback port and serves the local Next handler", async () => {
    const server = http.createServer((request, response) => {
      expect(request.url).toBe("/v1/responses");
      response.end("same-worker");
    });
    openServers.add(server);

    const target = await listenOnPrivateLoopback(server);
    expect(target.hostname).toBe("127.0.0.1");
    expect(target.port).toBeGreaterThan(0);
    expect(server.address()).toMatchObject({ address: "127.0.0.1", port: target.port });

    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(
          { hostname: target.hostname, port: target.port, path: "/v1/responses" },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          }
        )
        .on("error", reject);
    });
    expect(body).toBe("same-worker");
  });
});
