import { describe, expect, test } from "vitest";
import { rectifyBillingHeader } from "@/app/v1/_lib/proxy/billing-header-rectifier";
import { rectifySystemMessages } from "@/app/v1/_lib/proxy/system-message-rectifier";

describe("rectifySystemMessages", () => {
  test("system message with string content, no top-level system - moves it into system array", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "The following skills are available: ..." },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(result.extractedValues).toEqual(["The following skills are available: ..."]);
    expect(message.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(message.system).toEqual([
      { type: "text", text: "The following skills are available: ..." },
    ]);
  });

  test("system message with existing top-level system array - appends to the end", () => {
    const message: Record<string, unknown> = {
      system: [{ type: "text", text: "You are a helpful assistant." }],
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "skills list" },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(message.system).toEqual([
      { type: "text", text: "You are a helpful assistant." },
      { type: "text", text: "skills list" },
    ]);
  });

  test("system message with existing top-level system string - converts string to leading text block", () => {
    const message: Record<string, unknown> = {
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "skills list" },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(message.system).toEqual([
      { type: "text", text: "You are a helpful assistant." },
      { type: "text", text: "skills list" },
    ]);
  });

  test("system message with array content - keeps text blocks including extra fields", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "system",
          content: [
            { type: "text", text: "skills list", cache_control: { type: "ephemeral" } },
            { type: "image", source: { type: "base64", data: "..." } },
          ],
        },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(result.extractedValues).toEqual(["skills list"]);
    expect(message.system).toEqual([
      { type: "text", text: "skills list", cache_control: { type: "ephemeral" } },
    ]);
  });

  test("multiple system messages - moves all, preserves order", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "system", content: "first" },
        { role: "user", content: "hi" },
        { role: "system", content: "second" },
        { role: "assistant", content: "hello" },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(2);
    expect(result.extractedValues).toEqual(["first", "second"]);
    expect(message.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(message.system).toEqual([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
  });

  test("no system messages - applied=false, messages unchanged", () => {
    const original = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const message: Record<string, unknown> = {
      messages: [...original],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(false);
    expect(result.movedCount).toBe(0);
    expect(result.extractedValues).toEqual([]);
    expect(message.messages).toEqual(original);
    expect(message.system).toBeUndefined();
  });

  test("messages missing - applied=false", () => {
    const message: Record<string, unknown> = {};

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(false);
    expect(result.movedCount).toBe(0);
  });

  test("messages is not an array - applied=false", () => {
    const message: Record<string, unknown> = { messages: "not-an-array" };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(false);
  });

  test("system message with empty string content - removed from messages without adding empty block", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "" },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(result.extractedValues).toEqual([]);
    expect(message.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(message.system).toBeUndefined();
  });

  test("system message with non-string non-array content - removed without merging", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: { unexpected: true } },
      ],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(result.extractedValues).toEqual([]);
    expect(message.system).toBeUndefined();
  });

  test("top-level system is empty string - no empty leading block", () => {
    const message: Record<string, unknown> = {
      system: "",
      messages: [{ role: "system", content: "skills list" }],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(message.system).toEqual([{ type: "text", text: "skills list" }]);
  });

  test("top-level system has unknown type - replaced with extracted blocks", () => {
    const message: Record<string, unknown> = {
      system: 42,
      messages: [{ role: "system", content: "skills list" }],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(message.system).toEqual([{ type: "text", text: "skills list" }]);
  });

  test("mutates messages array in place (same reference)", () => {
    const messagesRef: unknown[] = [
      { role: "user", content: "hi" },
      { role: "system", content: "skills list" },
    ];
    const message: Record<string, unknown> = { messages: messagesRef };

    rectifySystemMessages(message);

    expect(message.messages).toBe(messagesRef);
    expect(messagesRef).toHaveLength(1);
  });

  test("mutates existing system array in place (same reference)", () => {
    const systemRef: unknown[] = [{ type: "text", text: "base prompt" }];
    const message: Record<string, unknown> = {
      system: systemRef,
      messages: [{ role: "system", content: "skills list" }],
    };

    rectifySystemMessages(message);

    expect(message.system).toBe(systemRef);
    expect(systemRef).toHaveLength(2);
  });

  test("billing header inside system message is stripped when billing rectifier runs after (forwarder order)", () => {
    const message: Record<string, unknown> = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "system",
          content: [
            { type: "text", text: "skills list" },
            { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.172;" },
          ],
        },
      ],
    };

    const systemResult = rectifySystemMessages(message);
    const billingResult = rectifyBillingHeader(message);

    expect(systemResult.applied).toBe(true);
    expect(billingResult.applied).toBe(true);
    expect(billingResult.removedCount).toBe(1);
    expect(message.system).toEqual([{ type: "text", text: "skills list" }]);
  });

  test("null and non-object entries in messages are preserved", () => {
    const message: Record<string, unknown> = {
      messages: [null, "weird", { role: "system", content: "skills list" }, { role: "user" }],
    };

    const result = rectifySystemMessages(message);

    expect(result.applied).toBe(true);
    expect(result.movedCount).toBe(1);
    expect(message.messages).toEqual([null, "weird", { role: "user" }]);
  });
});
