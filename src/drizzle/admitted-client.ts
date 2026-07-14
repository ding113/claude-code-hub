export const DB_POOL_ADMISSION_ERROR_CODE = "DB_POOL_ADMISSION_EXCEEDED";

export interface DbPoolAdmissionErrorDetails {
  code: typeof DB_POOL_ADMISSION_ERROR_CODE;
  pool: string;
  maxOutstanding: number;
  message: string;
}

export class DbPoolAdmissionError extends Error {
  readonly code = DB_POOL_ADMISSION_ERROR_CODE;

  constructor(
    readonly pool: string,
    readonly maxOutstanding: number
  ) {
    super(`Database pool ${pool} exceeded ${maxOutstanding} outstanding operations`);
    this.name = "DbPoolAdmissionError";
  }
}

export function findDbPoolAdmissionError(error: unknown): DbPoolAdmissionErrorDetails | null {
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 8; depth += 1) {
    if ((typeof current !== "object" && typeof current !== "function") || current === null) {
      return null;
    }
    if (visited.has(current)) return null;
    visited.add(current);

    const candidate = current as {
      code?: unknown;
      pool?: unknown;
      maxOutstanding?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (candidate.code === DB_POOL_ADMISSION_ERROR_CODE) {
      return {
        code: DB_POOL_ADMISSION_ERROR_CODE,
        pool: typeof candidate.pool === "string" ? candidate.pool : "unknown",
        maxOutstanding:
          typeof candidate.maxOutstanding === "number" ? candidate.maxOutstanding : -1,
        message:
          typeof candidate.message === "string" ? candidate.message : DB_POOL_ADMISSION_ERROR_CODE,
      };
    }
    current = candidate.cause;
  }

  return null;
}

export function isDbPoolAdmissionError(error: unknown): boolean {
  return findDbPoolAdmissionError(error) !== null;
}

interface AdmittedClientOptions {
  pool: string;
  maxOutstanding: number;
}

interface UnsafeAndBeginClient {
  unsafe: (...args: unknown[]) => unknown;
  begin: (...args: unknown[]) => unknown;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

function wrapAsyncIterable(
  iterable: AsyncIterable<unknown>,
  release: () => void
): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = iterable[Symbol.asyncIterator]();
      return {
        async next(...args: [] | [undefined]) {
          try {
            const result = await iterator.next(...args);
            if (result.done) release();
            return result;
          } catch (error) {
            release();
            throw error;
          }
        },
        async return(value?: unknown) {
          try {
            if (iterator.return) return await iterator.return(value);
            return { done: true as const, value };
          } finally {
            release();
          }
        },
        async throw(error?: unknown) {
          try {
            if (iterator.throw) return await iterator.throw(error);
            throw error;
          } finally {
            release();
          }
        },
      };
    },
  };
}

function wrapPendingQuery(pending: unknown, release: () => void): unknown {
  if (!isPromiseLike(pending)) {
    release();
    return pending;
  }

  let trackedPromise: Promise<unknown> | null = null;
  let proxy: object;

  const track = () => {
    if (!trackedPromise) {
      trackedPromise = Promise.resolve(pending).then(
        (value) => {
          release();
          return value;
        },
        (error) => {
          release();
          throw error;
        }
      );
    }
    return trackedPromise;
  };

  proxy = new Proxy(pending as object, {
    get(target, property) {
      if (property === "then") return track().then.bind(track());
      if (property === "catch") return track().catch.bind(track());
      if (property === "finally") return track().finally.bind(track());

      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        let result: unknown;
        try {
          result = Reflect.apply(value, target, args);
        } catch (error) {
          release();
          throw error;
        }

        if (result === target) {
          if (property === "execute" || property === "forEach" || property === "cancel") {
            void track().catch(() => undefined);
          }
          return proxy;
        }
        if (isPromiseLike(result)) {
          return Promise.resolve(result).then(
            (resolved) => {
              release();
              return resolved;
            },
            (error) => {
              release();
              throw error;
            }
          );
        }
        if (isAsyncIterable(result)) return wrapAsyncIterable(result, release);
        return result;
      };
    },
  });

  return proxy;
}

export function createAdmittedSqlClient<TClient extends object>(
  client: TClient,
  options: AdmittedClientOptions
): TClient {
  const rawClient = client as unknown as UnsafeAndBeginClient;
  const originalUnsafe = rawClient.unsafe.bind(client);
  const originalBegin = rawClient.begin.bind(client);
  let outstanding = 0;

  const acquire = () => {
    if (outstanding >= options.maxOutstanding) {
      throw new DbPoolAdmissionError(options.pool, options.maxOutstanding);
    }
    outstanding += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      outstanding -= 1;
    };
  };

  const admittedUnsafe = (...args: unknown[]) => {
    const release = acquire();
    try {
      return wrapPendingQuery(originalUnsafe(...args), release);
    } catch (error) {
      release();
      throw error;
    }
  };

  const admittedBegin = (...args: unknown[]) => {
    const release = acquire();
    let result: unknown;
    try {
      result = originalBegin(...args);
    } catch (error) {
      release();
      throw error;
    }

    if (!isPromiseLike(result)) {
      release();
      return result;
    }
    return Promise.resolve(result).then(
      (value) => {
        release();
        return value;
      },
      (error) => {
        release();
        throw error;
      }
    );
  };

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "unsafe") return admittedUnsafe;
      if (property === "begin") return admittedBegin;
      return Reflect.get(target, property, receiver);
    },
  });
}
