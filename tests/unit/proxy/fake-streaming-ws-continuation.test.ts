import { afterEach, expect, it, vi } from "vitest";
import { tryFakeStreamingPath } from "@/app/v1/_lib/proxy/fake-streaming/proxy-integration";
import type { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  INTERNAL_SECRET_HEADER,
  WS_FORWARD_FLAG_HEADER,
} from "@/app/v1/_lib/responses-ws/internal-secret";
import type { SystemSettings } from "@/types/system-config";

afterEach(() => vi.unstubAllEnvs());
it("skips fake streaming for a complete connection-local WS turn before mutating its session", async () => {
  vi.stubEnv("CCH_RESPONSES_WS_INTERNAL_SECRET", "fake-ws-test");
  const message = { store: false, model: "gpt-test", stream: true, input: "hello" };
  const session = {
    headers: new Headers({
      "x-cch-client-transport": "websocket",
      [INTERNAL_SECRET_HEADER]: "fake-ws-test",
      [WS_FORWARD_FLAG_HEADER]: "1",
    }),
    request: { message },
  } as unknown as ProxySession;
  expect(await tryFakeStreamingPath(session, {} as SystemSettings)).toBeNull();
  expect(session.request.message).toBe(message);
});

it.each([new Headers(), undefined])(
  "allows ordinary HTTP requests through the local WS guard (headers=%s)",
  async (headers) => {
    const message = { store: false, model: "gpt-test", stream: true, input: "hello" };
    const readWhitelist = vi.fn(() => []);
    const settings = {
      get fakeStreamingWhitelist() {
        return readWhitelist();
      },
    } as unknown as SystemSettings;
    const session = {
      headers,
      request: { message, model: "gpt-test" },
    } as unknown as ProxySession;
    expect(await tryFakeStreamingPath(session, settings)).toBeNull();
    expect(readWhitelist).toHaveBeenCalledOnce();
    expect(session.request.message).toBe(message);
  }
);
