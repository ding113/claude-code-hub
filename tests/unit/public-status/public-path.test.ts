import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxyHandler from "@/proxy";

describe("public status proxy path", () => {
  it("treats /en/status as a public path", () => {
    const response = proxyHandler(new NextRequest("http://127.0.0.1:13500/en/status"));
    expect(response.headers.get("location")).toBeNull();
  });
});
