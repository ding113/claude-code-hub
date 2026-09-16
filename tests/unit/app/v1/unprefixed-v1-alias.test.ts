import { describe, expect, test } from "vitest";
import { GET as chatGet, POST as chatPost } from "@/app/chat/completions/[[...route]]/route";
import { GET as messagesGet, POST as messagesPost } from "@/app/messages/[[...route]]/route";
import { GET as modelsGet, POST as modelsPost } from "@/app/models/[[...route]]/route";
import { GET as responsesGet, POST as responsesPost } from "@/app/responses/[[...route]]/route";
import { GET as v1Get, POST as v1Post, v1App } from "@/app/v1/[...route]/route";
import { mapUnprefixedV1Path, rewriteUnprefixedV1Request } from "@/app/v1/_lib/unprefixed-v1-alias";

describe("mapUnprefixedV1Path", () => {
  test.each([
    ["/chat/completions", "/v1/chat/completions"],
    ["/chat/completions/", "/v1/chat/completions"],
    ["/chat/completions/models", "/v1/chat/completions/models"],
    ["/responses", "/v1/responses"],
    ["/responses/compact", "/v1/responses/compact"],
    ["/responses/models", "/v1/responses/models"],
    ["/models", "/v1/models"],
    ["/models/gpt-4.1", "/v1/models/gpt-4.1"],
    ["/messages", "/v1/messages"],
    ["/messages/count_tokens", "/v1/messages/count_tokens"],
    ["/messages/count_tokens/", "/v1/messages/count_tokens"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapUnprefixedV1Path(input)).toBe(expected);
  });

  test.each([
    "/v1/messages",
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/models",
    "/v1beta/models/gemini-pro:generateContent",
    "/chat",
    "/chat/completions-extra",
    "/messaging",
    "/models-archive",
    "/response",
    "/dashboard",
    "/",
  ])("leaves non-alias path unchanged: %s", (pathname) => {
    expect(mapUnprefixedV1Path(pathname)).toBe(pathname);
  });
});

describe("rewriteUnprefixedV1Request", () => {
  test("rewrites pathname, keeps query/method/headers/body", async () => {
    const req = new Request("http://localhost/messages/count_tokens?beta=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer k",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6" }),
    });

    const rewritten = rewriteUnprefixedV1Request(req);
    const url = new URL(rewritten.url);
    expect(url.pathname).toBe("/v1/messages/count_tokens");
    expect(url.search).toBe("?beta=1");
    expect(rewritten.method).toBe("POST");
    expect(rewritten.headers.get("authorization")).toBe("Bearer k");
    expect(await rewritten.json()).toEqual({ model: "claude-sonnet-4-6" });
  });

  test("returns the same request when path is already canonical", () => {
    const req = new Request("http://localhost/v1/messages", { method: "POST" });
    expect(rewriteUnprefixedV1Request(req)).toBe(req);
  });
});

describe("unprefixed alias App Router routes", () => {
  test("re-export the canonical /v1 handlers", () => {
    expect(messagesGet).toBe(v1Get);
    expect(messagesPost).toBe(v1Post);
    expect(modelsGet).toBe(v1Get);
    expect(modelsPost).toBe(v1Post);
    expect(responsesGet).toBe(v1Get);
    expect(responsesPost).toBe(v1Post);
    expect(chatGet).toBe(v1Get);
    expect(chatPost).toBe(v1Post);
  });
});

describe("Hono /v1 app after alias rewrite", () => {
  test("raw unprefixed /models misses basePath and 404s", async () => {
    const response = await v1App.request("/models");
    expect(response.status).toBe(404);
  });

  test("rewritten /models hits the /v1/models handler instead of 404", async () => {
    const response = await v1App.fetch(
      rewriteUnprefixedV1Request(new Request("http://localhost/models"))
    );
    expect(response.status).not.toBe(404);
  });

  test("rewritten /chat/completions hits the chat completions route", async () => {
    const raw = await v1App.request("/chat/completions", { method: "POST" });
    expect(raw.status).toBe(404);

    const rewritten = await v1App.fetch(
      rewriteUnprefixedV1Request(
        new Request("http://localhost/chat/completions", { method: "POST" })
      )
    );
    expect(rewritten.status).not.toBe(404);
  });

  test("exported GET handler rewrites unprefixed /models onto the v1 models route", async () => {
    const response = await v1Get(new Request("http://localhost/models"));
    expect(response.status).not.toBe(404);
  });

  test("exported POST handler rewrites unprefixed /messages onto the v1 messages route", async () => {
    const response = await v1Post(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
    );
    expect(response.status).not.toBe(404);
  });
});
