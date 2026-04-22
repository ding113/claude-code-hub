import { describe, expect, it, vi } from "vitest";

vi.mock("@/drizzle/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock("@/drizzle/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/drizzle/schema")>();
  return {
    ...actual,
    messageRequest: {},
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/sensitive-word-detector", () => ({
  sensitiveWordDetector: {
    isEmpty: vi.fn(() => false),
    detect: vi.fn((text: string) =>
      text.includes("blocked")
        ? {
            matched: true,
            word: "blocked",
            matchType: "contains",
            matchedText: "blocked",
          }
        : { matched: false }
    ),
  },
}));

import { ProxySensitiveWordGuard } from "@/app/v1/_lib/proxy/sensitive-word-guard";
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

describe("ProxySensitiveWordGuard - multipart image logical body", () => {
  it("inspects multipart image prompt text via the logical body view", async () => {
    const formData = new FormData();
    formData.append("model", "gpt-image-1.5");
    formData.append("prompt", "this is blocked content");
    formData.append(
      "image[]",
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      "image.png"
    );

    const request = new Request("https://proxy.example.com/v1/images/edits", {
      method: "POST",
      body: formData,
    });
    const session = await ProxySession.fromContext(createContext(request));
    session.authState = {
      success: true,
      user: { id: 1, name: "tester" } as any,
      key: { id: 2 } as any,
      apiKey: "sk-test",
    };

    const response = await ProxySensitiveWordGuard.ensure(session);

    expect(response?.status).toBe(400);
    expect(await response?.text()).toContain("敏感词");
  });

  it("inspects repeated multipart prompt fields via the logical body array view", async () => {
    const formData = new FormData();
    formData.append("model", "gpt-image-1.5");
    formData.append("prompt", "safe content");
    formData.append("prompt", "blocked content");
    formData.append(
      "image[]",
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
      "image.png"
    );

    const request = new Request("https://proxy.example.com/v1/images/edits", {
      method: "POST",
      body: formData,
    });
    const session = await ProxySession.fromContext(createContext(request));
    session.authState = {
      success: true,
      user: { id: 1, name: "tester" } as any,
      key: { id: 2 } as any,
      apiKey: "sk-test",
    };

    const response = await ProxySensitiveWordGuard.ensure(session);

    expect(response?.status).toBe(400);
  });
});
