import { describe, expect, test } from "vitest";
import { callV1Route } from "../test-utils";

describe("v1 providers OpenAPI", () => {
  test("documents provider search and key reveal paths", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(doc.paths).toHaveProperty("/api/v1/providers");
    expect(doc.paths).toHaveProperty("/api/v1/providers/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/providers/{id}/key:reveal");
    expect(doc.paths).toHaveProperty("/api/v1/providers/health");
    expect(doc.paths).toHaveProperty("/api/v1/providers/{id}/circuit:reset");
    expect(doc.paths).toHaveProperty("/api/v1/providers/{id}/usage:reset");
    expect(doc.paths).toHaveProperty("/api/v1/providers/circuits:batchReset");
    expect(doc.paths).toHaveProperty("/api/v1/providers/{id}/limit-usage");
    expect(doc.paths).toHaveProperty("/api/v1/providers/limit-usage:batch");
    expect(doc.paths).toHaveProperty("/api/v1/providers/groups");
    expect(doc.paths).toHaveProperty("/api/v1/providers:autoSortPriority");
    expect(doc.paths).toHaveProperty("/api/v1/providers:batchUpdate");
    expect(doc.paths).toHaveProperty("/api/v1/providers:batchDelete");
    expect(doc.paths).toHaveProperty("/api/v1/providers:undoDelete");
    expect(doc.paths).toHaveProperty("/api/v1/providers:batchPatch:preview");
    expect(doc.paths).toHaveProperty("/api/v1/providers:batchPatch:apply");
    expect(doc.paths).toHaveProperty("/api/v1/providers:undoPatch");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:proxy");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:unified");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:anthropic-messages");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:openai-chat-completions");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:openai-responses");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:gemini");
    expect(doc.paths).toHaveProperty("/api/v1/providers/test:presets");
    expect(doc.paths).toHaveProperty("/api/v1/providers/upstream-models:fetch");
    expect(doc.paths).toHaveProperty("/api/v1/providers/model-suggestions");
    expect(doc.paths).toHaveProperty("/api/v1/providers/vendors:recluster");
    expect(JSON.stringify(doc.paths["/api/v1/providers"])).toContain("post");
    expect(JSON.stringify(doc.paths["/api/v1/providers/{id}"])).toContain("patch");
    expect(JSON.stringify(doc.paths["/api/v1/providers/{id}"])).toContain("delete");
    expect(JSON.stringify(doc.paths["/api/v1/providers"])).toContain("x-required-access");
    expect(JSON.stringify(doc)).not.toContain("claude-auth");
    expect(JSON.stringify(doc)).not.toContain("gemini-cli");
  });
});
