import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { AllocationEstimate } from "@/lib/body-store/allocation-estimate";
import { withRequestMemoryLifetime } from "@/lib/memory/request-lifetime";
import { MemoryGovernor } from "../../../server-lib/memory-governor";

const GOVERNOR_KEY = Symbol.for("cch.memoryGovernor");
const globals = globalThis as unknown as Record<symbol, unknown>;
const previousGovernor = globals[GOVERNOR_KEY];
let spoolDirectory: string;

beforeEach(async () => {
  // 使用工作区所在磁盘，避免 Linux 的 /tmp 挂载为 tmpfs。
  const root = path.join(process.cwd(), "tmp");
  await mkdir(root, { recursive: true });
  spoolDirectory = await mkdtemp(path.join(root, "cch-retained-lease-"));
  vi.stubEnv("CCH_MEMORY_SPILL_DIR", spoolDirectory);
});

afterEach(async () => {
  globals[GOVERNOR_KEY] = previousGovernor;
  vi.unstubAllEnvs();
  await rm(spoolDirectory, { recursive: true, force: true });
});

function installGovernor(): MemoryGovernor {
  const governor = new MemoryGovernor({
    limit: 256 * 1024 ** 2,
    remote: false,
    monitor: false,
    enabled: true,
  });
  globals[GOVERNOR_KEY] = governor;
  return governor;
}

function createContext(request: Request) {
  return {
    req: {
      method: request.method,
      url: request.url,
      raw: request,
      header(name?: string) {
        if (name) return request.headers.get(name) ?? undefined;
        return Object.fromEntries(request.headers.entries());
      },
    },
  } as never;
}

function estimateOf(bytes: Uint8Array): AllocationEstimate {
  const estimate = new AllocationEstimate();
  estimate.feed(bytes);
  return estimate;
}

describe("解析后的请求额度按实际持有量占用", () => {
  it("持有量估算为原始字节、UTF-16 字符串、结构与出站副本，低于解析峰值", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ messages: [{ role: "user", content: "x".repeat(100_000) }] })
    );
    const estimate = estimateOf(bytes);
    const structure = estimate.capacityBytes - 8192 - bytes.length * 8;
    expect(estimate.retainedBytes).toBe(8192 + bytes.length * 4 + structure);
    expect(estimate.retainedBytes).toBeLessThan(estimate.capacityBytes);
  });

  it("JSON 请求解析完成后 body_materialize 额度收缩到持有量，响应结束后归零", async () => {
    const governor = installGovernor();
    const text = JSON.stringify({
      model: "claude-sonnet-4",
      messages: Array.from({ length: 200 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: [{ type: "text", text: `turn ${index} `.repeat(200) }],
      })),
    });
    const estimate = estimateOf(new TextEncoder().encode(text));

    const response = await withRequestMemoryLifetime(async () => {
      const request = new Request("http://localhost/v1/messages", { method: "POST", body: text });
      const session = await ProxySession.fromContext(createContext(request));
      expect(session.request.model).toBe("claude-sonnet-4");
      const ledger = governor.snapshot().leases!;
      expect(ledger.byTag.body_materialize).toMatchObject({
        count: 1,
        bytes: estimate.retainedBytes,
      });
      // 解析期间仍按完整峰值预留。
      expect(governor.snapshot().peakBytes).toBeGreaterThanOrEqual(estimate.capacityBytes);
      return new Response("OK");
    });
    expect(await response.text()).toBe("OK");
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("非 JSON 正文保留原始文本时同样收缩到持有量", async () => {
    const governor = installGovernor();
    const text = "not json ".repeat(50_000);
    const estimate = estimateOf(new TextEncoder().encode(text));

    const response = await withRequestMemoryLifetime(async () => {
      const request = new Request("http://localhost/v1/messages", { method: "POST", body: text });
      const session = await ProxySession.fromContext(createContext(request));
      expect(session.request.message).toEqual({ raw: text });
      expect(governor.snapshot().leases!.byTag.body_materialize.bytes).toBe(estimate.retainedBytes);
      return new Response("OK");
    });
    await response.text();
    expect(governor.snapshot().usedBytes).toBe(0);
  });

  it("multipart 图片请求解析完成后同样收缩到持有量", async () => {
    const governor = installGovernor();
    const formData = new FormData();
    formData.append("model", "gpt-image-1.5");
    formData.append("prompt", "draw a cat");
    formData.append(
      "image[]",
      new File([new Uint8Array(200_000).fill(7)], "image.png", { type: "image/png" }),
      "image.png"
    );
    const request = new Request("https://proxy.example.com/v1/images/edits", {
      method: "POST",
      body: formData,
    });
    const bytes = new Uint8Array(await request.clone().arrayBuffer());
    const estimate = estimateOf(bytes);

    const response = await withRequestMemoryLifetime(async () => {
      await ProxySession.fromContext(createContext(request));
      expect(governor.snapshot().leases!.byTag.body_materialize.bytes).toBe(estimate.retainedBytes);
      return new Response("OK");
    });
    await response.text();
    expect(governor.snapshot().usedBytes).toBe(0);
  });
});
