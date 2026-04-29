import { describe, expect, test } from "vitest";
import { callV1Route } from "../../../api/v1/test-utils";

describe("v1 management route boundary", () => {
  test("serves management health under /api/v1", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/health",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-API-Version")).toBe("1.0.0");
    expect(json).toEqual({ status: "ok", apiVersion: "1.0.0" });
  });

  test("does not claim proxy-style /api/v1/messages route", async () => {
    const { response } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/messages",
    });

    expect(response.status).toBe(404);
  });
});
