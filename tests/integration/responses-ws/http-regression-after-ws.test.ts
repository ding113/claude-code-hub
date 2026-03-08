import { spawn } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

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

describe("responses websocket HTTP regression", () => {
  let child = null;

  afterEach(() => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    child = null;
  });

  it("keeps the HTTP /v1/responses route alive after WS support", async () => {
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
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for server start")),
        120000
      );
      const onStdout = (chunk) => {
        if (chunk.toString().includes("[CCH] Server listening on")) {
          clearTimeout(timeout);
          child.stdout?.off("data", onStdout);
          resolve(undefined);
        }
      };
      child.stdout?.on("data", onStdout);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited early with code ${code}`));
      });
    });

    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5-codex", input: [] }),
    });

    expect(response.status).toBeLessThan(500);
    expect(response.status).not.toBe(404);
  }, 120000);
});
