// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryPrebuffer } from "@/app/v1/_lib/proxy/discovery-prebuffer";
import { StreamGatePrebufferBudget } from "@/app/v1/_lib/proxy/stream-gate/prebuffer-budget";
import { loadRequestBody } from "@/lib/body-store/request-body-store";
import { getMemoryGovernor } from "@/lib/memory/governor";
import { createMemoryCoordinator } from "../../../server-lib/memory-coordinator";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

afterEach(() => vi.unstubAllEnvs());

describe("request capacity contention", () => {
  it("negotiates remote credits before rejecting a valid Discovery prefix", async () => {
    const coordinator = createMemoryCoordinator({
      env: { CCH_MEMORY_BUDGET_BYTES: String(64 * 1024 ** 2) },
      readSnapshot: () => ({ availableRamBytes: 1024 ** 3, availableSwapBytes: 0 }),
    });
    const worker = Object.assign(new EventEmitter(), {
      send: (message: unknown) => queueMicrotask(() => child.emit("message", message)),
    });
    const child = Object.assign(new EventEmitter(), {
      env: {},
      connected: true,
      send: (message: unknown, callback?: () => void) => {
        queueMicrotask(() => worker.emit("message", message));
        callback?.();
      },
    });
    coordinator.attach(worker);
    coordinator.resetBaseline();
    const governor = new MemoryGovernor({ processRef: child, remote: true, monitor: false });
    const budget = new StreamGatePrebufferBudget(() => Number.MAX_SAFE_INTEGER, governor);
    const prefix = new DiscoveryPrebuffer();
    try {
      prefix.attachLease(await budget.acquire(128 * 1024));
      expect(governor.snapshot().limitBytes).toBe(1024 ** 2);
      const chunk = new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "response.created", response: { instructions: "x".repeat(300000) } })}\n\n`
      );
      await prefix.reserveForParse(chunk);
      expect(governor.snapshot().usedBytes).toBeGreaterThan(chunk.byteLength * 8);
      prefix.append(chunk);
      prefix.finishParsing();
    } finally {
      prefix.clear();
      governor.sample();
      child.connected = false;
      child.emit("disconnect");
      worker.emit("exit");
    }
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it.each([false, true])(
    "concurrent bodies can progress without holding partial admission (compressed=%s)",
    async (compressed) => {
      const root = path.join(process.cwd(), "tmp");
      await mkdir(root, { recursive: true });
      const directory = await mkdtemp(path.join(root, "memory-contention-"));
      vi.stubEnv("CCH_MEMORY_SPILL_DIR", directory);
      const governor = new MemoryGovernor({
        limit: compressed ? 384 * 1024 : 1024 ** 2,
        remote: false,
        monitor: false,
      });
      vi.spyOn(getMemoryGovernor(), "acquire").mockImplementation((...args) =>
        governor.acquire(...args)
      );
      vi.spyOn(getMemoryGovernor(), "tryLease").mockImplementation((bytes) =>
        governor.tryLease(bytes)
      );
      const text = JSON.stringify({ input: "x".repeat(compressed ? 512 : 64000) });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("no progress")), 2000);
      const run = async () => {
        const loaded = await loadRequestBody(
          new Request("http://localhost/v1/responses", {
            method: "POST",
            body: compressed ? gzipSync(text) : text,
            headers: compressed ? { "content-encoding": "gzip" } : undefined,
            signal: controller.signal,
          })
        );
        try {
          expect(new TextDecoder().decode(loaded.buffer)).toBe(text);
        } finally {
          loaded.lease.release();
        }
      };
      try {
        await run();
        const results = await Promise.allSettled(Array.from({ length: 3 }, run));
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
          "fulfilled",
        ]);
        expect(governor.snapshot()).toMatchObject({ usedBytes: 0, waiting: 0, rejected: 0 });
      } finally {
        clearTimeout(timer);
        controller.abort();
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
