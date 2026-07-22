import { describe, expect, it } from "vitest";
import {
  computeFingerprintChain,
  DEFAULT_AFFINITY_WINDOW,
  type FingerprintChain,
  fingerprintsDeepestFirst,
  fingerprintTip,
  MAX_AFFINITY_WINDOW,
} from "@/app/v1/_lib/proxy/affinity/fingerprint";

const HEX32 = /^[0-9a-f]{32}$/;

function claudeBody(
  messages: unknown[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    model: "claude-sonnet-4-5",
    system: "You are a helpful assistant.",
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } } },
      },
      {
        name: "bash",
        description: "Run a command",
        input_schema: { type: "object", properties: { cmd: { type: "string" } } },
      },
    ],
    messages,
    ...overrides,
  };
}

const U1 = { role: "user", content: "hello" };
const A1 = { role: "assistant", content: [{ type: "text", text: "hi there" }] };
const U2 = { role: "user", content: "next question" };

function mustChain(body: Record<string, unknown>, format = "claude", window?: number) {
  const chain = computeFingerprintChain(
    body,
    format as Parameters<typeof computeFingerprintChain>[1],
    window
  );
  expect(chain).not.toBeNull();
  return chain as FingerprintChain;
}

function allFps(chain: FingerprintChain): string[] {
  return [chain.sys.fp, ...chain.tail.map((b) => b.fp)];
}

describe("computeFingerprintChain - determinism", () => {
  it("produces identical chains for identical input", () => {
    const a = mustChain(claudeBody([U1, A1, U2]));
    const b = mustChain(claudeBody([U1, A1, U2]));
    expect(a).toEqual(b);
  });

  it("emits 32-hex fingerprints and monotonically increasing prefixBytes", () => {
    const chain = mustChain(claudeBody([U1, A1]));
    expect(chain.sys.fp).toMatch(HEX32);
    expect(chain.sys.depth).toBe(0);
    let prevBytes = chain.sys.prefixBytes;
    for (const [i, boundary] of chain.tail.entries()) {
      expect(boundary.fp).toMatch(HEX32);
      expect(boundary.depth).toBe(i + 1);
      expect(boundary.prefixBytes).toBeGreaterThan(prevBytes);
      prevBytes = boundary.prefixBytes;
    }
  });
});

describe("computeFingerprintChain - prefix extension", () => {
  it("appending a message extends the chain at the tail without changing prior boundaries", () => {
    const base = mustChain(claudeBody([U1, A1]));
    const extended = mustChain(claudeBody([U1, A1, U2]));

    expect(extended.sys).toEqual(base.sys);
    expect(extended.tail).toHaveLength(3);
    expect(extended.tail.slice(0, 2)).toEqual(base.tail);
    expect(fingerprintTip(base).fp).toBe(extended.tail[1].fp);
    expect(fingerprintTip(extended).fp).toBe(extended.tail[2].fp);
  });

  it("editing an early message changes that boundary and all deeper ones", () => {
    const a = mustChain(claudeBody([U1, A1, U2]));
    const b = mustChain(claudeBody([{ role: "user", content: "hello!" }, A1, U2]));
    expect(b.sys.fp).toBe(a.sys.fp);
    expect(b.tail[0].fp).not.toBe(a.tail[0].fp);
    expect(b.tail[1].fp).not.toBe(a.tail[1].fp);
    expect(b.tail[2].fp).not.toBe(a.tail[2].fp);
  });
});

describe("computeFingerprintChain - volatile field stripping", () => {
  it("claude tool_use id and tool_result tool_use_id do not affect fingerprints", () => {
    const withIds = (toolUseId: string) => [
      U1,
      {
        role: "assistant",
        content: [{ type: "tool_use", id: toolUseId, name: "read_file", input: { path: "a.ts" } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseId, content: "file body" }],
      },
    ];
    const a = mustChain(claudeBody(withIds("toolu_aaa")));
    const b = mustChain(claudeBody(withIds("toolu_bbb")));
    expect(a).toEqual(b);
  });

  it("claude tool_use input changes DO affect fingerprints", () => {
    const withInput = (path: string) => [
      U1,
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "read_file", input: { path } }],
      },
    ];
    const a = mustChain(claudeBody(withInput("a.ts")));
    const b = mustChain(claudeBody(withInput("b.ts")));
    expect(b.tail[1].fp).not.toBe(a.tail[1].fp);
  });

  it("claude thinking signature is not hashed", () => {
    const withSig = (signature: string) => [
      U1,
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "step by step", signature }],
      },
    ];
    const a = mustChain(claudeBody(withSig("sig-one")));
    const b = mustChain(claudeBody(withSig("sig-two")));
    expect(a).toEqual(b);
  });

  it("unknown block types strip volatile keys via default branch", () => {
    const withId = (id: string) => [
      U1,
      {
        role: "assistant",
        content: [{ type: "server_tool_use", id, name: "web_search", payload: { q: "x" } }],
      },
    ];
    const a = mustChain(claudeBody(withId("srvtoolu_1")));
    const b = mustChain(claudeBody(withId("srvtoolu_2")));
    expect(a).toEqual(b);
  });

  it("openai tool_call id and tool message tool_call_id do not affect fingerprints", () => {
    const body = (callId: string) => ({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: callId, type: "function", function: { name: "bash", arguments: '{"cmd":"ls"}' } },
          ],
        },
        { role: "tool", tool_call_id: callId, content: "ok" },
      ],
    });
    const a = mustChain(body("call_x"), "openai");
    const b = mustChain(body("call_y"), "openai");
    expect(a).toEqual(b);
  });
});

describe("computeFingerprintChain - cache_control boundaries", () => {
  it("marks hasCacheControl on the message boundary carrying an explicit breakpoint", () => {
    const chain = mustChain(
      claudeBody([
        U1,
        {
          role: "user",
          content: [{ type: "text", text: "long context", cache_control: { type: "ephemeral" } }],
        },
      ])
    );
    expect(chain.tail[0].hasCacheControl).toBeUndefined();
    expect(chain.tail[1].hasCacheControl).toBe(true);
  });

  it("cache_control marks the boundary without changing the fingerprint value", () => {
    const plain = mustChain(
      claudeBody([U1, { role: "user", content: [{ type: "text", text: "ctx" }] }])
    );
    const marked = mustChain(
      claudeBody([
        U1,
        {
          role: "user",
          content: [{ type: "text", text: "ctx", cache_control: { type: "ephemeral" } }],
        },
      ])
    );
    expect(marked.tail[1].fp).toBe(plain.tail[1].fp);
    expect(marked.tail[1].hasCacheControl).toBe(true);
  });
});

describe("computeFingerprintChain - window truncation", () => {
  const manyMessages = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  }));

  it("keeps only the deepest `window` boundaries and always retains sys", () => {
    const full = mustChain(claudeBody(manyMessages), "claude", MAX_AFFINITY_WINDOW);
    const cut = mustChain(claudeBody(manyMessages), "claude", 4);

    expect(full.tail).toHaveLength(10);
    expect(cut.tail).toHaveLength(4);
    expect(cut.tail).toEqual(full.tail.slice(-4));
    expect(cut.tail.map((b) => b.depth)).toEqual([7, 8, 9, 10]);
    expect(cut.sys).toEqual(full.sys);
  });

  it("falls back to the default window for non-positive or non-finite values", () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const chain = mustChain(claudeBody(manyMessages), "claude", bad);
      expect(chain.tail).toHaveLength(Math.min(10, DEFAULT_AFFINITY_WINDOW));
    }
  });

  it("caps the window at MAX_AFFINITY_WINDOW", () => {
    const long = Array.from({ length: MAX_AFFINITY_WINDOW + 10 }, (_, i) => ({
      role: "user",
      content: `m${i}`,
    }));
    const chain = mustChain(claudeBody(long), "claude", 1000);
    expect(chain.tail).toHaveLength(MAX_AFFINITY_WINDOW);
  });
});

describe("computeFingerprintChain - system/tools sensitivity", () => {
  it("system prompt change invalidates the whole chain", () => {
    const a = mustChain(claudeBody([U1, A1]));
    const b = mustChain(claudeBody([U1, A1], { system: "You are terse." }));
    for (const [fa, fb] of allFps(a).map((f, i) => [f, allFps(b)[i]])) {
      expect(fb).not.toBe(fa);
    }
  });

  it("tool definition change invalidates the whole chain", () => {
    const a = mustChain(claudeBody([U1, A1]));
    const b = mustChain(
      claudeBody([U1, A1], {
        tools: [
          { name: "read_file", description: "Read file v2", input_schema: { type: "object" } },
        ],
      })
    );
    for (const [fa, fb] of allFps(a).map((f, i) => [f, allFps(b)[i]])) {
      expect(fb).not.toBe(fa);
    }
  });

  it("tool ordering does not affect F_sys (sorted by name)", () => {
    const base = claudeBody([U1]);
    const reversed = claudeBody([U1], {
      tools: [...(base.tools as unknown[])].reverse(),
    });
    expect(mustChain(reversed)).toEqual(mustChain(base));
  });
});

describe("computeFingerprintChain - media digest", () => {
  const imageMessage = (data: string) => [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data } },
        { type: "text", text: "describe" },
      ],
    },
  ];

  it("same-length different image bytes produce different fingerprints", () => {
    const a = mustChain(claudeBody(imageMessage("AAAABBBB")));
    const b = mustChain(claudeBody(imageMessage("AAAACCCC")));
    expect(a.tail[0].fp).not.toBe(b.tail[0].fp);
  });

  it("identical image bytes produce identical fingerprints", () => {
    const a = mustChain(claudeBody(imageMessage("AAAABBBB")));
    const b = mustChain(claudeBody(imageMessage("AAAABBBB")));
    expect(a).toEqual(b);
  });

  it("url-based document sources hash the url", () => {
    const doc = (url: string) => [
      {
        role: "user",
        content: [{ type: "document", source: { media_type: "application/pdf", url } }],
      },
    ];
    const a = mustChain(claudeBody(doc("https://a.example/x.pdf")));
    const b = mustChain(claudeBody(doc("https://b.example/y.pdf")));
    expect(a.tail[0].fp).not.toBe(b.tail[0].fp);
  });
});

describe("computeFingerprintChain - edge cases", () => {
  it("empty messages array yields sys-only chain without throwing", () => {
    const chain = mustChain(claudeBody([]));
    expect(chain.tail).toHaveLength(0);
    expect(chain.sys.fp).toMatch(HEX32);
    expect(fingerprintTip(chain)).toBe(chain.sys);
    expect(fingerprintsDeepestFirst(chain)).toEqual([chain.sys.fp]);
  });

  it("missing system and tools still produce a valid chain", () => {
    const chain = mustChain({ messages: [U1] });
    expect(chain.tail).toHaveLength(1);
  });

  it("messages with empty content arrays are skipped as empty boundaries", () => {
    const chain = mustChain(claudeBody([{ role: "user", content: [] }, U1]));
    expect(chain.tail).toHaveLength(1);
    expect(chain.tail[0].depth).toBe(1);
  });

  it("returns null for missing messages, unknown formats and invalid input shape", () => {
    expect(computeFingerprintChain({}, "claude")).toBeNull();
    expect(computeFingerprintChain({ messages: "nope" }, "claude")).toBeNull();
    expect(
      computeFingerprintChain(
        claudeBody([U1]),
        "unknown" as Parameters<typeof computeFingerprintChain>[1]
      )
    ).toBeNull();
  });

  it("fails open (null) on pathological input instead of throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const body = claudeBody([
      { role: "user", content: [{ type: "weird_block", payload: cyclic }] },
    ]);
    expect(computeFingerprintChain(body, "claude")).toBeNull();
  });
});

describe("computeFingerprintChain - openai leading system merge", () => {
  it("leading system/developer messages fold into F_sys", () => {
    const body = {
      messages: [
        { role: "system", content: "sys prompt" },
        { role: "developer", content: "dev prompt" },
        { role: "user", content: "hi" },
      ],
    };
    const chain = mustChain(body, "openai");
    expect(chain.tail).toHaveLength(1);

    const changed = mustChain(
      {
        messages: [
          { role: "system", content: "sys prompt CHANGED" },
          { role: "developer", content: "dev prompt" },
          { role: "user", content: "hi" },
        ],
      },
      "openai"
    );
    expect(changed.sys.fp).not.toBe(chain.sys.fp);
    expect(changed.tail[0].fp).not.toBe(chain.tail[0].fp);
  });

  it("non-leading system messages stay in the conversation tail", () => {
    const chain = mustChain(
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "system", content: "late instruction" },
        ],
      },
      "openai"
    );
    expect(chain.tail).toHaveLength(2);
  });
});

describe("computeFingerprintChain - responses format", () => {
  it("string input becomes a single user boundary", () => {
    const chain = mustChain({ instructions: "be brief", input: "hello" }, "response");
    expect(chain.tail).toHaveLength(1);
  });

  it("function_call ids are stripped while name/arguments are hashed", () => {
    const body = (callId: string) => ({
      instructions: "be brief",
      input: [
        { type: "message", role: "user", content: "run" },
        { type: "function_call", call_id: callId, name: "bash", arguments: '{"cmd":"ls"}' },
        { type: "function_call_output", call_id: callId, output: "ok" },
        { type: "reasoning", summary: [{ type: "summary_text", text: "thought" }] },
      ],
    });
    expect(mustChain(body("c1"), "response")).toEqual(mustChain(body("c2"), "response"));
  });

  it("instructions change invalidates the whole chain", () => {
    const a = mustChain({ instructions: "be brief", input: "hello" }, "response");
    const b = mustChain({ instructions: "be verbose", input: "hello" }, "response");
    expect(b.sys.fp).not.toBe(a.sys.fp);
    expect(b.tail[0].fp).not.toBe(a.tail[0].fp);
  });

  it("returns null when input is neither string nor array", () => {
    expect(computeFingerprintChain({ input: 42 }, "response")).toBeNull();
  });
});

describe("computeFingerprintChain - gemini formats", () => {
  const geminiBody = {
    systemInstruction: { parts: [{ text: "sys" }] },
    tools: [
      {
        functionDeclarations: [
          { name: "search", description: "Search", parameters: { type: "object" } },
        ],
      },
    ],
    contents: [
      { role: "user", parts: [{ text: "hi" }] },
      {
        role: "model",
        parts: [{ functionCall: { name: "search", args: { q: "x" } } }],
      },
      {
        role: "user",
        parts: [
          { functionResponse: { name: "search", response: { hits: 1 }, id: "resp-1" } },
          { inlineData: { mimeType: "image/png", data: "AAAABBBB" } },
        ],
      },
    ],
  };

  it("hashes system instruction, flattened tools, parts and media digests", () => {
    const chain = mustChain(geminiBody, "gemini");
    expect(chain.tail).toHaveLength(3);

    const otherImage = structuredClone(geminiBody);
    (
      (otherImage.contents[2].parts as Record<string, unknown>[])[1].inlineData as Record<
        string,
        unknown
      >
    ).data = "AAAACCCC";
    expect(mustChain(otherImage, "gemini").tail[2].fp).not.toBe(chain.tail[2].fp);
  });

  it("gemini-cli wrapped request produces the same chain as bare gemini", () => {
    const wrapped = mustChain({ request: geminiBody }, "gemini-cli");
    expect(wrapped).toEqual(mustChain(geminiBody, "gemini"));
  });

  it("returns null when contents is missing", () => {
    expect(computeFingerprintChain({ systemInstruction: {} }, "gemini")).toBeNull();
  });
});

describe("fingerprintsDeepestFirst", () => {
  it("orders tail deepest-first with sys always last", () => {
    const chain = mustChain(claudeBody([U1, A1, U2]));
    const fps = fingerprintsDeepestFirst(chain);
    expect(fps).toEqual([chain.tail[2].fp, chain.tail[1].fp, chain.tail[0].fp, chain.sys.fp]);
  });
});

describe("computeFingerprintChain - remaining normalization branches", () => {
  it("supports claude system block arrays and skips non-object entries", () => {
    const chain = mustChain(
      claudeBody([null, U1, { role: "assistant", content: ["raw string block", null] }], {
        system: [{ type: "text", text: "block system" }, "loose text"],
      })
    );
    expect(chain.tail).toHaveLength(2);

    const otherSystem = mustChain(
      claudeBody([null, U1, { role: "assistant", content: ["raw string block", null] }], {
        system: [{ type: "text", text: "block system CHANGED" }, "loose text"],
      })
    );
    expect(otherSystem.sys.fp).not.toBe(chain.sys.fp);
  });

  it("hashes redacted_thinking and media without a source", () => {
    const chain = mustChain(
      claudeBody([
        {
          role: "assistant",
          content: [
            { type: "redacted_thinking", data: "opaque" },
            { type: "image", source: null },
          ],
        },
      ])
    );
    expect(chain.tail).toHaveLength(1);
  });

  it("hashes openai tools sorted by name and skips malformed entries", () => {
    const tools = [
      { type: "function", function: { name: "b_tool", description: "B", parameters: {} } },
      { type: "function", function: { name: "a_tool", description: "A", parameters: {} } },
      null,
      { type: "function", function: {} },
    ];
    const body = (order: unknown[]) => ({
      tools: order,
      messages: [{ role: "user", content: "hi" }, null],
    });
    const a = mustChain(body(tools), "openai");
    const b = mustChain(body([...tools].reverse()), "openai");
    expect(a).toEqual(b);

    const noTools = mustChain({ messages: [{ role: "user", content: "hi" }] }, "openai");
    expect(noTools.sys.fp).not.toBe(a.sys.fp);
  });

  it("skips non-object openai tool_calls entries", () => {
    const chain = mustChain(
      {
        messages: [
          { role: "user", content: "run" },
          { role: "assistant", content: null, tool_calls: [null, "junk"] },
        ],
      },
      "openai"
    );
    expect(chain.tail).toHaveLength(2);
  });

  it("hashes responses tools and unknown input item types", () => {
    const body = {
      instructions: "sys",
      tools: [{ name: "shell", description: "Run", parameters: { type: "object" } }],
      input: [
        null,
        { type: "custom_item", id: "vol-1", payload: { a: 1 } },
        { role: "user", content: "hi" },
      ],
    };
    const a = mustChain(body, "response");
    expect(a.tail).toHaveLength(2);

    const otherId = structuredClone(body);
    (otherId.input[1] as Record<string, unknown>).id = "vol-2";
    expect(mustChain(otherId, "response")).toEqual(a);
  });

  it("covers gemini bare tool declarations, fileData, unknown parts and null entries", () => {
    const body = {
      tools: [{ name: "bare_tool", description: "Bare", parameters: { type: "object" } }, null],
      contents: [
        null,
        {
          role: "user",
          parts: [
            null,
            { fileData: { mimeType: "video/mp4", fileUri: "gs://bucket/a.mp4" } },
            { unknownShape: true, id: "vol" },
          ],
        },
      ],
    };
    const a = mustChain(body, "gemini");
    expect(a.tail).toHaveLength(1);

    const otherUri = structuredClone(body);
    (
      (otherUri.contents[1]?.parts as Record<string, unknown>[])[1].fileData as Record<
        string,
        unknown
      >
    ).fileUri = "gs://bucket/b.mp4";
    expect(mustChain(otherUri, "gemini").tail[0].fp).not.toBe(a.tail[0].fp);

    const noTools = mustChain({ contents: body.contents }, "gemini");
    expect(noTools.sys.fp).not.toBe(a.sys.fp);
  });

  it("gemini-cli falls back to the top-level body when request is not an object", () => {
    const chain = mustChain(
      { request: "not-an-object", contents: [{ role: "user", parts: [{ text: "hi" }] }] },
      "gemini-cli"
    );
    expect(chain.tail).toHaveLength(1);
  });
});
