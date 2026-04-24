export type SessionMessages = Record<string, unknown> | Record<string, unknown>[];

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isNonEmptyPlainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value) && Object.keys(value).length > 0;
}

export function isSessionMessages(value: unknown): value is SessionMessages {
  if (Array.isArray(value)) {
    return value.every((item) => isNonEmptyPlainRecord(item));
  }

  return isNonEmptyPlainRecord(value);
}

export function extractAfterRequestMessages(value: unknown): SessionMessages | null {
  if (!isPlainRecord(value) || !("messages" in value)) {
    return null;
  }

  const messages = value.messages;
  return isSessionMessages(messages) ? messages : null;
}

export function hasSnapshotData(
  value:
    | {
        body: unknown | null;
        messages: unknown | null;
        headers: Record<string, string> | null;
      }
    | {
        body: string | null;
        headers: Record<string, string> | null;
      }
    | null
    | undefined
): boolean {
  if (!value) return false;

  return (
    value.body !== null ||
    (value.headers !== null && Object.keys(value.headers).length > 0) ||
    ("messages" in value && value.messages !== null)
  );
}
