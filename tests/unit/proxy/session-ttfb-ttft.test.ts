import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

import { ProxySession } from "@/app/v1/_lib/proxy/session";

function createSession(startTime: number): ProxySession {
  return new (
    ProxySession as unknown as {
      new (init: {
        startTime: number;
        method: string;
        requestUrl: URL;
        headers: Headers;
        headerLog: string;
        request: { message: Record<string, unknown>; log: string; model: string | null };
        userAgent: string | null;
        context: unknown;
        clientAbortSignal: AbortSignal | null;
      }): ProxySession;
    }
  )({
    startTime,
    method: "POST",
    requestUrl: new URL("http://localhost/v1/messages"),
    headers: new Headers(),
    headerLog: "",
    request: { message: {}, log: "(test)", model: null },
    userAgent: null,
    context: {},
    clientAbortSignal: null,
  });
}

describe("ProxySession TTFB / TTFT", () => {
  it("门控旁路时 recordTtft 同时补齐 TTFB（两者同一时刻）", () => {
    const session = createSession(Date.now() - 1_200);

    const ttft = session.recordTtft();

    expect(session.ttftMs).toBe(ttft);
    expect(session.firstByteMs).toBe(ttft);
  });

  it("门控提交时先记 TTFB，recordTtft 不覆盖它", () => {
    const startTime = Date.now() - 3_000;
    const session = createSession(startTime);

    session.recordFirstByte(startTime + 400);
    const ttft = session.recordTtft();

    expect(session.firstByteMs).toBe(400);
    expect(session.ttftMs).toBe(ttft);
    // TTFB 必须早于 TTFT，否则延迟分解与 TPS 分母都会失真
    expect(session.firstByteMs!).toBeLessThan(session.ttftMs!);
  });

  it("recordFirstByte 首写生效：failover 后不会被后续尝试改写", () => {
    const startTime = Date.now() - 5_000;
    const session = createSession(startTime);

    session.recordFirstByte(startTime + 900);
    session.recordFirstByte(startTime + 2_500);

    expect(session.firstByteMs).toBe(900);
  });

  it("recordFirstByte 对早于 startTime 的时刻钳到 0", () => {
    const startTime = Date.now();
    const session = createSession(startTime);

    session.recordFirstByte(startTime - 50);

    expect(session.firstByteMs).toBe(0);
  });

  it("recordTtft 幂等：重复调用不改变已记录的值", () => {
    const session = createSession(Date.now() - 800);

    const first = session.recordTtft();
    const second = session.recordTtft();

    expect(second).toBe(first);
    expect(session.firstByteMs).toBe(first);
  });
});
