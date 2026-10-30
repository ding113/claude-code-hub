import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCodexModelCatalogUrl,
  fetchCodexModelCatalog,
  prepareCodexModelCatalogSource,
} from "@/app/v1/_lib/models/codex-model-catalog-fetcher";
import { CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES } from "@/lib/codex-model-catalog";
import type { Provider } from "@/types/provider";

const { request, createProxyAgent, warn } = vi.hoisted(() => ({
  request: vi.fn(),
  createProxyAgent: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("undici", () => ({ request }));
vi.mock("@/lib/proxy-agent", () => ({ createProxyAgentForProvider: createProxyAgent }));
vi.mock("@/lib/logger", () => ({
  logger: { warn, debug: vi.fn(), error: vi.fn(), info: vi.fn(), trace: vi.fn() },
}));

const nativeModel = {
  slug: "gpt-6.1-terra",
  display_name: "GPT-6.1 Terra",
  supported_reasoning_levels: [{ effort: "medium", description: "Medium" }],
  shell_type: "shell_command",
  visibility: "list",
  supported_in_api: true,
  priority: 1,
  support_verbosity: true,
  truncation_policy: { mode: "tokens", limit: 10000 },
  experimental_supported_tools: [],
  base_instructions: "Private upstream instructions",
  context_window: 500000,
  max_context_window: 872000,
  model_messages: { instructions_template: "Complete template", future: { tools: true } },
  future_metadata: { tools: ["future"] },
};

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 17,
    url: "https://upstream.example/gateway/v1",
    key: "supplier-secret",
    proxyUrl: null,
    customHeaders: null,
    requestTimeoutNonStreamingMs: 250,
    ...overrides,
  } as Provider;
}

function source(overrides: Partial<Provider> = {}, headers?: Headers) {
  return prepareCodexModelCatalogSource(provider(overrides), "0.200.1", headers);
}

function makeBody(chunks: Array<Buffer | string>, failure?: Error) {
  return {
    on: vi.fn(),
    destroy: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      if (failure) throw failure;
    },
  };
}

function makeResponse(payload: unknown = { models: [nativeModel] }, statusCode = 200) {
  return {
    statusCode,
    headers: {} as Record<string, string>,
    body: makeBody([JSON.stringify(payload)]),
  };
}

function mockParsingElapsed(payload: string, elapsedMs: number, onParsed?: () => void) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const parse = JSON.parse;
  vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
    const result = parse(text, reviver);
    if (text === payload) {
      now = elapsedMs;
      onParsed?.();
    }
    return result;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createProxyAgent.mockReturnValue(null);
  request.mockResolvedValue(makeResponse());
});

afterEach(() => vi.useRealTimers());

describe("buildCodexModelCatalogUrl", () => {
  it.each([
    ["https://upstream.example", "/v1/models"],
    ["https://upstream.example/", "/v1/models"],
    ["https://upstream.example/v1", "/v1/models"],
    ["https://upstream.example/gateway", "/gateway/v1/models"],
    ["https://upstream.example/gateway/v1", "/gateway/v1/models"],
    ["https://upstream.example/gateway/v1/responses", "/gateway/v1/models"],
    ["https://upstream.example/gateway/responses/", "/gateway/models"],
    ["https://upstream.example/responses", "/models"],
  ])("keeps the inference endpoint prefix for %s", (base, path) => {
    expect(buildCodexModelCatalogUrl(base, "0.200.1")).toBe(
      `https://upstream.example${path}?client_version=0.200.1`
    );
  });

  it("removes existing query secrets and fragments while encoding client version", () => {
    const result = new URL(
      buildCodexModelCatalogUrl(
        "https://upstream.example/v1/responses?api_key=secret#fragment",
        "0.200.1+test&other=secret"
      )
    );
    expect([...result.searchParams]).toEqual([["client_version", "0.200.1+test&other=secret"]]);
    expect(result.hash).toBe("");
  });

  it.each(["invalid secret", "file:///tmp/models", "https://user:password@upstream.example"])(
    "rejects invalid URLs without exposing their content",
    (url) =>
      expect(() => buildCodexModelCatalogUrl(url, "0.200.1")).toThrow(
        new TypeError("Invalid model catalog URL")
      )
  );
});

describe("prepareCodexModelCatalogSource", () => {
  it("snapshots provider configuration and only exposes an opaque cache identity", () => {
    const configured = provider();
    const prepared = prepareCodexModelCatalogSource(configured, "0.200.1");
    expect(prepared.key).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared).toMatchObject({
      providerId: 17,
      clientVersion: "0.200.1",
      dynamicHeaders: false,
    });
    expect(prepared.provider).not.toBe(configured);
    configured.key = "changed-secret";
    expect(prepared.headers.Authorization).toBe("Bearer supplier-secret");
    expect(prepared.provider.key).toBe("supplier-secret");
  });

  it("normalizes header order for a stable identity", () => {
    expect(source({ customHeaders: { "x-b": "b", "x-a": "a" } }).key).toBe(
      source({ customHeaders: { "x-a": "a", "x-b": "b" } }).key
    );
  });

  it.each([
    { id: 18 },
    { key: "another-secret" },
    { url: "https://another.example/v1" },
    { proxyUrl: "https://proxy.example" },
    { proxyFallbackToDirect: true },
    { requestTimeoutNonStreamingMs: 100 },
    { customHeaders: { "x-static": "different" } },
    { updatedAt: new Date("2026-10-27T00:00:00Z") },
  ])("separates changed outbound configuration %j", (overrides) => {
    expect(source(overrides).key).not.toBe(source().key);
  });

  it("separates client versions and resolved dynamic headers", () => {
    expect(prepareCodexModelCatalogSource(provider(), "0.200.2").key).not.toBe(source().key);
    const customHeaders = { "x-client-ua": "{{header.user-agent}}" };
    const first = source({ customHeaders }, new Headers({ "user-agent": "first" }));
    const second = source({ customHeaders }, new Headers({ "user-agent": "second" }));
    expect(first.dynamicHeaders).toBe(true);
    expect(first.key).not.toBe(second.key);
    expect(source({ customHeaders }).dynamicHeaders).toBe(true);
  });

  it("resolves configured headers without forwarding credentials, cookies, or transport markers", () => {
    const prepared = source(
      {
        customHeaders: {
          "x-static": "configured",
          "x-client-ua": "{{header.user-agent}}",
          "x-missing": "{{header.missing}}",
          "x-session": "{{session.id}}",
          "x-sensitive": "{{header.authorization}}",
          Authorization: "replacement",
          "X-API-Key": "replacement",
          "X-Goog-Api-Key": "replacement",
          Host: "attacker.example",
          Cookie: "secret=cookie",
          Connection: "keep-alive",
          "Proxy-Authorization": "replacement",
          "Content-Length": "999",
          "Transfer-Encoding": "chunked",
          "X-Cch-Internal-Secret": "replacement",
          "x-cch-client-transport": "websocket",
          Upgrade: "websocket",
        },
      },
      new Headers({
        authorization: "Bearer client-secret",
        cookie: "secret=client-cookie",
        "user-agent": "example-client",
        "x-unrequested": "must-not-forward",
      })
    );
    expect(prepared.headers).toEqual({
      Authorization: "Bearer supplier-secret",
      "x-static": "configured",
      "x-client-ua": "example-client",
    });
    expect(source({ customHeaders: { Host: "{{header.user-agent}}" } }).dynamicHeaders).toBe(false);
  });

  it.each([
    [undefined, 4000],
    [0, 4000],
    [-1, 4000],
    [Number.NaN, 4000],
    [3999, 3999],
    [4000, 4000],
    [60000, 4000],
    [0.2, 1],
  ])("bounds provider timeout %s at %s milliseconds", (configured, expected) => {
    expect(source({ requestTimeoutNonStreamingMs: configured }).timeoutMs).toBe(expected);
  });
});

describe("fetchCodexModelCatalog", () => {
  it("returns complete native metadata with transfer metrics and releases the body", async () => {
    const response = makeResponse();
    request.mockResolvedValue(response);
    expect(await fetchCodexModelCatalog(source())).toEqual({
      ok: true,
      models: [nativeModel],
      bytes: Buffer.byteLength(JSON.stringify({ models: [nativeModel] })),
      elapsedMs: expect.any(Number),
    });
    expect(request).toHaveBeenCalledWith(
      source().url,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer supplier-secret" },
        headersTimeout: 250,
        bodyTimeout: 250,
        signal: expect.any(AbortSignal),
      })
    );
    expect(response.body.destroy).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts an actual empty native directory as a successful replacement", async () => {
    request.mockResolvedValue(makeResponse({ models: [] }));
    expect(await fetchCodexModelCatalog(source())).toMatchObject({
      ok: true,
      models: [],
      bytes: 13,
    });
  });

  it.each([null, [], { data: [{ id: "gpt-6.1-terra" }] }, { models: null }, { models: [{}] }])(
    "rejects non-native or wholly invalid metadata %j",
    async (payload) => {
      request.mockResolvedValue(makeResponse(payload));
      expect(await fetchCodexModelCatalog(source())).toEqual({
        ok: false,
        reason: "invalid_catalog",
      });
    }
  );

  it("retains valid siblings when individual upstream entries are malformed", async () => {
    request.mockResolvedValue(makeResponse({ models: [null, nativeModel, {}] }));
    expect(await fetchCodexModelCatalog(source())).toMatchObject({
      ok: true,
      models: [nativeModel],
    });
  });

  it.each([301, 302, 307, 308, 401, 403, 404, 500])(
    "isolates HTTP %s without following redirects or logging bodies",
    async (status) => {
      const response = makeResponse({ secret: "upstream-body-secret" }, status);
      request.mockResolvedValue(response);
      expect(await fetchCodexModelCatalog(source())).toEqual({
        ok: false,
        reason: `http_${status}`,
        status,
        ...(status === 401 || status === 403 ? { unauthorized: true } : {}),
      });
      expect(request).toHaveBeenCalledOnce();
      expect(response.body.destroy).toHaveBeenCalledOnce();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("upstream-body-secret");
    }
  );

  it.each(["reject", "pending"])("never waits for proxy cleanup: %s", async (kind) => {
    const agent = {
      destroy: vi.fn(() =>
        kind === "reject"
          ? Promise.reject(new Error("cleanup-secret"))
          : new Promise<void>(() => {})
      ),
    };
    createProxyAgent.mockReturnValue({ agent });
    const prepared = source({ proxyUrl: "https://proxy.example" });
    expect(await fetchCodexModelCatalog(prepared)).toMatchObject({ ok: true });
    expect(createProxyAgent).toHaveBeenCalledWith(prepared.provider, prepared.url);
    expect(request.mock.calls[0][1].dispatcher).toBe(agent);
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("cleanup-secret");
  });

  it("isolates proxy setup and connection failures without logging secrets or URLs", async () => {
    createProxyAgent.mockImplementationOnce(() => {
      throw new Error("proxy-secret");
    });
    expect(await fetchCodexModelCatalog(source())).toEqual({
      ok: false,
      reason: "proxy_configuration",
    });
    expect(request).not.toHaveBeenCalled();
    request.mockRejectedValue(new Error("https://upstream.example supplier-secret"));
    expect(await fetchCodexModelCatalog(source())).toEqual({ ok: false, reason: "network_error" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /proxy-secret|supplier-secret|upstream\.example/
    );
  });

  it.each(["proxy failure", "connect ECONNREFUSED", "getaddrinfo ENOTFOUND", "connect ETIMEDOUT"])(
    "retries directly after a configured proxy connection failure: %s",
    async (message) => {
      const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
      const response = makeResponse();
      createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
      request.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce(response);
      const prepared = source({ proxyUrl: "https://proxy.example", proxyFallbackToDirect: true });

      expect(await fetchCodexModelCatalog(prepared)).toMatchObject({
        ok: true,
        models: [nativeModel],
      });
      expect(request).toHaveBeenCalledTimes(2);
      const [proxied, direct] = request.mock.calls.map((call) => call[1]);
      expect(proxied.dispatcher).toBe(agent);
      expect(direct).not.toHaveProperty("dispatcher");
      expect(direct).toMatchObject({
        method: "GET",
        headers: prepared.headers,
        signal: proxied.signal,
        headersTimeout: prepared.timeoutMs,
        bodyTimeout: prepared.timeoutMs,
      });
      expect(response.body.destroy).toHaveBeenCalledOnce();
      expect(agent.destroy).toHaveBeenCalledOnce();
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.each([
    { configured: true, fallbackToDirect: false, message: "connect ECONNREFUSED" },
    { configured: false, fallbackToDirect: true, message: "connect ECONNREFUSED" },
    { configured: true, fallbackToDirect: true, message: "invalid onRequestStart method" },
  ])("does not retry unrelated failures or an unavailable fallback: %j", async (options) => {
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    createProxyAgent.mockReturnValue(options.configured ? { agent, ...options } : null);
    request.mockRejectedValue(new Error(options.message));
    expect(
      await fetchCodexModelCatalog(
        source({
          proxyUrl: options.configured ? "https://proxy.example" : null,
          proxyFallbackToDirect: options.fallbackToDirect,
        })
      )
    ).toEqual({ ok: false, reason: "network_error" });
    expect(request).toHaveBeenCalledOnce();
    expect(agent.destroy).toHaveBeenCalledTimes(options.configured ? 1 : 0);
  });

  it("does not bypass an invalid proxy configuration when fallback is enabled", async () => {
    createProxyAgent.mockImplementation(() => {
      throw new Error("proxy-configuration-secret");
    });
    expect(
      await fetchCodexModelCatalog(source({ proxyUrl: "invalid", proxyFallbackToDirect: true }))
    ).toEqual({ ok: false, reason: "proxy_configuration" });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("proxy-configuration-secret");
  });

  it("returns a bounded failure when the direct retry also fails", async () => {
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
    request.mockRejectedValue(new Error("proxy supplier-secret ECONNREFUSED"));
    expect(await fetchCodexModelCatalog(source())).toEqual({ ok: false, reason: "network_error" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("supplier-secret");
  });

  it.each([401, 403, 500])("does not retry HTTP %s through a direct connection", async (status) => {
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    const response = makeResponse(undefined, status);
    createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
    request.mockResolvedValue(response);
    expect(await fetchCodexModelCatalog(source())).toMatchObject({
      ok: false,
      reason: `http_${status}`,
      status,
    });
    expect(request).toHaveBeenCalledOnce();
    expect(response.body.destroy).toHaveBeenCalledOnce();
    expect(agent.destroy).toHaveBeenCalledOnce();
  });

  it.each(["invalid_json", "network_error"])(
    "does not retry a response body failure: %s",
    async (reason) => {
      const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
      const body =
        reason === "invalid_json"
          ? makeBody(["invalid proxy JSON"])
          : makeBody(["{"], new Error("proxy ECONNREFUSED"));
      createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
      request.mockResolvedValue({ statusCode: 200, headers: {}, body });
      expect(await fetchCodexModelCatalog(source())).toEqual({ ok: false, reason });
      expect(request).toHaveBeenCalledOnce();
      expect(body.destroy).toHaveBeenCalledOnce();
      expect(agent.destroy).toHaveBeenCalledOnce();
    }
  );

  it.each(["timeout", "aborted"])("does not retry a proxy request after %s", async (reason) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
    request.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () => reject(new Error("proxy ECONNREFUSED")))
        )
    );
    const pending = fetchCodexModelCatalog(source(), controller.signal);
    if (reason === "aborted") controller.abort();
    else await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual({ ok: false, reason });
    expect(request).toHaveBeenCalledOnce();
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the original deadline while the direct retry is pending", async () => {
    vi.useFakeTimers();
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
    request
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error("proxy ECONNREFUSED")), 60)
          )
      )
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(new Error("direct aborted")))
          )
      );
    const pending = fetchCodexModelCatalog(source({ requestTimeoutNonStreamingMs: 100 }));
    await vi.advanceTimersByTimeAsync(60);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(39);
    expect(request.mock.calls[1][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry when the monotonic deadline expired before its timer ran", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    createProxyAgent.mockReturnValue({ agent, fallbackToDirect: true });
    request.mockImplementationOnce(async () => {
      elapsed = 100;
      throw new Error("proxy ECONNREFUSED");
    });
    expect(await fetchCodexModelCatalog(source({ requestTimeoutNonStreamingMs: 100 }))).toEqual({
      ok: false,
      reason: "timeout",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers from an actual refused proxy connection through the same direct upstream", async () => {
    const actual = await vi.importActual<typeof import("undici")>("undici");
    const directAgent = new actual.Agent();
    const closedProxy = createServer();
    await new Promise<void>((resolve) => closedProxy.listen(0, "127.0.0.1", resolve));
    const proxyUrl = `http://127.0.0.1:${(closedProxy.address() as AddressInfo).port}`;
    const proxyAgent = new actual.ProxyAgent(proxyUrl);
    createProxyAgent.mockReturnValue({ agent: proxyAgent, fallbackToDirect: true });
    request.mockImplementation((url, options) =>
      actual.request(url, { ...options, dispatcher: options.dispatcher ?? directAgent })
    );
    let upstreamRequests = 0;
    let authorization: string | undefined;
    let path: string | undefined;
    const server = createServer((req, res) => {
      upstreamRequests++;
      authorization = req.headers.authorization;
      path = req.url;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [nativeModel] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => closedProxy.close(() => resolve()));
    try {
      const port = (server.address() as AddressInfo).port;
      expect(
        await fetchCodexModelCatalog(
          source({
            url: `http://127.0.0.1:${port}/gateway/v1`,
            proxyUrl,
            proxyFallbackToDirect: true,
            requestTimeoutNonStreamingMs: 1000,
          })
        )
      ).toMatchObject({ ok: true, models: [nativeModel] });
      expect(request).toHaveBeenCalledTimes(2);
      expect(upstreamRequests).toBe(1);
      expect(authorization).toBe("Bearer supplier-secret");
      expect(path).toBe("/gateway/v1/models?client_version=0.200.1");
    } finally {
      await proxyAgent.destroy();
      await directAgent.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects malformed JSON and stream failures and always destroys their bodies", async () => {
    const invalid = makeBody(["invalid JSON with supplier-secret"]);
    request.mockResolvedValueOnce({ statusCode: 200, headers: {}, body: invalid });
    expect(await fetchCodexModelCatalog(source())).toEqual({ ok: false, reason: "invalid_json" });
    expect(invalid.destroy).toHaveBeenCalledOnce();
    const broken = makeBody(["{"], new Error("supplier-secret"));
    request.mockResolvedValueOnce({ statusCode: 200, headers: {}, body: broken });
    expect(await fetchCodexModelCatalog(source())).toEqual({ ok: false, reason: "network_error" });
    expect(broken.destroy).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("supplier-secret");
  });

  it("rejects oversized declared and chunked bodies", async () => {
    const declared = makeResponse();
    declared.headers["content-length"] = String(CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES + 1);
    request.mockResolvedValueOnce(declared);
    expect(await fetchCodexModelCatalog(source())).toEqual({
      ok: false,
      reason: "payload_too_large",
    });
    const body = makeBody([Buffer.alloc(CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES), "x"]);
    request.mockResolvedValueOnce({ statusCode: 200, headers: {}, body });
    expect(await fetchCodexModelCatalog(source())).toEqual({
      ok: false,
      reason: "payload_too_large",
    });
    expect(declared.body.destroy).toHaveBeenCalledOnce();
    expect(body.destroy).toHaveBeenCalledOnce();
  });

  it("accepts the 4 MiB upstream boundary independently of the publishing limit", async () => {
    const json = JSON.stringify({ models: [nativeModel] });
    const body = makeBody([
      Buffer.from(json),
      Buffer.alloc(CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES - Buffer.byteLength(json), " "),
    ]);
    request.mockResolvedValue({ statusCode: 200, headers: {}, body });
    expect(await fetchCodexModelCatalog(source())).toMatchObject({
      ok: true,
      models: [nativeModel],
      bytes: CODEX_MODEL_CATALOG_UPSTREAM_MAX_BYTES,
    });
  });

  it("honors a pre-aborted caller without starting network work", async () => {
    expect(await fetchCodexModelCatalog(source(), AbortSignal.abort())).toEqual({
      ok: false,
      reason: "aborted",
    });
    expect(request).not.toHaveBeenCalled();
    expect(createProxyAgent).not.toHaveBeenCalled();
  });

  it.each(["timeout", "aborted"])("cancels in-flight headers on %s", async (reason) => {
    vi.useFakeTimers();
    request.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new Error("cancel-secret")));
        })
    );
    const controller = new AbortController();
    const pending = fetchCodexModelCatalog(
      source({ requestTimeoutNonStreamingMs: 0 }),
      controller.signal
    );
    await vi.advanceTimersByTimeAsync(3999);
    expect(request.mock.calls[0][1].signal.aborted).toBe(false);
    if (reason === "aborted") controller.abort();
    else await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active throughout a slow body", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    request.mockImplementation(async (_url, options) => ({
      statusCode: 200,
      headers: {},
      body: {
        on: vi.fn(),
        destroy,
        async *[Symbol.asyncIterator]() {
          yield "{";
          await new Promise((_resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(new Error("aborted")))
          );
        },
      },
    }));
    const pending = fetchCodexModelCatalog(source({ requestTimeoutNonStreamingMs: 25 }));
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
    expect(destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { elapsedMs: 99, ok: true },
    { elapsedMs: 100, ok: false },
    { elapsedMs: 101, ok: false },
  ])(
    "checks the deadline after synchronous parsing takes $elapsedMs ms",
    async ({ elapsedMs, ok }) => {
      const response = makeResponse();
      const payload = JSON.stringify({ models: [nativeModel] });
      const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
      request.mockResolvedValue(response);
      createProxyAgent.mockReturnValue({ agent });
      mockParsingElapsed(payload, elapsedMs);

      const result = await fetchCodexModelCatalog(source({ requestTimeoutNonStreamingMs: 100 }));

      expect(request.mock.calls[0][1].signal.aborted).toBe(false);
      expect(response.body.destroy).toHaveBeenCalledOnce();
      expect(agent.destroy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      if (ok) {
        expect(result).toMatchObject({ ok: true, models: [nativeModel], elapsedMs });
      } else {
        expect(result).toEqual({ ok: false, reason: "timeout" });
      }
    }
  );

  it("prioritizes caller cancellation over elapsed timeout during synchronous parsing", async () => {
    const controller = new AbortController();
    const response = makeResponse();
    const payload = JSON.stringify({ models: [nativeModel] });
    const agent = { destroy: vi.fn().mockResolvedValue(undefined) };
    request.mockResolvedValue(response);
    createProxyAgent.mockReturnValue({ agent });
    mockParsingElapsed(payload, 101, () => controller.abort());

    const result = await fetchCodexModelCatalog(
      source({ requestTimeoutNonStreamingMs: 100 }),
      controller.signal
    );

    expect(result).toEqual({ ok: false, reason: "aborted" });
    expect(response.body.destroy).toHaveBeenCalledOnce();
    expect(agent.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a body that completes after caller cancellation even when transport ignores abort", async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => {
      controller.abort();
      return makeResponse();
    });
    expect(await fetchCodexModelCatalog(source(), controller.signal)).toEqual({
      ok: false,
      reason: "aborted",
    });
  });

  it("uses the actual transport without forwarding credentials to a redirect destination", async () => {
    const actual = await vi.importActual<typeof import("undici")>("undici");
    const agent = new actual.Agent();
    request.mockImplementation((url, options) =>
      actual.request(url, { ...options, dispatcher: agent })
    );
    let destinationRequests = 0;
    let authorization: string | undefined;
    const server = createServer((req, res) => {
      if (req.url === "/unexpected") destinationRequests += 1;
      authorization = req.headers.authorization;
      res.writeHead(302, {
        location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/unexpected`,
      });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      expect(await fetchCodexModelCatalog(source({ url: `http://127.0.0.1:${port}` }))).toEqual({
        ok: false,
        reason: "http_302",
        status: 302,
      });
      expect(destinationRequests).toBe(0);
      expect(authorization).toBe("Bearer supplier-secret");
    } finally {
      await agent.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reads a complete chunked native directory with the actual transport", async () => {
    const actual = await vi.importActual<typeof import("undici")>("undici");
    const agent = new actual.Agent();
    request.mockImplementation((url, options) =>
      actual.request(url, { ...options, dispatcher: agent })
    );
    let path: string | undefined;
    const server = createServer((req, res) => {
      path = req.url;
      res.writeHead(200, { "content-type": "application/json" });
      const json = JSON.stringify({ models: [nativeModel] });
      res.write(json.slice(0, 20));
      res.end(json.slice(20));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      expect(
        await fetchCodexModelCatalog(
          source({ url: `http://127.0.0.1:${port}/gateway/v1/responses?discarded=true` })
        )
      ).toMatchObject({ ok: true, models: [nativeModel] });
      expect(path).toBe("/gateway/v1/models?client_version=0.200.1");
    } finally {
      await agent.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
