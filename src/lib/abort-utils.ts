export function createAbortError(signal?: AbortSignal): unknown {
  if (!signal) return new Error("Aborted");
  if (signal.reason) return signal.reason;

  try {
    return new DOMException("Aborted", "AbortError");
  } catch {
    return new Error("Aborted");
  }
}
