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
  it("分别记录响应头与首个有效内容耗时", () => {
    const session = createSession(Date.now() - 1_200);

    const ttfb = session.recordTtfb(200);
    const ttft = session.recordTtft(800);

    expect(session.ttfbMs).toBe(ttfb);
    expect(session.ttftMs).toBe(ttft);
  });

  it("TTFT 不覆盖已经记录的 TTFB", () => {
    const session = createSession(Date.now() - 3_000);

    session.recordTtfb(400);
    const ttft = session.recordTtft(1_200);

    expect(session.ttfbMs).toBe(400);
    expect(session.ttftMs).toBe(ttft);
    expect(session.ttfbMs!).toBeLessThan(session.ttftMs!);
  });

  it("recordTtfb 首写生效，后续尝试不会改写 winner timing", () => {
    const session = createSession(Date.now() - 5_000);

    session.recordTtfb(900);
    session.recordTtfb(2_500);

    expect(session.ttfbMs).toBe(900);
  });

  it("recordTtfb 将负耗时钳到 0", () => {
    const session = createSession(Date.now());

    session.recordTtfb(-50);

    expect(session.ttfbMs).toBe(0);
  });

  it("recordTtft 幂等，重复调用不改变已记录的值", () => {
    const session = createSession(Date.now() - 800);

    const first = session.recordTtft(500);
    const second = session.recordTtft(700);

    expect(second).toBe(first);
    expect(session.ttftMs).toBe(first);
  });
});
