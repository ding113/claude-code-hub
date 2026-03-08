import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

function getFreePort(): Promise<number> {
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

describe("custom server bootstrap", () => {
  let child = null;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    child = null;
  });

  it("serves HTTP and WS upgrades on one port", async () => {
    const port = await getFreePort();
    child = spawn("node", ["server.js", "--dev", "--port", String(port)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        HOSTNAME: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for custom server to start"));
      }, 120000);

      const handleReady = (chunk) => {
        const text = chunk.toString();
        if (text.includes("[CCH] Server listening on")) {
          clearTimeout(timeout);
          child.stdout?.off("data", handleReady);
          child.stderr?.off("data", handleError);
          resolve(undefined);
        }
      };

      const handleError = (chunk) => {
        const text = chunk.toString();
        if (text.trim()) {
          clearTimeout(timeout);
          child.stdout?.off("data", handleReady);
          child.stderr?.off("data", handleError);
          reject(new Error(text));
        }
      };

      child.stdout?.on("data", handleReady);
      child.stderr?.on("data", handleError);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Custom server exited early with code ${code}`));
      });
    });

    const httpResponse = await fetch(`http://127.0.0.1:${port}/v1/models`);
    expect(httpResponse.status).toBeLessThan(500);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/responses`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  }, 120000);
});
