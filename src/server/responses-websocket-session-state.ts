import { createHash } from "node:crypto";
import type { ResponseRequest } from "@/app/v1/_lib/codex/types/response";

const DEFAULT_STORE_FALSE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_STORE_FALSE_CACHE_MAX_ITEMS = 64;
const DEFAULT_STORE_FALSE_CACHE_MAX_BYTES = 256 * 1024;

export type ResponsesWebSocketProviderIdentity = {
  providerId: number | string;
  providerType: string;
  upstreamBaseUrl: string;
  endpointId?: number | string | null;
  endpointUrl?: string | null;
};

export type StoreFalseCacheRefusalReason =
  | "empty"
  | "store_not_false"
  | "expired"
  | "previous_response_id_mismatch"
  | "body_hash_mismatch"
  | "provider_identity_mismatch"
  | "limit_exceeded";

export type StoreFalseContextCacheOptions = {
  maxTtlMs?: number;
  maxItems?: number;
  maxBytes?: number;
  now?: () => number;
};

export type StoreFalseCachedItemChain = {
  inputItems: unknown[];
  outputItems: unknown[];
};

export type StoreFalseCacheDebugSnapshot = {
  lastResponseId: string;
  nonInputCreateBodyHash: string;
  providerIdentityHash: string;
  store: false;
  itemCount: number;
  byteSize: number;
  createdAt: number;
  expiresAt: number;
};

export type StoreFalseCacheReuseHit = {
  hit: true;
  reason: "hit";
  lastResponseId: string;
  nonInputCreateBodyHash: string;
  cachedItemChain: StoreFalseCachedItemChain;
  debugSnapshot: StoreFalseCacheDebugSnapshot;
};

export type StoreFalseCacheReuseMiss = {
  hit: false;
  reason: StoreFalseCacheRefusalReason;
  debugSnapshot: StoreFalseCacheDebugSnapshot | null;
};

export type StoreFalseCacheReuseResult = StoreFalseCacheReuseHit | StoreFalseCacheReuseMiss;

export type StoreFalseCacheUpdateResult = {
  stored: boolean;
  reason?: StoreFalseCacheRefusalReason | "missing_response_id";
  debugSnapshot: StoreFalseCacheDebugSnapshot | null;
};

type StoreFalseRequestBody = ResponseRequest & Record<string, unknown>;

type StoreFalseCacheEntry = {
  lastResponseId: string;
  itemChain: StoreFalseCachedItemChain;
  nonInputCreateBodyHash: string;
  providerIdentityHash: string;
  store: false;
  itemCount: number;
  byteSize: number;
  createdAt: number;
  expiresAt: number;
};

export class ResponsesWebSocketSessionState {
  private readonly maxTtlMs: number;
  private readonly maxItems: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private storeFalseCache: StoreFalseCacheEntry | null = null;

  constructor(options: StoreFalseContextCacheOptions = {}) {
    this.maxTtlMs = Math.max(1, options.maxTtlMs ?? DEFAULT_STORE_FALSE_CACHE_TTL_MS);
    this.maxItems = Math.max(1, options.maxItems ?? DEFAULT_STORE_FALSE_CACHE_MAX_ITEMS);
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_STORE_FALSE_CACHE_MAX_BYTES);
    this.now = options.now ?? Date.now;
  }

  clear(): void {
    this.storeFalseCache = null;
  }

  updateStoreFalseCache(args: {
    requestBody: StoreFalseRequestBody;
    response: unknown;
    providerIdentity: ResponsesWebSocketProviderIdentity;
  }): StoreFalseCacheUpdateResult {
    if (args.requestBody.store !== false) {
      return { stored: false, reason: "store_not_false", debugSnapshot: this.getDebugSnapshot() };
    }

    const lastResponseId = extractResponseId(args.response);
    if (!lastResponseId) {
      return {
        stored: false,
        reason: "missing_response_id",
        debugSnapshot: this.getDebugSnapshot(),
      };
    }

    const itemChain: StoreFalseCachedItemChain = {
      inputItems: normalizeItemArray(args.requestBody.input),
      outputItems: extractOutputItems(args.response),
    };
    const itemCount = itemChain.inputItems.length + itemChain.outputItems.length;
    const byteSize = byteLengthOfStableJson(itemChain);

    if (itemCount > this.maxItems || byteSize > this.maxBytes) {
      this.clear();
      return { stored: false, reason: "limit_exceeded", debugSnapshot: null };
    }

    const createdAt = this.now();
    this.storeFalseCache = {
      lastResponseId,
      itemChain,
      nonInputCreateBodyHash: hashCreateBodyWithoutInput(args.requestBody),
      providerIdentityHash: hashProviderIdentity(args.providerIdentity),
      store: false,
      itemCount,
      byteSize,
      createdAt,
      expiresAt: createdAt + this.maxTtlMs,
    };

    return { stored: true, debugSnapshot: this.getDebugSnapshot() };
  }

  resolveStoreFalseCacheReuse(args: {
    requestBody: StoreFalseRequestBody;
    providerIdentity: ResponsesWebSocketProviderIdentity;
  }): StoreFalseCacheReuseResult {
    if (args.requestBody.store !== false) {
      return { hit: false, reason: "store_not_false", debugSnapshot: this.getDebugSnapshot() };
    }

    const cache = this.storeFalseCache;
    if (!cache) return { hit: false, reason: "empty", debugSnapshot: null };

    if (this.now() > cache.expiresAt) {
      this.clear();
      return { hit: false, reason: "expired", debugSnapshot: null };
    }

    if (args.requestBody.previous_response_id !== cache.lastResponseId) {
      return {
        hit: false,
        reason: "previous_response_id_mismatch",
        debugSnapshot: this.getDebugSnapshot(),
      };
    }

    if (hashCreateBodyWithoutInput(args.requestBody) !== cache.nonInputCreateBodyHash) {
      return { hit: false, reason: "body_hash_mismatch", debugSnapshot: this.getDebugSnapshot() };
    }

    if (hashProviderIdentity(args.providerIdentity) !== cache.providerIdentityHash) {
      return {
        hit: false,
        reason: "provider_identity_mismatch",
        debugSnapshot: this.getDebugSnapshot(),
      };
    }

    return {
      hit: true,
      reason: "hit",
      lastResponseId: cache.lastResponseId,
      nonInputCreateBodyHash: cache.nonInputCreateBodyHash,
      cachedItemChain: cloneJson(cache.itemChain),
      debugSnapshot: this.getDebugSnapshot() as StoreFalseCacheDebugSnapshot,
    };
  }

  getStoreFalseCacheDebugSnapshot(): StoreFalseCacheDebugSnapshot | null {
    return this.getDebugSnapshot();
  }

  private getDebugSnapshot(): StoreFalseCacheDebugSnapshot | null {
    const cache = this.storeFalseCache;
    if (!cache) return null;

    return {
      lastResponseId: cache.lastResponseId,
      nonInputCreateBodyHash: cache.nonInputCreateBodyHash,
      providerIdentityHash: cache.providerIdentityHash,
      store: false,
      itemCount: cache.itemCount,
      byteSize: cache.byteSize,
      createdAt: cache.createdAt,
      expiresAt: cache.expiresAt,
    };
  }
}

function hashCreateBodyWithoutInput(body: StoreFalseRequestBody): string {
  const {
    input: _input,
    previous_response_id: _previousResponseId,
    stream: _stream,
    background: _background,
    ...hashableBody
  } = body;

  void _input;
  void _previousResponseId;
  void _stream;
  void _background;

  return sha256Hex(hashableBody);
}

function hashProviderIdentity(identity: ResponsesWebSocketProviderIdentity): string {
  return sha256Hex({
    providerId: identity.providerId,
    providerType: identity.providerType,
    upstreamBaseUrl: identity.upstreamBaseUrl,
    endpointId: identity.endpointId ?? null,
    endpointUrl: identity.endpointUrl ?? null,
  });
}

function extractResponseId(response: unknown): string | null {
  if (!isRecord(response)) return null;
  const id = response.id;
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

function extractOutputItems(response: unknown): unknown[] {
  if (!isRecord(response)) return [];
  return normalizeItemArray(response.output);
}

function normalizeItemArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return cloneJson(value);
  if (value === undefined || value === null) return [];
  return [cloneJson(value)];
}

function byteLengthOfStableJson(value: unknown): number {
  return new TextEncoder().encode(stableJson(value)).byteLength;
}

function sha256Hex(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);

  return `{${entries.join(",")}}`;
}

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
