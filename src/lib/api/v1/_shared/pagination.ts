export type PageQuery = {
  page: number;
  pageSize: number;
};

export type CursorQuery = {
  cursor?: string;
  limit: number;
};

export function normalizePageQuery(input: {
  page?: string | number | null;
  pageSize?: string | number | null;
}): PageQuery {
  return {
    page: clampPositiveInt(input.page, 1, 1, Number.MAX_SAFE_INTEGER),
    pageSize: clampPositiveInt(input.pageSize, 20, 1, 100),
  };
}

export function normalizeCursorQuery(input: {
  cursor?: string | null;
  limit?: string | number | null;
}): CursorQuery {
  const cursor =
    typeof input.cursor === "string" && input.cursor.length > 0 ? input.cursor : undefined;
  return {
    ...(cursor ? { cursor } : {}),
    limit: clampPositiveInt(input.limit, 20, 1, 100),
  };
}

export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const text = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampPositiveInt(
  value: string | number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
