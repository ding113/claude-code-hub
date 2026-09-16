import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

function snapshotEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = {};
  for (const key of keys) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

type QueryLike = { toQuery: (config: unknown) => { params: unknown[] } };

function sqlParams(query: QueryLike): unknown[] {
  return query.toQuery({
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index}`,
    escapeString: (value: string) => `'${value}'`,
    paramStartIndex: { value: 1 },
  }).params;
}

function largeErrorText(): string {
  return JSON.stringify({
    error: {
      message: "upstream exploded",
      detail: "stack frame with repeated filler text ".repeat(2000),
    },
  });
}

describe("write buffer error text compression", () => {
  const envKeys = [
    "NODE_ENV",
    "DSN",
    "MESSAGE_REQUEST_WRITE_MODE",
    "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS",
    "MESSAGE_REQUEST_ASYNC_BATCH_SIZE",
    "MESSAGE_REQUEST_ASYNC_MAX_PENDING",
  ];
  const originalEnv = snapshotEnv(envKeys);

  const executeMock = vi.fn(async (_query: QueryLike) => [] as Array<{ id: number }>);
  const compressSpy = vi.fn();
  const decompressSpy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockImplementation(async (query) => {
      const ids = sqlParams(query).filter((v): v is number => typeof v === "number");
      return Array.from(new Set(ids), (id) => ({ id }));
    });
    compressSpy.mockReset();
    decompressSpy.mockReset();

    process.env.NODE_ENV = "test";
    process.env.DSN = "postgres://postgres:postgres@localhost:5432/claude_code_hub_test";
    process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
    process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "60000";
    process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "1000";
    process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "1000";

    vi.doMock("@/drizzle/db", () => ({
      db: {
        execute: executeMock,
        select: () => ({ from: () => ({ where: async () => [] }) }),
      },
      getMessageWriterDb: () => ({ execute: executeMock }),
    }));
    vi.doMock("@/lib/logger", () => ({
      logger: {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("@/lib/compression/payload-codec");
    restoreEnv(originalEnv);
  });

  async function mockCodec(
    overrides: { decompressPayload?: (value: string) => Promise<string> } = {}
  ) {
    const actual = await vi.importActual<typeof import("@/lib/compression/payload-codec")>(
      "@/lib/compression/payload-codec"
    );
    vi.doMock("@/lib/compression/payload-codec", () => ({
      ...actual,
      compressPayload: compressSpy.mockImplementation(actual.compressPayload),
      decompressPayload: decompressSpy.mockImplementation(
        overrides.decompressPayload ?? actual.decompressPayload
      ),
    }));
    return actual;
  }

  it("holds large error text compressed and writes plaintext to the database", async () => {
    const actual = await mockCodec();
    const { enqueueMessageRequestUpdate, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );
    const errorStack = largeErrorText();

    enqueueMessageRequestUpdate(41, { statusCode: 502, errorMessage: "short", errorStack });

    // 等压缩真正写回缓冲区，再 flush，否则测的是未压缩路径。
    await vi.waitFor(() => expect(compressSpy).toHaveBeenCalledTimes(1));
    const compressed = await compressSpy.mock.results[0].value;
    expect(actual.isCompressedPayload(compressed)).toBe(true);
    expect(compressed.length).toBeLessThan(errorStack.length / 4);

    await flushMessageRequestWriteBuffer();

    // 只有存成信封才会触发解码，这证明缓冲期确实是压缩态。
    expect(decompressSpy).toHaveBeenCalledWith(compressed);
    const params = sqlParams(executeMock.mock.calls[0][0]);
    expect(params).toContain(errorStack);
    expect(params.some((v) => typeof v === "string" && actual.isCompressedPayload(v))).toBe(false);
    // 短文本不参与压缩
    expect(params).toContain("short");
    expect(compressSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves short error text untouched", async () => {
    await mockCodec();
    const { enqueueMessageRequestUpdate, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(42, { statusCode: 500, errorMessage: "boom", errorStack: "at x" });
    await flushMessageRequestWriteBuffer();

    expect(compressSpy).not.toHaveBeenCalled();
    expect(decompressSpy).not.toHaveBeenCalled();
    const params = sqlParams(executeMock.mock.calls[0][0]);
    expect(params).toContain("boom");
    expect(params).toContain("at x");
  });

  it("writes a marker rather than an envelope when decoding fails", async () => {
    const actual = await mockCodec({ decompressPayload: async (value: string) => value });
    const { enqueueMessageRequestUpdate, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );

    enqueueMessageRequestUpdate(43, { statusCode: 502, errorMessage: largeErrorText() });
    await vi.waitFor(() => expect(compressSpy).toHaveBeenCalledTimes(1));
    await compressSpy.mock.results[0].value;

    await flushMessageRequestWriteBuffer();

    const params = sqlParams(executeMock.mock.calls[0][0]);
    expect(params).toContain("[cch_error_text_unavailable]");
    expect(params.some((v) => typeof v === "string" && actual.isCompressedPayload(v))).toBe(false);
  });

  it("hands committed patches plaintext error text", async () => {
    await mockCodec();
    const { enqueueMessageRequestUpdateDurably, flushMessageRequestWriteBuffer } = await import(
      "@/repository/message-write-buffer"
    );
    const errorMessage = largeErrorText();
    const committed: Array<string | undefined> = [];

    const durable = enqueueMessageRequestUpdateDurably(
      44,
      { statusCode: 502, errorMessage },
      { onCommitted: (patch) => void committed.push(patch.errorMessage) }
    );

    await vi.waitFor(() => expect(compressSpy).toHaveBeenCalledTimes(1));
    await compressSpy.mock.results[0].value;
    await flushMessageRequestWriteBuffer();
    await durable;

    expect(committed).toEqual([errorMessage]);
  });
});
