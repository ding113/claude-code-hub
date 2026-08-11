import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDir = path.join(process.cwd(), "tests/load/issue-1408-replay-oom");
const nodeScripts = ["mock-upstream.cjs", "drive-disconnect-waves.cjs", "memory-probe.cjs"];
const shellScripts = ["sample-container.sh", "run-wave.sh", "start-mock-container.sh"];
const children = new Set<ChildProcessWithoutNullStreams>();

function getJson(url: URL): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function requestJson(
  url: URL,
  method: string,
  body = ""
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function startMock(
  overrides: Record<string, string> = {}
): Promise<{ child: ChildProcessWithoutNullStreams; baseUrl: URL }> {
  const child = spawn(process.execPath, [path.join(fixtureDir, "mock-upstream.cjs")], {
    env: {
      ...process.env,
      CCH_MOCK_HOST: "127.0.0.1",
      CCH_MOCK_PORT: "0",
      CCH_MOCK_MIB: "0.0625",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);

  const listening = await waitForJsonLine(child, (value) => value.event === "listening");
  expect(listening.port).toEqual(expect.any(Number));
  return { child, baseUrl: new URL(`http://127.0.0.1:${listening.port}`) };
}

function waitForJsonLine(
  child: ChildProcessWithoutNullStreams,
  predicate: (value: Record<string, unknown>) => boolean
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("fixture output timeout")), 5000);
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const value = JSON.parse(line) as Record<string, unknown>;
        if (predicate(value)) {
          clearTimeout(timer);
          resolve(value);
          return;
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture exited before readiness: ${code}`));
    });
  });
}

function postAndAbort(url: URL, body: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.once("data", () => {
          response.destroy();
          resolve();
        });
        response.on("error", () => resolve());
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

afterEach(async () => {
  const exits = [...children].map(
    (child) =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }, 1000);
        child.once("exit", () => {
          clearTimeout(forceTimer);
          resolve();
        });
        child.kill("SIGTERM");
      })
  );
  children.clear();
  await Promise.all(exits);
});

describe("issue #1408 load fixture", () => {
  it("keeps repository scripts syntactically valid and independent from temporary paths", () => {
    for (const filename of nodeScripts) {
      const file = path.join(fixtureDir, filename);
      execFileSync(process.execPath, ["--check", file]);
      expect(readFileSync(file, "utf8")).not.toContain("/private/tmp");
    }

    for (const filename of shellScripts) {
      const file = path.join(fixtureDir, filename);
      if (process.platform !== "win32") execFileSync("sh", ["-n", file]);
      expect(readFileSync(file, "utf8")).not.toContain("/private/tmp");
    }

    const startMock = readFileSync(path.join(fixtureDir, "start-mock-container.sh"), "utf8");
    expect(startMock.indexOf('docker rm -f "$container"')).toBeGreaterThan(
      startMock.indexOf('docker logs --tail 100 "$container"')
    );
  });

  it("emits a valid hanging Responses SSE stream and records the scenario count", async () => {
    const { baseUrl } = await startMock();
    await postAndAbort(
      new URL("/v1/responses", baseUrl),
      JSON.stringify({ input: "CCH_SCENARIO_contract-fixture", stream: true })
    );

    const stats = await getJson(new URL("/stats", baseUrl));
    expect(stats).toMatchObject({
      counts: { "contract-fixture": 1 },
      totalMiB: 0.0625,
    });
  });

  it("resets counters, rejects unknown routes, and bounds request bodies", async () => {
    const { baseUrl } = await startMock({ CCH_MOCK_MAX_REQUEST_BYTES: "64" });

    const missing = await requestJson(new URL("/unknown", baseUrl), "GET");
    expect(missing).toEqual({ statusCode: 404, body: { error: "not found" } });

    const oversized = await requestJson(
      new URL("/v1/responses", baseUrl),
      "POST",
      JSON.stringify({ input: "x".repeat(128), stream: true })
    );
    expect(oversized).toEqual({
      statusCode: 413,
      body: { error: "request body too large" },
    });

    await postAndAbort(
      new URL("/v1/responses", baseUrl),
      JSON.stringify({ input: "CCH_SCENARIO_reset-me", stream: true })
    );
    await expect(getJson(new URL("/stats", baseUrl))).resolves.toMatchObject({
      counts: { "reset-me": 1 },
    });

    const reset = await requestJson(new URL("/reset", baseUrl), "POST");
    expect(reset).toEqual({ statusCode: 200, body: { reset: true } });
    await expect(getJson(new URL("/stats", baseUrl))).resolves.toMatchObject({ counts: {} });
  });

  it.each([
    ["payload below one frame", { CCH_MOCK_MIB: "0.01" }, "CCH_MOCK_MIB"],
    ["payload above the fixture cap", { CCH_MOCK_MIB: "65" }, "CCH_MOCK_MIB"],
    ["fractional request limit", { CCH_MOCK_MAX_REQUEST_BYTES: "1.5" }, "CCH_MOCK_MAX"],
  ])("rejects invalid mock configuration: %s", (_name, overrides, expected) => {
    const result = spawnSync(process.execPath, [path.join(fixtureDir, "mock-upstream.cjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        CCH_MOCK_HOST: "127.0.0.1",
        CCH_MOCK_PORT: "0",
        ...overrides,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expected);
  });

  it("prints a structured memory sample when preloaded", () => {
    const output = execFileSync(process.execPath, [path.join(fixtureDir, "memory-probe.cjs")], {
      encoding: "utf8",
    });
    const sample = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(sample).toMatchObject({ cchMemoryProbe: true });
    expect(sample.rssMiB).toEqual(expect.any(Number));
    expect(sample.heapUsedMiB).toEqual(expect.any(Number));
    expect(sample.externalMiB).toEqual(expect.any(Number));
    expect(sample.arrayBuffersMiB).toEqual(expect.any(Number));
    expect(sample.resources).toEqual(expect.any(Object));
  });

  it("requires the API key through an explicit environment boundary", () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(fixtureDir, "drive-disconnect-waves.cjs"),
        "http://127.0.0.1:1",
        "http://127.0.0.1:2/stats",
        "missing-key",
        "1",
        "1",
        "0",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CCH_API_KEY: "", CCH_API_KEY_FILE: "" },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("set CCH_API_KEY or CCH_API_KEY_FILE");
  });

  it("fails when the mock stats response is interrupted after headers", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"counts":');
      setTimeout(() => response.destroy(), 10);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture server has no port");
      const child = spawn(
        process.execPath,
        [
          path.join(fixtureDir, "drive-disconnect-waves.cjs"),
          "http://127.0.0.1:1",
          `http://127.0.0.1:${address.port}/stats`,
          "interrupted-stats",
          "1",
          "1",
          "0",
        ],
        {
          env: { ...process.env, CCH_API_KEY: "fixture-key", CCH_API_KEY_FILE: "" },
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      children.add(child);

      const result = await waitForExit(child);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("response aborted");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.each([
    ["unsupported URL protocol", ["ftp://127.0.0.1", "http://127.0.0.1/stats", "valid"], "APP_URL"],
    [
      "invalid scenario characters",
      ["http://127.0.0.1", "http://127.0.0.1/stats", "bad:value"],
      "SCENARIO_PREFIX",
    ],
    ["zero waves", ["http://127.0.0.1", "http://127.0.0.1/stats", "valid", "0"], "WAVES"],
  ])("rejects invalid driver input: %s", (_name, args, expected) => {
    const result = spawnSync(
      process.execPath,
      [path.join(fixtureDir, "drive-disconnect-waves.cjs"), ...args],
      {
        encoding: "utf8",
        env: { ...process.env, CCH_API_KEY: "fixture-key", CCH_API_KEY_FILE: "" },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(expected);
  });
});
