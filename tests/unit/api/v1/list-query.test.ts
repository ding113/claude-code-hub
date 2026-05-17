import { describe, expect, test } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  normalizeCursorQuery,
  normalizePageQuery,
} from "@/lib/api/v1/_shared/pagination";

describe("v1 pagination helpers", () => {
  test("normalizes page query with defaults and bounds", () => {
    expect(normalizePageQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(normalizePageQuery({ page: "3", pageSize: "500" })).toEqual({
      page: 3,
      pageSize: 100,
    });
    expect(normalizePageQuery({ page: "-1", pageSize: "0" })).toEqual({
      page: 1,
      pageSize: 1,
    });
  });

  test("normalizes cursor query and round-trips opaque cursor payloads", () => {
    const cursor = encodeCursor({ createdAt: "2026-04-28T00:00:00.000Z", id: 42 });

    expect(normalizeCursorQuery({ cursor, limit: "10" })).toEqual({ cursor, limit: 10 });
    expect(decodeCursor(cursor)).toEqual({ createdAt: "2026-04-28T00:00:00.000Z", id: 42 });
    expect(decodeCursor("not-base64")).toBeNull();
  });
});
