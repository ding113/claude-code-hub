import { describe, expect, it } from "vitest";
import type { Provider } from "@/types/provider";
import {
  parseOpenAIImageMultipartMetadata,
  sanitizeGenerationsRequestForProvider,
  serializeOpenAIImageMultipartRequest,
  setOpenAIImageMultipartModel,
  validateOpenAIImageRequest,
  type OpenAIImageRequestMetadata,
} from "@/app/v1/_lib/proxy/openai-image-compat";

function createProvider(name: string, url: string): Provider {
  return {
    id: 1,
    name,
    url,
    key: "test-key",
    providerType: "openai-compatible",
  } as unknown as Provider;
}

function buildPngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

function createPngFile(name: string, width: number, height: number): File {
  return new File([buildPngBytes(width, height)], name, { type: "image/png" });
}

async function createMultipartMetadata(parts: {
  pathname: string;
  fields?: Array<[string, string]>;
  files?: Array<[string, File]>;
}): Promise<OpenAIImageRequestMetadata> {
  const formData = new FormData();
  for (const [name, value] of parts.fields ?? []) {
    formData.append(name, value);
  }
  for (const [name, file] of parts.files ?? []) {
    formData.append(name, file, file.name);
  }

  const request = new Request(`https://proxy.example.com${parts.pathname}`, {
    method: "POST",
    body: formData,
  });

  const metadata = await parseOpenAIImageMultipartMetadata(
    request,
    parts.pathname,
    request.headers.get("content-type")
  );

  if (!metadata) {
    throw new Error("Expected multipart metadata to be parsed");
  }

  return metadata;
}

describe("openai-image-compat - generations constraints", () => {
  it("rejects GPT models with response_format", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "gpt-image-1.5",
        prompt: "otter",
        response_format: "url",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("response_format");
  });

  it("rejects transparent background with jpeg output", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "gpt-image-1",
        prompt: "otter",
        background: "transparent",
        output_format: "jpeg",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("transparent background");
  });

  it("rejects dall-e-3 n values other than 1", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "dall-e-3",
        prompt: "otter",
        n: 2,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("n=1");
  });

  it("rejects invalid prompt length for dall-e-2", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "dall-e-2",
        prompt: "x".repeat(1001),
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("1000");
  });

  it("accepts valid implicit dall-e-2 generations requests", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        prompt: "otter",
        response_format: "url",
        size: "1024x1024",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("treats chatgpt-image-latest as a GPT image model on generations", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "chatgpt-image-latest",
        prompt: "otter",
        output_format: "png",
      },
    });

    expect(result.ok).toBe(true);
  });

  it("fails open for gpt-image-2 until the API reference documents its matrix", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/generations",
      body: {
        model: "gpt-image-2",
        prompt: "otter",
        background: "transparent",
        output_format: "png",
        size: "2048x2048",
        response_format: "url",
      },
    });

    expect(result.ok).toBe(true);
  });
});

describe("openai-image-compat - edits constraints", () => {
  it("rejects edit requests without images", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {
        model: "gpt-image-1.5",
        prompt: "edit this",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("images");
  });

  it("rejects masks that provide both file_id and image_url", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {
        model: "gpt-image-1.5",
        prompt: "edit this",
        images: [{ file_id: "file-1" }],
        mask: {
          file_id: "mask-file",
          image_url: "https://example.com/mask.png",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("mask");
  });

  it("rejects dall-e-3 on /images/edits", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {
        model: "dall-e-3",
        prompt: "edit this",
        images: [{ file_id: "file-1" }],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("dall-e-3");
  });

  it("rejects GPT edits with more than 16 input images", async () => {
    const images = Array.from({ length: 17 }, (_, index) => ({
      image_url: `https://example.com/${index}.png`,
    }));

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {
        model: "gpt-image-1.5",
        prompt: "edit this",
        images,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("16");
  });

  it("rejects multipart edits without input images", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "edit this"],
      ],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("image");
  });

  it("rejects repeated multipart prompt fields", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "safe text"],
        ["prompt", "blocked text"],
      ],
      files: [["image[]", createPngFile("source.png", 32, 32)]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain('multipart field "prompt"');
  });

  it("accepts valid multipart GPT edits requests", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "edit this"],
        ["output_format", "png"],
        ["size", "1024x1024"],
        ["stream", "true"],
      ],
      files: [["image[]", createPngFile("source.png", 32, 32)]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/edits",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(true);
  });
});

describe("openai-image-compat - variations constraints", () => {
  it("rejects non-multipart variation requests", async () => {
    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/variations",
      body: { image: "x" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("multipart/form-data");
  });

  it("rejects variation models other than dall-e-2", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/variations",
      fields: [["model", "gpt-image-1.5"]],
      files: [["image", createPngFile("square.png", 32, 32)]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/variations",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("dall-e-2");
  });

  it("rejects non-PNG variation files", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/variations",
      files: [["image", new File(["gif"], "image.gif", { type: "image/gif" })]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/variations",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("PNG");
  });

  it("rejects non-square PNG variation files", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/variations",
      files: [["image", createPngFile("wide.png", 64, 32)]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/variations",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("square");
  });

  it("accepts valid square PNG variation files", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/variations",
      files: [["image", createPngFile("square.png", 64, 64)]],
    });

    const result = await validateOpenAIImageRequest({
      pathname: "/v1/images/variations",
      body: {},
      imageRequestMetadata: metadata,
    });

    expect(result.ok).toBe(true);
  });
});

describe("openai-image-compat - multipart helpers", () => {
  it("parses multipart model fields and serializes rewritten models", async () => {
    const metadata = await createMultipartMetadata({
      pathname: "/v1/images/edits",
      fields: [
        ["model", "gpt-image-1.5"],
        ["prompt", "edit this"],
      ],
      files: [["image[]", createPngFile("source.png", 32, 32)]],
    });

    setOpenAIImageMultipartModel(metadata, "redirected-model");
    const serialized = await serializeOpenAIImageMultipartRequest(metadata);
    const bodyText = new TextDecoder().decode(serialized.body);

    expect(serialized.contentType).toContain("multipart/form-data");
    expect(bodyText).toContain('name="model"');
    expect(bodyText).toContain("redirected-model");
  });
});

describe("openai-image-compat - provider sanitizer", () => {
  it("strips response_format for YunAI Azure generations requests", () => {
    const body: Record<string, unknown> = {
      prompt: "otter",
      response_format: "url",
    };

    const stripped = sanitizeGenerationsRequestForProvider(
      body,
      createProvider("YunAI Azure", "https://yunai.azure.example.com/openai")
    );

    expect(stripped).toBe(true);
    expect(body.response_format).toBeUndefined();
  });

  it("keeps response_format for other providers", () => {
    const body: Record<string, unknown> = {
      prompt: "otter",
      response_format: "url",
    };

    const stripped = sanitizeGenerationsRequestForProvider(
      body,
      createProvider("Regular OpenAI", "https://api.example.com/openai")
    );

    expect(stripped).toBe(false);
    expect(body.response_format).toBe("url");
  });
});
