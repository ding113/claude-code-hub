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
  startDrain: (reason?: unknown) => void;
  cancelSource: (reason?: unknown) => void;
  errorClient: (error: Error) => void;
  getState: () => DemandDrivenResponsePumpState;
  wasClientAborted: () => boolean;
}

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
  let resolveCompletion: (completion: DemandDrivenResponsePumpCompletion) => void = () => {};
  const completion = new Promise<DemandDrivenResponsePumpCompletion>((resolve) => {
    resolveCompletion = resolve;
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

  const settle = (streamEndedNormally: boolean, error: Error | null) => {
    if (settled) return;
    settled = true;
    state = "finalizing";
    pendingChunk = null;
    releaseReader();
    clientController = null;
    state = "closed";
    resolveCompletion({ streamEndedNormally, clientAborted, error });
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
    settle(false, normalized);
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
          pendingChunk = result.value;
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

  const startDrain = (_reason?: unknown) => {
    if (settled || state === "finalizing" || state === "closed") return;
    if (state === "draining") {
      scheduleDrain();
      return;
    }
    clientAborted = true;
    state = "draining";
    try {
      clientController?.error(
        _reason == null ? new Error("Client disconnected") : toError(_reason)
      );
    } catch {
      // The ReadableStream cancel algorithm may have already detached the controller.
    }
    scheduleDrain();
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
        options.onClientCancel?.(reason);
        startDrain(reason);
      },
    },
    { highWaterMark: 0 }
  );

  void ensureRead();

  return {
    stream,
    completion,
    startDrain,
    cancelSource(reason) {
      if (settled) return;
      const normalized = reason == null ? new Error("Source cancelled") : toError(reason);
      const cancelPromise = reader.cancel(normalized);
      settle(false, normalized);
      void cancelPromise.catch(() => {
        // The pump has already recorded the hard-cancel cause.
      });
    },
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
