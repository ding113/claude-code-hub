export type DemandDrivenResponsePumpState = "client-active" | "draining" | "finalizing" | "closed";

export interface DemandDrivenResponsePumpCompletion {
  streamEndedNormally: boolean;
  clientAborted: boolean;
  error: Error | null;
}

export interface DemandDrivenResponsePumpOptions {
  source: ReadableStream<Uint8Array>;
  onReadStart?: () => void;
  onChunk: (chunk: Uint8Array) => void;
  onClientCancel?: (reason: unknown) => void;
}

export interface DemandDrivenResponsePump {
  stream: ReadableStream<Uint8Array>;
  completion: Promise<DemandDrivenResponsePumpCompletion>;
  teardown: Promise<void>;
  startDrain: (reason?: unknown) => void;
  finishDrain: (reason?: unknown) => void;
  /** 返回本次取消是否赢得唯一终态。 */
  cancelSource: (reason?: unknown) => boolean;
  errorClient: (error: Error) => void;
  getState: () => DemandDrivenResponsePumpState;
  wasClientAborted: () => boolean;
}

const PENDING_CHUNK_DEADLINE_MS = 60_000;

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createDemandDrivenResponsePump(
  options: DemandDrivenResponsePumpOptions
): DemandDrivenResponsePump {
  const reader = options.source.getReader();
  let state: DemandDrivenResponsePumpState = "client-active";
  let clientAborted = false;
  let clientController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let pendingChunk: Uint8Array | null = null;
  let readInFlight: Promise<void> | null = null;
  let drainPromise: Promise<void> | null = null;
  let settled = false;
  let readerReleased = false;
  let pendingChunkDeadlineId: ReturnType<typeof setTimeout> | null = null;
  let resolveCompletion: (completion: DemandDrivenResponsePumpCompletion) => void = () => {};
  let resolveTeardown = () => {};
  const completion = new Promise<DemandDrivenResponsePumpCompletion>((resolve) => {
    resolveCompletion = resolve;
  });
  const teardown = new Promise<void>((resolve) => {
    resolveTeardown = resolve;
  });

  const releaseReader = () => {
    if (readerReleased) return;
    readerReleased = true;
    try {
      reader.releaseLock();
    } catch {
      // A terminal result must still settle if the platform rejects a late release.
    }
  };

  const clearPendingChunkDeadline = () => {
    if (!pendingChunkDeadlineId) return;
    clearTimeout(pendingChunkDeadlineId);
    pendingChunkDeadlineId = null;
  };

  const settle = (
    streamEndedNormally: boolean,
    error: Error | null,
    sourceCancelReason?: Error
  ): boolean => {
    if (settled) return false;
    settled = true;
    state = "finalizing";
    pendingChunk = null;
    clearPendingChunkDeadline();
    let cancelPromise: Promise<void> | null = null;
    const recordSourceCancelFailure = (cancelError: unknown) => {
      const normalizedCancelError = toError(cancelError);
      // 已 errored 的 Web Stream 会让随后 cancel() 以同一个 Error 拒绝。
      // 不能把错误本身写进 cause，否则日志/JSON 序列化会遇到循环引用。
      if (error && normalizedCancelError !== error && error.cause === undefined) {
        error.cause = normalizedCancelError;
      }
    };
    if (sourceCancelReason) {
      try {
        cancelPromise = reader.cancel(sourceCancelReason);
      } catch (cancelError) {
        recordSourceCancelFailure(
          cancelError instanceof Error ? cancelError : new Error(String(cancelError))
        );
      }
    }
    releaseReader();
    clientController = null;
    state = "closed";
    resolveCompletion({ streamEndedNormally, clientAborted, error });
    // 本地 teardown 的完成条件是 reader/source 所有权已释放，而不是第三方
    // cancel Promise 已 settle。部分 Web/Node stream adapter 会返回永不结束的
    // cancel Promise；让清理屏障等待它会永久保留 session、listener 和 agent lease。
    // 拒绝仍由旁路 handler 消费，但不再阻塞本地资源回收。
    if (cancelPromise) {
      void cancelPromise.then(undefined, recordSourceCancelFailure);
    }
    resolveTeardown();
    return true;
  };

  const finishWithError = (error: unknown) => {
    if (settled) return;
    const normalized = toError(error);
    if (state === "client-active") {
      try {
        clientController?.error(normalized);
      } catch {
        // The downstream may have cancelled concurrently.
      }
    }
    // A rejected source read bypasses the Web stream cancel algorithm. Keep
    // source ownership explicit so adapters can release the underlying Node
    // stream, socket, and native backing store on every terminal error.
    settle(false, normalized, normalized);
  };

  const finishNormally = () => {
    if (settled) return;
    if (state === "client-active") {
      try {
        clientController?.close();
      } catch {
        // The downstream may have cancelled concurrently.
      }
    }
    settle(true, null);
  };

  let scheduleDrain = () => {};

  const startDrain = (_reason?: unknown, markClientAborted = true) => {
    if (settled || state === "finalizing" || state === "closed") return;
    if (state === "draining") {
      scheduleDrain();
      return;
    }
    if (markClientAborted) clientAborted = true;
    state = "draining";
    try {
      clientController?.error(
        _reason == null ? new Error("Client disconnected") : toError(_reason)
      );
    } catch (controllerError) {
      if (!(controllerError instanceof TypeError)) throw controllerError;
      // The ReadableStream cancel algorithm may have already detached the controller.
    }
    scheduleDrain();
  };

  const cancelSource = (reason?: unknown) => {
    if (settled) return false;
    const normalized = reason == null ? new Error("Source cancelled") : toError(reason);
    return settle(false, normalized, normalized);
  };

  /** Completes a detached drain after metering without reporting a source error. */
  const finishDrain = (reason?: unknown) => {
    if (settled || state !== "draining") return;
    const normalized = reason == null ? new Error("Background drain complete") : toError(reason);
    settle(false, null, normalized);
  };

  const armPendingChunkDeadline = () => {
    clearPendingChunkDeadline();
    pendingChunkDeadlineId = setTimeout(() => {
      const error = new DOMException(
        `Client response body was not consumed within ${PENDING_CHUNK_DEADLINE_MS}ms`,
        "AbortError"
      );
      startDrain(error, false);
      cancelSource(error);
    }, PENDING_CHUNK_DEADLINE_MS);
  };

  const ensureRead = (): Promise<void> => {
    if (settled || pendingChunk || readInFlight) {
      return readInFlight ?? Promise.resolve();
    }

    let sourceRead: Promise<ReadableStreamReadResult<Uint8Array>>;
    try {
      options.onReadStart?.();
      sourceRead = reader.read();
    } catch (error) {
      finishWithError(error);
      return Promise.resolve();
    }

    const read = sourceRead
      .then(
        (result) => {
          if (settled) return;
          if (result.done) {
            finishNormally();
            return;
          }

          options.onChunk(result.value);
          if (settled) return;
          pendingChunk = result.value;
          armPendingChunkDeadline();
        },
        (error) => finishWithError(error)
      )
      .catch((error) => finishWithError(error))
      .finally(() => {
        if (readInFlight === read) {
          readInFlight = null;
        }
        if (state === "draining") {
          scheduleDrain();
        }
      });
    readInFlight = read;
    return read;
  };

  scheduleDrain = () => {
    if (drainPromise || settled || state !== "draining") return;

    drainPromise = (async () => {
      while (!settled && state === "draining") {
        if (readInFlight) {
          await readInFlight;
          continue;
        }
        if (pendingChunk) {
          clearPendingChunkDeadline();
          pendingChunk = null;
          continue;
        }
        await ensureRead();
      }
    })().finally(() => {
      drainPromise = null;
      if (!settled && state === "draining") {
        scheduleDrain();
      }
    });
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        clientController = controller;
      },
      async pull() {
        if (settled || state !== "client-active") return;

        await ensureRead();
        if (settled || state !== "client-active" || !pendingChunk) return;

        const chunk = pendingChunk;
        clearPendingChunkDeadline();
        pendingChunk = null;
        try {
          clientController?.enqueue(chunk);
        } catch (error) {
          finishWithError(error);
          return;
        }

        void ensureRead();
      },
      cancel(reason) {
        try {
          options.onClientCancel?.(reason);
        } finally {
          startDrain(reason);
        }
      },
    },
    { highWaterMark: 0 }
  );

  void ensureRead();

  return {
    stream,
    completion,
    teardown,
    startDrain,
    finishDrain,
    cancelSource,
    errorClient(error) {
      if (settled || state !== "client-active") return;
      state = "draining";
      try {
        clientController?.error(error);
      } catch {
        // The downstream may have cancelled concurrently.
      }
      scheduleDrain();
    },
    getState: () => state,
    wasClientAborted: () => clientAborted,
  };
}
