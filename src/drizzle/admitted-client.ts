export const DB_POOL_ADMISSION_ERROR_CODE = "DB_POOL_ADMISSION_EXCEEDED";

export interface DbPoolAdmissionErrorDetails {
  code: typeof DB_POOL_ADMISSION_ERROR_CODE;
  pool: string;
  maxOutstanding: number;
  message: string;
}

export interface SafeDatabaseErrorDetails {
  kind: "admission" | "query";
  code?: string;
  pool?: string;
  maxOutstanding?: number;
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

export function findSafeDatabaseError(error: unknown): SafeDatabaseErrorDetails | null {
  const admission = findDbPoolAdmissionError(error);
  if (admission) {
    return {
      kind: "admission",
      code: admission.code,
      pool: admission.pool,
      maxOutstanding: admission.maxOutstanding,
      message: `Database pool admission exceeded (pool=${admission.pool}, maxOutstanding=${admission.maxOutstanding})`,
    };
  }

  const visited = new Set<unknown>();
  let current: unknown = error;
  let databaseCode: string | undefined;

  for (let depth = 0; depth < 8; depth += 1) {
    if ((typeof current !== "object" && typeof current !== "function") || current === null) {
      break;
    }
    if (visited.has(current)) break;
    visited.add(current);

    const candidate = current as {
      name?: unknown;
      code?: unknown;
      query?: unknown;
      params?: unknown;
      cause?: unknown;
    };
    if (databaseCode === undefined && typeof candidate.code === "string") {
      databaseCode = candidate.code;
    }
    if (
      candidate.name === "DrizzleQueryError" ||
      (typeof candidate.query === "string" && Array.isArray(candidate.params))
    ) {
      let cause = candidate.cause;
      const causeVisited = new Set<unknown>();
      for (let causeDepth = 0; causeDepth < 8; causeDepth += 1) {
        if ((typeof cause !== "object" && typeof cause !== "function") || cause === null) break;
        if (causeVisited.has(cause)) break;
        causeVisited.add(cause);
        const causeCandidate = cause as { code?: unknown; cause?: unknown };
        if (databaseCode === undefined && typeof causeCandidate.code === "string") {
          databaseCode = causeCandidate.code;
          break;
        }
        cause = causeCandidate.cause;
      }
      return {
        kind: "query",
        code: databaseCode,
        message: "Database query failed",
      };
    }
    current = candidate.cause;
  }

  return null;
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

        if (property === "cancel") {
          // postgres.js Query is lazy: observing an unexecuted query through
          // then/catch would start it again after cancel(). A queued query is
          // rejected synchronously by cancel(), so its token can be released
          // immediately. An already-executed query can be observed safely.
          const executed = (target as { executed?: unknown }).executed === true;
          if (executed) {
            void track().catch(() => undefined);
          } else {
            release();
          }
          return result === target ? proxy : result;
        }

        if (result === target) {
          if (property === "execute" || property === "forEach") {
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
    apply(target, thisArg, argArray) {
      const release = acquire();
      try {
        return wrapPendingQuery(
          Reflect.apply(
            target as unknown as (...args: unknown[]) => unknown,
            thisArg,
            argArray
          ),
          release
        );
      } catch (error) {
        release();
        throw error;
      }
    },
    get(target, property, receiver) {
      if (property === "unsafe") return admittedUnsafe;
      if (property === "begin") return admittedBegin;
      return Reflect.get(target, property, receiver);
    },
  });
}
