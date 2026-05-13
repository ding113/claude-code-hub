import { describe, expect, test } from "vitest";
import { withNoStoreHeaders } from "@/lib/api/v1/_shared/cache-control";

describe("v1 cache control helpers", () => {
  test("applies no-store headers", () => {
    const headers = withNoStoreHeaders();

    expect(headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(headers.get("pragma")).toBe("no-cache");
  });
});
