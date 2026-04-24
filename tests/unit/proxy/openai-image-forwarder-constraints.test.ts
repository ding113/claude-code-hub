import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import {
  buildOpenAIImageLogicalBody,
  parseOpenAIImageMultipartMetadata,
  serializeOpenAIImageMultipartRequest,
  syncOpenAIImageMultipartFromLogicalBody,
  type OpenAIImageRequestMetadata,
} from "@/app/v1/_lib/proxy/openai-image-compat";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import type { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    applyFinal: vi.fn(async () => {}),
  },
}));

function createProvider({
  name,
  url,
  modelRedirects,
}: {
  name: string;
  url: string;
  modelRedirects?: Array<{ matchType: "exact"; source: string; target: string }>;
}): Provider {
  return {
    id: 1,
    name,
    providerType: "openai-compatible",
    url,
    key: "upstream-key",
    preserveClientIp: false,
    priority: 0,
    costMultiplier: 1,
    maxRetryAttempts: 1,
    mcpPassthroughType: "minimax",
    mcpPassthroughUrl: "https://mcp.example.com",
    modelRedirects,
  } as unknown as Provider;
}

async function createImageMetadata(): Promise<OpenAIImageRequestMetadata> {
  const formData = new FormData();
  formData.append("model", "source-model");
  formData.append("prompt", "edit this");
  formData.append(
    "image[]",
    new File([new Uint8Array([1, 2, 3])], "image.png", {
      type: "image/png",
    })
  );

  const request = new Request("https://proxy.example.com/v1/images/edits", {
    method: "POST",
    body: formData,
  });

  const metadata = await parseOpenAIImageMultipartMetadata(
    request,
    "/v1/images/edits",
    request.headers.get("content-type")
  );

  if (!metadata) {
    throw new Error("Expected multipart metadata");
  }

  return metadata;
}

function createSession({
  pathname,
  body,
  model,
  imageRequestMetadata,
}: {
  pathname: string;
  body: Record<string, unknown>;
  model: string | null;
  imageRequestMetadata?: OpenAIImageRequestMetadata | null;
}): ProxySession {
  const headers = new Headers({
    "content-type": "application/json",
    authorization: "Bearer proxy-user-key",
  });
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL(`https://proxy.example.com${pathname}`),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model,
      log: JSON.stringify(body),
      message: body,
      imageRequestMetadata: imageRequestMetadata ?? null,
    },
    userAgent: "OpenAITest/1.0",
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "openai",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    specialSettings: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    forwardedRequestBody: null,
    endpointPolicy: resolveEndpointPolicy(pathname),
    setCacheTtlResolved: vi.fn(),
    getCacheTtlResolved: vi.fn(() => null),
    getCurrentModel: vi.fn(() => model),
    clientRequestsContext1m: vi.fn(() => false),
    setContext1mApplied: vi.fn(),
    getContext1mApplied: vi.fn(() => false),
    getGroupCostMultiplier: vi.fn(() => 1),
    getEndpointPolicy: vi.fn(() => resolveEndpointPolicy(pathname)),
    isHeaderModified: vi.fn(() => false),
    shouldPersistSessionDebugArtifacts: vi.fn(() => false),
    addSpecialSetting: vi.fn(),
    getSpecialSettings: vi.fn(() => []),
  });

  return session as ProxySession;
}

describe("ProxyForwarder - openai image constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks invalid GPT generations requests before any upstream fetch", async () => {
    const provider = createProvider({
      name: "Regular OpenAI",
      url: "https://openai.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/generations",
      model: "gpt-image-1.5",
      body: {
        model: "gpt-image-1.5",
        prompt: "otter",
        response_format: "url",
      },
    });

    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode");

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await expect(doForward(session, provider, provider.url)).rejects.toMatchObject<
      Partial<ProxyError>
    >({
      message: expect.stringContaining("response_format"),
      statusCode: 400,
    });
    expect(fetchWithoutAutoDecode).not.toHaveBeenCalled();
  });

  it("rewrites multipart edits model redirects and rebuilds multipart content-type", async () => {
    const provider = createProvider({
      name: "Regular OpenAI",
      url: "https://openai.example.com/openai",
      modelRedirects: [{ matchType: "exact", source: "source-model", target: "target-model" }],
    });
    const session = createSession({
      pathname: "/v1/images/edits",
      model: "source-model",
      body: {
        model: "source-model",
        prompt: "edit this",
      },
      imageRequestMetadata: await createImageMetadata(),
    });

    let capturedHeaders: Headers | null = null;
    let capturedBody: BodyInit | null = null;

    vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode").mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        capturedHeaders = init.headers as Headers;
        capturedBody = init.body ?? null;
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
    );

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedHeaders?.get("content-type")).toContain("multipart/form-data");
    const bodyText = new TextDecoder().decode(new Uint8Array(capturedBody as ArrayBuffer));
    expect(bodyText).toContain('name="model"');
    expect(bodyText).toContain("target-model");
  });

  it("strips response_format for YunAI Azure generations compatibility", async () => {
    const provider = createProvider({
      name: "YunAI Azure",
      url: "https://yunai.azure.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/generations",
      model: null,
      body: {
        prompt: "otter",
        response_format: "url",
      },
    });

    let capturedBody = "";

    vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode").mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        capturedBody = String(init.body ?? "");
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedBody).toContain('"prompt":"otter"');
    expect(capturedBody).not.toContain("response_format");
  });

  it("strips response_format for YunAI Azure even when GPT model is explicit", async () => {
    const provider = createProvider({
      name: "YunAI Azure",
      url: "https://yunai.azure.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/generations",
      model: "gpt-image-1.5",
      body: {
        model: "gpt-image-1.5",
        prompt: "otter",
        response_format: "url",
      },
    });

    let capturedBody = "";

    vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode").mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        capturedBody = String(init.body ?? "");
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    );

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedBody).toContain('"model":"gpt-image-1.5"');
    expect(capturedBody).not.toContain("response_format");
  });

  it("creates isolated multipart sidecars for hedge shadow sessions", async () => {
    const provider = createProvider({
      name: "Regular OpenAI",
      url: "https://openai.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/edits",
      model: "source-model",
      body: {
        model: "source-model",
        prompt: "edit this",
      },
      imageRequestMetadata: await createImageMetadata(),
    });

    const { createStreamingShadowSession } = ProxyForwarder as unknown as {
      createStreamingShadowSession: (session: ProxySession, provider: Provider) => ProxySession;
    };

    const shadow = createStreamingShadowSession(session, provider);
    shadow.request.message.prompt = "shadow prompt";
    shadow.getOpenAIImageRequestMetadata()!.parts[0] = {
      name: "model",
      kind: "text",
      value: "shadow-model",
    };
    shadow.getOpenAIImageRequestMetadata()!.model = "shadow-model";

    expect(session.request.message.prompt).toBe("edit this");
    expect(session.getOpenAIImageRequestMetadata()!.model).toBe("source-model");
  });

  it("treats multipart stream=true as a real streaming hedge candidate", async () => {
    const metadata = await createImageMetadata();
    metadata.parts.splice(2, 0, { name: "stream", kind: "text", value: "true" });
    const session = createSession({
      pathname: "/v1/images/edits",
      model: "source-model",
      body: {
        model: "source-model",
        prompt: "edit this",
        stream: true,
      },
      imageRequestMetadata: metadata,
    });
    session.provider = {
      ...(createProvider({
        name: "Regular OpenAI",
        url: "https://openai.example.com/openai",
      }) as Provider),
      firstByteTimeoutStreamingMs: 100,
    };

    const { shouldUseStreamingHedge } = ProxyForwarder as unknown as {
      shouldUseStreamingHedge: (session: ProxySession) => boolean;
    };

    expect(shouldUseStreamingHedge(session)).toBe(true);
  });

  it("strips underscore-prefixed multipart text fields before upstream forwarding", async () => {
    const metadata = await createImageMetadata();
    metadata.parts.splice(2, 0, {
      name: "_internal",
      kind: "text",
      value: "should-not-leak",
    });
    const provider = createProvider({
      name: "Regular OpenAI",
      url: "https://openai.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/edits",
      model: "source-model",
      body: {
        model: "source-model",
        prompt: "edit this",
        _internal: "should-not-leak",
      },
      imageRequestMetadata: metadata,
    });

    let capturedBody = "";

    vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode").mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        capturedBody = new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer));
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
    );

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedBody).toContain('name="prompt"');
    expect(capturedBody).not.toContain("_internal");
    expect(capturedBody).not.toContain("should-not-leak");
  });

  it("drops private multipart file parts before upstream forwarding", async () => {
    const metadata = await createImageMetadata();
    metadata.parts.push({
      name: "_internal",
      kind: "file",
      value: new File([new Uint8Array([9, 9, 9])], "secret.bin", {
        type: "application/octet-stream",
      }),
    });
    const provider = createProvider({
      name: "Regular OpenAI",
      url: "https://openai.example.com/openai",
    });
    const session = createSession({
      pathname: "/v1/images/edits",
      model: "source-model",
      body: {
        model: "source-model",
        prompt: "edit this",
        _internal: "[file]",
      },
      imageRequestMetadata: metadata,
    });

    let capturedBody = "";

    vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode").mockImplementationOnce(
      async (_url: string, init: RequestInit) => {
        capturedBody = new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer));
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
    );

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedBody).not.toContain('name="_internal"');
    expect(capturedBody).not.toContain("secret.bin");
  });

  it("drops mask file parts when filters remove the logical mask field", async () => {
    const metadata = await createImageMetadata();
    metadata.parts.push({
      name: "mask",
      kind: "file",
      value: new File([new Uint8Array([7, 7, 7])], "mask.png", { type: "image/png" }),
    });
    const logicalBody = buildOpenAIImageLogicalBody(metadata);
    delete logicalBody.mask;

    syncOpenAIImageMultipartFromLogicalBody(metadata, logicalBody);
    const serialized = await serializeOpenAIImageMultipartRequest(metadata);
    const bodyText = new TextDecoder().decode(new Uint8Array(serialized.body));
    expect(bodyText).not.toContain('name="mask"');
  });
});
