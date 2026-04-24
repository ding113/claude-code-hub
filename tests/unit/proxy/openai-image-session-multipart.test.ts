import { describe, expect, it } from "vitest";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

function createContext(request: Request) {
  return {
    req: {
      method: request.method,
      url: request.url,
      raw: request,
      header(name?: string) {
        if (name) {
          return request.headers.get(name) ?? undefined;
        }
        return Object.fromEntries(request.headers.entries());
      },
    },
  } as any;
}

function createMultipartRequest({
  pathname,
  fields,
  fileSize,
}: {
  pathname: string;
  fields: Array<[string, string]>;
  fileSize: number;
}) {
  const formData = new FormData();
  for (const [name, value] of fields) {
    formData.append(name, value);
  }
  formData.append(
    pathname.endsWith("/variations") ? "image" : "image[]",
    new File([new Uint8Array(fileSize)], "image.png", { type: "image/png" }),
    "image.png"
  );

  return new Request(`https://proxy.example.com${pathname}`, {
    method: "POST",
    body: formData,
  });
}

describe("ProxySession - openai image multipart parsing", () => {
  it("extracts model from /images/edits multipart requests", async () => {
    const request = createMultipartRequest({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "edit this"],
      ],
      fileSize: 32,
    });

    const session = await ProxySession.fromContext(createContext(request));

    expect(session.request.model).toBe("gpt-image-1.5");
    expect(session.isOpenAIImageMultipartRequest()).toBe(true);
    expect(session.request.message).toEqual({
      model: "gpt-image-1.5",
      prompt: "edit this",
    });
    expect(session.getOpenAIImageRequestMetadata()?.endpoint).toBe("edits");
  });

  it("does not trip the large-body missing-model guard when multipart model is present", async () => {
    const request = createMultipartRequest({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "edit this"],
      ],
      fileSize: 10 * 1024 * 1024 + 1,
    });

    await expect(ProxySession.fromContext(createContext(request))).resolves.toBeInstanceOf(
      ProxySession
    );
  });
});
