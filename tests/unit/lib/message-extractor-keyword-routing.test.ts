import { describe, expect, it } from "vitest";
import { extractKeywordRoutingTexts } from "@/lib/message-extractor";

describe("extractKeywordRoutingTexts", () => {
  describe("Claude 格式", () => {
    it("提取字符串形式的 system 到 systemTexts", () => {
      const result = extractKeywordRoutingTexts({
        system: "You are a helpful assistant",
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.systemTexts).toEqual(["You are a helpful assistant"]);
      expect(result.lastUserTexts).toEqual(["hello"]);
    });

    it("提取 content block 数组形式的 system 到 systemTexts", () => {
      const result = extractKeywordRoutingTexts({
        system: [
          { type: "text", text: "block one" },
          { type: "text", text: "block two" },
        ],
      });

      expect(result.systemTexts).toEqual(["block one", "block two"]);
      expect(result.lastUserTexts).toEqual([]);
    });

    it("多轮对话仅提取最后一条 user 消息", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          { role: "user", content: "first question" },
          { role: "assistant", content: "first answer" },
          { role: "user", content: "second question" },
          { role: "assistant", content: "second answer" },
          { role: "user", content: "final question" },
        ],
      });

      expect(result.lastUserTexts).toEqual(["final question"]);
      expect(result.lastUserTexts).not.toContain("first question");
      expect(result.lastUserTexts).not.toContain("second question");
      expect(result.systemTexts).toEqual([]);
    });

    it("完全忽略 assistant 消息", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          { role: "user", content: "question" },
          { role: "assistant", content: "assistant text" },
        ],
      });

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual(["question"]);
    });
  });

  describe("OpenAI Chat 格式", () => {
    it("role=system 与 role=developer 的消息进入 systemTexts", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          { role: "system", content: "system prompt" },
          { role: "developer", content: "developer prompt" },
          { role: "user", content: "user prompt" },
        ],
      });

      expect(result.systemTexts).toEqual(["system prompt", "developer prompt"]);
      expect(result.lastUserTexts).toEqual(["user prompt"]);
    });

    it("最后一条 user 消息的 content block 数组被正确提取", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          { role: "user", content: "earlier" },
          {
            role: "user",
            content: [
              { type: "text", text: "part one" },
              { type: "image_url", image_url: { url: "https://example.com/a.png" } },
              { type: "text", text: "part two" },
            ],
          },
        ],
      });

      expect(result.lastUserTexts).toEqual(["part one", "part two"]);
      expect(result.lastUserTexts).not.toContain("earlier");
    });
  });

  describe("Codex / Response API 格式", () => {
    it("顶层 instructions 字符串进入 systemTexts", () => {
      const result = extractKeywordRoutingTexts({
        instructions: "Always respond in English",
        input: [{ role: "user", content: "hi" }],
      });

      expect(result.systemTexts).toEqual(["Always respond in English"]);
      expect(result.lastUserTexts).toEqual(["hi"]);
    });

    it("input 数组中 system/developer 进入 systemTexts，仅最后一条 user 进入 lastUserTexts", () => {
      const result = extractKeywordRoutingTexts({
        input: [
          { role: "system", content: "input system" },
          { role: "developer", content: "input developer" },
          { role: "user", content: [{ type: "input_text", text: "first input" }] },
          { role: "assistant", content: "irrelevant" },
          { role: "user", content: [{ type: "input_text", text: "last input" }] },
        ],
      });

      expect(result.systemTexts).toEqual(["input system", "input developer"]);
      expect(result.lastUserTexts).toEqual(["last input"]);
      expect(result.lastUserTexts).not.toContain("first input");
    });

    it("字符串形式的 input 进入 lastUserTexts", () => {
      const result = extractKeywordRoutingTexts({
        model: "gpt-5.2",
        input: "please ultrathink about this",
      });

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual(["please ultrathink about this"]);
    });
  });

  describe("顶层 prompt 字段", () => {
    it("字符串形式的 prompt 进入 lastUserTexts", () => {
      const result = extractKeywordRoutingTexts({ prompt: "draw a cat" });

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual(["draw a cat"]);
    });

    it("字符串数组形式的 prompt 进入 lastUserTexts", () => {
      const result = extractKeywordRoutingTexts({ prompt: ["draw a cat", "draw a dog"] });

      expect(result.lastUserTexts).toEqual(["draw a cat", "draw a dog"]);
    });
  });

  describe("边界情况", () => {
    it("空消息对象返回两个空数组", () => {
      const result = extractKeywordRoutingTexts({});

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual([]);
    });

    it("跳过非对象的消息条目与数字 content", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          "not an object",
          42,
          null,
          { role: "user", content: 123 },
          { role: "system", content: 456 },
          { role: "user", content: "valid" },
        ],
      });

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual(["valid"]);
    });

    it("过滤空字符串", () => {
      const result = extractKeywordRoutingTexts({
        system: "",
        instructions: "",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "" },
        ],
        prompt: ["", "non-empty"],
      });

      expect(result.systemTexts).toEqual([]);
      expect(result.lastUserTexts).toEqual(["non-empty"]);
    });

    it("最后一条 user 消息为 malformed 时 lastUserTexts 为空", () => {
      const result = extractKeywordRoutingTexts({
        messages: [
          { role: "user", content: "earlier" },
          { role: "user", content: { nested: "object" } },
        ],
      });

      expect(result.lastUserTexts).toEqual([]);
    });
  });
});
