import type { ResponseRequest } from "@/app/v1/_lib/codex/types/response";
import type { ProviderChainItem } from "@/types/message";
import type { Provider, ProviderType } from "@/types/provider";
import {
  ResponsesWebSocketSessionState,
  type StoreFalseCacheDebugSnapshot,
  type StoreFalseCacheRefusalReason,
} from "./responses-websocket-session-state";

export type ResponsesWebSocketModelSource = "body" | "query";

export type ResponsesWebSocketTransportFields = {
  stream?: boolean;
  background?: boolean;
};

export type ResponsesWebSocketCreateFrame = {
  type: "response.create";
  body: Partial<ResponseRequest> & Record<string, unknown>;
};

export type ParsedResponsesWebSocketCreate = {
  type: "response.create";
  upstreamBody: ResponseRequest & Record<string, unknown>;
  transport: ResponsesWebSocketTransportFields;
  modelSource: ResponsesWebSocketModelSource;
};

export type ResponsesWebSocketProtocolErrorCode =
  | "protocol_not_implemented"
  | "invalid_json"
  | "unsupported_event_type"
  | "binary_frame_not_supported";

export type ResponsesWebSocketProtocolErrorEvent = {
  type: "error";
  error: {
    type: ResponsesWebSocketProtocolErrorCode;
    code: ResponsesWebSocketProtocolErrorCode;
    message: string;
  };
};

export type ResponsesWebSocketJsonEvent = { type: string } & Record<string, unknown>;

export type ResponsesWebSocketExecutorContext = {
  requestUrl: string | URL;
  headers?: Headers;
  clientAbortSignal?: AbortSignal | null;
  connectionId?: string;
  sessionState: ResponsesWebSocketSessionState;
};

export type ResponsesWebSocketExecutionMetadata = {
  queueWaitMs: number;
  storeFalseCacheHit: boolean;
  storeFalseCacheRefusalReason: StoreFalseCacheRefusalReason | null;
  storeFalseCacheDebug: StoreFalseCacheDebugSnapshot | null;
};

export type ResponsesWebSocketExecutorInput = {
  id: string;
  parsed: ParsedResponsesWebSocketCreate;
  upstreamBody: ResponseRequest & Record<string, unknown>;
  transport: ResponsesWebSocketTransportFields;
  modelSource: ResponsesWebSocketModelSource;
  requestUrl: string | URL;
  queueWaitMs: number;
  metadata: ResponsesWebSocketExecutionMetadata;
  executionContext: ResponsesWebSocketExecutorContext;
};

export type ResponsesWebSocketExecutorResult =
  | ResponsesWebSocketJsonEvent
  | readonly ResponsesWebSocketJsonEvent[]
  | AsyncIterable<ResponsesWebSocketJsonEvent>;

export type ResponsesWebSocketRequestExecutor = (
  input: ResponsesWebSocketExecutorInput
) => ResponsesWebSocketExecutorResult | Promise<ResponsesWebSocketExecutorResult>;

export type ResponsesWebSocketEventSink = (
  event: ResponsesWebSocketJsonEvent
) => void | Promise<void>;

export type ResponsesWebSocketInboundHandlerOptions = {
  requestUrl: string | URL;
  executor: ResponsesWebSocketRequestExecutor;
  eventSink?: ResponsesWebSocketEventSink;
  createRequestId?: () => string;
  executionContext?: Partial<ResponsesWebSocketExecutorContext>;
  sessionState?: ResponsesWebSocketSessionState;
  now?: () => number;
};

export class ResponsesWebSocketProtocolError extends Error {
  constructor(
    public readonly code: ResponsesWebSocketProtocolErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ResponsesWebSocketProtocolError";
  }
}

export type ParseResponsesWebSocketClientFrameOptions = {
  requestUrl: string | URL;
};

export function parseResponsesWebSocketClientFrame(
  frame: string | Uint8Array,
  options: ParseResponsesWebSocketClientFrameOptions
): ParsedResponsesWebSocketCreate {
  if (frame instanceof Uint8Array) {
    throw new ResponsesWebSocketProtocolError(
      "binary_frame_not_supported",
      "Binary WebSocket frames are not supported"
    );
  }

  const payload = parseJsonObject(frame);
  if (payload.type !== "response.create") {
    throw new ResponsesWebSocketProtocolError(
      "unsupported_event_type",
      "Unsupported Responses WebSocket client event type"
    );
  }

  const body = getResponseCreateBody(payload);
  const { upstreamBody, transport } = splitTransportFields(body);
  const queryModel = parseResponsesWebSocketRequestUrl(options.requestUrl).searchParams.get(
    "model"
  );
  let modelSource: ResponsesWebSocketModelSource = "body";

  if (typeof upstreamBody.model !== "string" && queryModel) {
    upstreamBody.model = queryModel;
    modelSource = "query";
  }

  return {
    type: "response.create",
    upstreamBody: upstreamBody as ResponseRequest & Record<string, unknown>,
    transport,
    modelSource,
  };
}

export function formatResponsesWebSocketProtocolErrorEvent(
  error: ResponsesWebSocketProtocolError
): ResponsesWebSocketProtocolErrorEvent {
  return {
    type: "error",
    error: {
      type: error.code,
      code: error.code,
      message: error.message,
    },
  };
}

export class ResponsesWebSocketInboundHandler {
  private readonly requestUrl: string | URL;
  private readonly executor: ResponsesWebSocketRequestExecutor;
  private readonly eventSink?: ResponsesWebSocketEventSink;
  private readonly createRequestId: () => string;
  public readonly executionContext: ResponsesWebSocketExecutorContext;
  private readonly queue: ResponsesWebSocketRequestQueue<ResponsesWebSocketJsonEvent[]>;
  private requestSequence = 0;

  constructor(options: ResponsesWebSocketInboundHandlerOptions) {
    this.requestUrl = options.requestUrl;
    this.executor = options.executor;
    this.eventSink = options.eventSink;
    this.createRequestId = options.createRequestId ?? (() => this.nextRequestId());
    const sessionState =
      options.executionContext?.sessionState ??
      options.sessionState ??
      new ResponsesWebSocketSessionState({ now: options.now });
    this.executionContext = {
      requestUrl: options.requestUrl,
      sessionState,
      ...options.executionContext,
    };
    this.queue = new ResponsesWebSocketRequestQueue(
      (request) => this.executeQueuedRequest(request),
      { now: options.now }
    );
  }

  get inFlightCount(): number {
    return this.queue.inFlightCount;
  }

  get pendingCount(): number {
    return this.queue.pendingCount;
  }

  async handleFrame(frame: string | Uint8Array): Promise<ResponsesWebSocketJsonEvent[]> {
    if (frame instanceof Uint8Array) {
      return this.emitProtocolError(
        new ResponsesWebSocketProtocolError(
          "binary_frame_not_supported",
          "Binary WebSocket frames are not supported"
        )
      );
    }

    try {
      const events = await this.queue.enqueue({
        id: this.createRequestId(),
        frame,
        requestUrl: this.requestUrl,
      });
      await this.emitEvents(events);
      return events;
    } catch (error) {
      if (error instanceof ResponsesWebSocketProtocolError) {
        return this.emitProtocolError(error);
      }

      throw error;
    }
  }

  dispose(reason?: Error): void {
    this.queue.dispose(reason);
    this.executionContext.sessionState.clear();
  }

  private async executeQueuedRequest(
    request: ResponsesWebSocketQueuedRequest
  ): Promise<ResponsesWebSocketJsonEvent[]> {
    const parsed = parseResponsesWebSocketClientFrame(request.frame, {
      requestUrl: request.requestUrl,
    });
    const metadata: ResponsesWebSocketExecutionMetadata = {
      queueWaitMs: request.queueWaitMs,
      storeFalseCacheHit: false,
      storeFalseCacheRefusalReason: null,
      storeFalseCacheDebug: this.executionContext.sessionState.getStoreFalseCacheDebugSnapshot(),
    };

    // WebSocket 入站层只做协议解析和 FIFO 调度；认证、限流、供应商选择
    // 必须由注入的 executor 复用既有 ProxySession/GuardPipeline 语义完成。
    const result = await this.executor({
      id: request.id,
      parsed,
      upstreamBody: parsed.upstreamBody,
      transport: parsed.transport,
      modelSource: parsed.modelSource,
      requestUrl: request.requestUrl,
      queueWaitMs: request.queueWaitMs,
      metadata,
      executionContext: this.executionContext,
    });

    return collectResponsesWebSocketEvents(result);
  }

  private async emitProtocolError(
    error: ResponsesWebSocketProtocolError
  ): Promise<ResponsesWebSocketJsonEvent[]> {
    const event = formatResponsesWebSocketProtocolErrorEvent(error);
    await this.emitEvents([event]);
    return [event];
  }

  private async emitEvents(events: readonly ResponsesWebSocketJsonEvent[]): Promise<void> {
    if (!this.eventSink) return;

    for (const event of events) {
      await this.eventSink(event);
    }
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `responses_ws_${this.requestSequence}`;
  }
}

async function collectResponsesWebSocketEvents(
  result: ResponsesWebSocketExecutorResult
): Promise<ResponsesWebSocketJsonEvent[]> {
  if (isResponsesWebSocketJsonEventArray(result)) return [...result];

  if (isAsyncIterable(result)) {
    const events: ResponsesWebSocketJsonEvent[] = [];
    for await (const event of result) {
      events.push(event);
    }
    return events;
  }

  return [result];
}

function isResponsesWebSocketJsonEventArray(
  value: ResponsesWebSocketExecutorResult
): value is readonly ResponsesWebSocketJsonEvent[] {
  return Array.isArray(value);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<ResponsesWebSocketJsonEvent> {
  if (!isRecord(value)) return false;

  const asyncIterable = value as { [Symbol.asyncIterator]?: unknown };
  return typeof asyncIterable[Symbol.asyncIterator] === "function";
}

function parseJsonObject(frame: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(frame);
    if (isRecord(payload)) return payload;
  } catch {
    throw new ResponsesWebSocketProtocolError("invalid_json", "Invalid JSON text frame");
  }

  throw new ResponsesWebSocketProtocolError(
    "unsupported_event_type",
    "Unsupported Responses WebSocket client event type"
  );
}

function parseResponsesWebSocketRequestUrl(requestUrl: string | URL): URL {
  return new URL(requestUrl.toString(), "http://localhost");
}

function getResponseCreateBody(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.body)) return payload.body;

  const topLevelBody = { ...payload };
  delete topLevelBody.type;
  return topLevelBody;
}

function splitTransportFields(body: Record<string, unknown>): {
  upstreamBody: Record<string, unknown>;
  transport: ResponsesWebSocketTransportFields;
} {
  const { stream, background, ...upstreamBody } = body;
  const transport: ResponsesWebSocketTransportFields = {};

  if (typeof stream === "boolean") transport.stream = stream;
  if (typeof background === "boolean") transport.background = background;

  return { upstreamBody, transport };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ResponsesWebSocketQueueInput = {
  id: string;
  frame: string;
  requestUrl: string | URL;
};

export type ResponsesWebSocketQueuedRequest = ResponsesWebSocketQueueInput & {
  queueWaitMs: number;
};

export type ResponsesWebSocketQueueHandler<T> = (
  request: ResponsesWebSocketQueuedRequest
) => Promise<T>;

export type ResponsesWebSocketDecisionMetadata = {
  clientTransport: "websocket";
  upstreamWsAttempted: boolean;
  upstreamWsConnected: boolean;
  downgradedToHttp: boolean;
  downgradeReason?: string;
  queueWaitMs?: number;
  storeFalseCacheHit?: boolean;
  storeFalseCacheRefusalReason?: string | null;
  upstreamWsUnsupportedCacheHit?: boolean;
};

export type ResponsesWebSocketDecisionChainSession = {
  addProviderToChain: (
    provider: Provider,
    metadata: ResponsesWebSocketDecisionMetadata & Record<string, unknown>
  ) => void;
  getProviderChain: () => ProviderChainItem[];
  getLastSelectionContext?: () => ProviderChainItem["decisionContext"] | undefined;
};

export type ResponsesWebSocketDecisionChainObservationInput = {
  session: ResponsesWebSocketDecisionChainSession;
  provider: Provider;
  statusCode?: number;
  metadata: ResponsesWebSocketDecisionMetadata;
};

export function recordResponsesWebSocketDecisionChainObservation(
  input: ResponsesWebSocketDecisionChainObservationInput
): ProviderChainItem & ResponsesWebSocketDecisionMetadata {
  const metadata = sanitizeResponsesWebSocketDecisionMetadata(input.metadata);
  const decisionContext = buildResponsesWebSocketDecisionContext(input.session, metadata);

  input.session.addProviderToChain(input.provider, {
    ...metadata,
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    ...(decisionContext ? { decisionContext } : {}),
  });

  const chain = input.session.getProviderChain();
  const entry = chain[chain.length - 1];
  if (!entry) {
    throw new ResponsesWebSocketProtocolError(
      "protocol_not_implemented",
      "Responses WebSocket decision-chain entry was not recorded"
    );
  }

  return { ...entry, ...metadata } as ProviderChainItem & ResponsesWebSocketDecisionMetadata;
}

function sanitizeResponsesWebSocketDecisionMetadata(
  metadata: ResponsesWebSocketDecisionMetadata
): ResponsesWebSocketDecisionMetadata {
  const sanitized: ResponsesWebSocketDecisionMetadata = {
    clientTransport: "websocket",
    upstreamWsAttempted: metadata.upstreamWsAttempted === true,
    upstreamWsConnected: metadata.upstreamWsConnected === true,
    downgradedToHttp: metadata.downgradedToHttp === true,
  };

  if (typeof metadata.downgradeReason === "string" && metadata.downgradeReason.length > 0) {
    sanitized.downgradeReason = metadata.downgradeReason;
  }
  if (typeof metadata.queueWaitMs === "number" && Number.isFinite(metadata.queueWaitMs)) {
    sanitized.queueWaitMs = Math.max(0, metadata.queueWaitMs);
  }
  if (typeof metadata.storeFalseCacheHit === "boolean") {
    sanitized.storeFalseCacheHit = metadata.storeFalseCacheHit;
  }
  if (metadata.storeFalseCacheRefusalReason !== undefined) {
    sanitized.storeFalseCacheRefusalReason = metadata.storeFalseCacheRefusalReason;
  }
  if (typeof metadata.upstreamWsUnsupportedCacheHit === "boolean") {
    sanitized.upstreamWsUnsupportedCacheHit = metadata.upstreamWsUnsupportedCacheHit;
  }

  return sanitized;
}

function buildResponsesWebSocketDecisionContext(
  session: ResponsesWebSocketDecisionChainSession,
  metadata: ResponsesWebSocketDecisionMetadata
): ProviderChainItem["decisionContext"] | undefined {
  const baseContext = session.getLastSelectionContext?.();
  if (!baseContext) return undefined;

  return {
    ...baseContext,
    clientTransport: metadata.clientTransport,
    upstreamWsAttempted: metadata.upstreamWsAttempted,
    upstreamWsConnected: metadata.upstreamWsConnected,
    downgradedToHttp: metadata.downgradedToHttp,
    downgradeReason: metadata.downgradeReason,
    queueWaitMs: metadata.queueWaitMs,
    storeFalseCacheHit: metadata.storeFalseCacheHit,
    storeFalseCacheRefusalReason: metadata.storeFalseCacheRefusalReason,
    upstreamWsUnsupportedCacheHit: metadata.upstreamWsUnsupportedCacheHit,
  };
}

export type ResponsesWebSocketCircuitBreakerRecorders = {
  recordFailure: (providerId: number, error: Error) => unknown | Promise<unknown>;
  recordEndpointFailure: (endpointId: number, error: Error) => unknown | Promise<unknown>;
  recordVendorTypeAllEndpointsTimeout: (
    vendorId: number,
    providerType: ProviderType,
    openDurationMs?: number
  ) => unknown | Promise<unknown>;
};

export type ResponsesWebSocketUnsupportedFallbackInput = {
  providerId: number;
  endpointId: number | null;
  vendorId: number;
  providerType: ProviderType;
  downgradeReason: string;
  recorders: ResponsesWebSocketCircuitBreakerRecorders;
};

export async function handleResponsesWebSocketUnsupportedFallback(
  input: ResponsesWebSocketUnsupportedFallbackInput
): Promise<void> {
  // WS unsupported 只代表传输能力降级，不代表供应商业务失败。
  void input;
}

export class ResponsesWebSocketRequestQueue<T> {
  private readonly handler: ResponsesWebSocketQueueHandler<T>;
  private readonly now: () => number;
  private readonly pending: Array<{
    request: ResponsesWebSocketQueueInput;
    enqueuedAt: number;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
    settled: boolean;
  }> = [];
  private active: {
    request: ResponsesWebSocketQueueInput;
    enqueuedAt: number;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
    settled: boolean;
  } | null = null;
  private activeCount = 0;
  private disposed = false;

  constructor(handler: ResponsesWebSocketQueueHandler<T>, options: { now?: () => number } = {}) {
    this.handler = handler;
    this.now = options.now ?? Date.now;
  }

  get inFlightCount(): number {
    return this.activeCount;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(request: ResponsesWebSocketQueueInput): Promise<T> {
    if (this.disposed) return Promise.reject(createQueueDisposedError());

    return new Promise<T>((resolve, reject) => {
      this.pending.push({ request, enqueuedAt: this.now(), resolve, reject, settled: false });
      this.drain();
    });
  }

  dispose(reason: Error = createQueueDisposedError()): void {
    this.disposed = true;

    if (this.active && !this.active.settled) {
      this.active.settled = true;
      this.active.reject(reason);
    }

    while (this.pending.length > 0) {
      const item = this.pending.shift();
      if (!item || item.settled) continue;
      item.settled = true;
      item.reject(reason);
    }
  }

  private drain(): void {
    if (this.disposed) return;
    if (this.activeCount > 0) return;

    const next = this.pending.shift();
    if (!next) return;

    this.active = next;
    this.activeCount = 1;
    const queueWaitMs = Math.max(0, this.now() - next.enqueuedAt);
    Promise.resolve()
      .then(() => this.handler({ ...next.request, queueWaitMs }))
      .then(
        (value) => {
          if (next.settled) return;
          next.settled = true;
          next.resolve(value);
        },
        (error) => {
          if (next.settled) return;
          next.settled = true;
          next.reject(error);
        }
      )
      .finally(() => {
        if (this.active === next) this.active = null;
        this.activeCount = 0;
        this.drain();
      });
  }
}

function createQueueDisposedError(): Error {
  return new Error("Responses WebSocket request queue was closed or disposed");
}
