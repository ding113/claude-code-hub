import { describe, expect, test } from "vitest";
import { callV1Route } from "../test-utils";

describe("v1 webhook targets OpenAPI", () => {
  test("documents webhook target REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/webhook-targets");
    expect(doc.paths).toHaveProperty("/api/v1/webhook-targets/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/webhook-targets/{id}:test");
  });
});
