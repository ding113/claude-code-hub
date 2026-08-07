import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(async () => ({ enableResponseInputRectifier: true })),
}));

import { V1_ENDPOINT_PATHS } from "@/app/v1/_lib/proxy/endpoint-paths";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { isRemoteCompactionV2Request } from "@/app/v1/_lib/proxy/remote-compaction";
import { normalizeResponseInput } from "@/app/v1/_lib/proxy/response-input-rectifier";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import { isNonBillingEndpoint } from "@/lib/utils/performance-formatter";

function makeContext(url: string, body: string): Context {
  const request = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  return {
    req: {
      method: "POST",
      url,
      raw: request,
      header: (name?: string) => {
        if (name === undefined) {
          return Object.fromEntries(request.headers.entries());
        }
        return request.headers.get(name) ?? undefined;
      },
    },
  } as unknown as Context;
}

describe("remote compaction v2 request classification", () => {
  it("recognizes an exact compaction_trigger item on the Responses endpoint", () => {
    expect(
      isRemoteCompactionV2Request(V1_ENDPOINT_PATHS.RESPONSES, {
        input: [{ role: "user", content: "keep this" }, { type: "compaction_trigger" }],
      })
    ).toBe(true);
  });

  it("recognizes a single compaction_trigger input object", () => {
    expect(
      isRemoteCompactionV2Request(V1_ENDPOINT_PATHS.RESPONSES, {
        input: { type: "compaction_trigger" },
      })
    ).toBe(true);
  });

  it.each([
    ["different endpoint", V1_ENDPOINT_PATHS.CHAT_COMPLETIONS, [{ type: "compaction_trigger" }]],
    ["future item type", V1_ENDPOINT_PATHS.RESPONSES, [{ type: "compaction_trigger_v2" }]],
    ["nested marker", V1_ENDPOINT_PATHS.RESPONSES, [{ content: { type: "compaction_trigger" } }]],
    ["string marker", V1_ENDPOINT_PATHS.RESPONSES, ["compaction_trigger"]],
    ["unrelated input object", V1_ENDPOINT_PATHS.RESPONSES, { type: "message" }],
    [
      "compaction replay item",
      V1_ENDPOINT_PATHS.RESPONSES,
      [{ type: "compaction", encrypted_content: "opaque-state" }],
    ],
  ])("does not infer compaction from %s", (_label, pathname, input) => {
    expect(isRemoteCompactionV2Request(pathname, { input })).toBe(false);
  });

  it("reuses v1 compact management while preserving the v2 wire path and body", async () => {
    const body =
      '{\n  "model": "gpt-5-codex",\n  "stream": true,\n  "input": [{"role":"user","content":"keep"},{"type":"compaction_trigger"}]\n}\n';
    const session = await ProxySession.fromContext(
      makeContext("https://hub.test/v1/responses", body)
    );

    expect(session.getEndpoint()).toBe(V1_ENDPOINT_PATHS.RESPONSES);
    expect(session.getManagedEndpoint()).toBe(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    expect(session.getEndpointPolicy()).toBe(
      resolveEndpointPolicy(V1_ENDPOINT_PATHS.RESPONSES_COMPACT)
    );
    expect(isNonBillingEndpoint(session.getManagedEndpoint())).toBe(true);
    expect(new TextDecoder().decode(session.request.buffer)).toBe(body);
  });

  it("keeps normal Responses requests on the conversation policy", async () => {
    const body = JSON.stringify({
      model: "gpt-5-codex",
      stream: true,
      input: [{ type: "message", role: "user", content: "hello" }],
    });
    const session = await ProxySession.fromContext(
      makeContext("https://hub.test/v1/responses", body)
    );

    expect(session.getManagedEndpoint()).toBe(V1_ENDPOINT_PATHS.RESPONSES);
    expect(session.getEndpointPolicy().kind).toBe("default");
  });

  it("normalizes a single compaction trigger across message, buffer, and log", async () => {
    const session = await ProxySession.fromContext(
      makeContext(
        "https://hub.test/v1/responses",
        JSON.stringify({
          model: "gpt-5-codex",
          stream: true,
          input: { type: "compaction_trigger" },
        })
      )
    );

    await normalizeResponseInput(session);

    expect(session.getManagedEndpoint()).toBe(V1_ENDPOINT_PATHS.RESPONSES_COMPACT);
    expect(session.getEndpointPolicy().kind).toBe("raw_passthrough");
    expect(session.request.message.input).toEqual([{ type: "compaction_trigger" }]);
    expect(JSON.parse(new TextDecoder().decode(session.request.buffer))).toMatchObject({
      input: [{ type: "compaction_trigger" }],
    });
    expect(JSON.parse(session.request.log)).toMatchObject({
      input: [{ type: "compaction_trigger" }],
    });
  });
});
