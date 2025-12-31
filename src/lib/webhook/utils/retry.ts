export interface RetryOptions {
  maxRetries: number;
  baseDelay?: number;
  backoff?: (attempt: number, baseDelay: number) => number;
}

const defaultBackoff = (attempt: number, baseDelay: number): number => {
  return baseDelay * 2 ** (attempt - 1);
};

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelay = 1000, backoff = defaultBackoff } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      await delay(backoff(attempt, baseDelay));
    }
  }

  // TypeScript 需要这个，实际不会执行到
  throw new Error("Unreachable");
}
