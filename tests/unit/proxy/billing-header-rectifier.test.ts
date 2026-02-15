import { describe, expect, test } from "vitest";
import { rectifyBillingHeader } from "@/app/v1/_lib/proxy/billing-header-rectifier";

describe("rectifyBillingHeader", () => {
  test("system array with single billing header block - removes it and returns extractedValues", () => {
    const message: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "x-anthropic-billing-header: cc_version=2.1.36; cc_entrypoint=cli; cch=1;",
        },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(result.extractedValues).toEqual([
      "x-anthropic-billing-header: cc_version=2.1.36; cc_entrypoint=cli; cch=1;",
    ]);
    expect(message.system).toEqual([]);
  });

  test("system array with multiple billing header blocks - removes all", () => {
    const message: Record<string, unknown> = {
      system: [
        { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.36;" },
        { type: "text", text: "x-anthropic-billing-header: cc_entrypoint=cli;" },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(2);
    expect(result.extractedValues).toHaveLength(2);
    expect(message.system).toEqual([]);
  });

  test("system array with no billing header - applied=false, array unchanged", () => {
    const blocks = [
      { type: "text", text: "You are a helpful assistant." },
      { type: "text", text: "Follow instructions carefully." },
    ];
    const message: Record<string, unknown> = {
      system: [...blocks],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(result.extractedValues).toEqual([]);
    expect(message.system).toEqual(blocks);
  });

  test("system array with billing header mixed with real prompts - only removes billing header blocks", () => {
    const message: Record<string, unknown> = {
      system: [
        { type: "text", text: "You are a helpful assistant." },
        { type: "text", text: "x-anthropic-billing-header: cc_version=2.1.36; cch=1;" },
        { type: "text", text: "Follow instructions carefully." },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(message.system).toEqual([
      { type: "text", text: "You are a helpful assistant." },
      { type: "text", text: "Follow instructions carefully." },
    ]);
  });

  test("system as plain string that IS a billing header - deletes system field", () => {
    const message: Record<string, unknown> = {
      system: "x-anthropic-billing-header: cc_version=2.1.36;",
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(result.extractedValues).toEqual(["x-anthropic-billing-header: cc_version=2.1.36;"]);
    expect(message.system).toBeUndefined();
  });

  test("system as plain string that is NOT a billing header - applied=false", () => {
    const message: Record<string, unknown> = {
      system: "You are a helpful assistant.",
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(message.system).toBe("You are a helpful assistant.");
  });

  test("system undefined/missing - applied=false", () => {
    const message: Record<string, unknown> = { model: "claude-3" };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(result.extractedValues).toEqual([]);
  });

  test("system null - applied=false", () => {
    const message: Record<string, unknown> = { system: null };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
  });

  test("billing header mid-string (not at start) - should NOT remove", () => {
    const message: Record<string, unknown> = {
      system: [
        {
          type: "text",
          text: "Some preamble text x-anthropic-billing-header: cc_version=2.1.36;",
        },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
    expect((message.system as unknown[]).length).toBe(1);
  });

  test("case insensitivity (X-Anthropic-Billing-Header:)", () => {
    const message: Record<string, unknown> = {
      system: [{ type: "text", text: "X-Anthropic-Billing-Header: cc_version=2.1.36;" }],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(message.system).toEqual([]);
  });

  test("system array becoming empty after removal - remains empty array", () => {
    const message: Record<string, unknown> = {
      system: [
        { type: "text", text: "x-anthropic-billing-header: val1" },
        { type: "text", text: "x-anthropic-billing-header: val2" },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(2);
    expect(message.system).toEqual([]);
  });

  test("various billing header value formats", () => {
    const message: Record<string, unknown> = {
      system: [
        { type: "text", text: "x-anthropic-billing-header:cc_version=2.1.36" },
        {
          type: "text",
          text: "  x-anthropic-billing-header: cc_version=2.2.0; cc_entrypoint=vscode;",
        },
        { type: "text", text: "x-anthropic-billing-header:  " },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(3);
    expect(result.extractedValues).toHaveLength(3);
    expect(message.system).toEqual([]);
  });

  test("non-text type blocks are preserved", () => {
    const message: Record<string, unknown> = {
      system: [
        { type: "image", source: { type: "base64" } },
        { type: "text", text: "x-anthropic-billing-header: val" },
        { type: "text", text: "Keep this" },
      ],
    };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(message.system).toEqual([
      { type: "image", source: { type: "base64" } },
      { type: "text", text: "Keep this" },
    ]);
  });

  test("system as non-string non-array type (e.g. number) - no-op", () => {
    const message: Record<string, unknown> = { system: 42 };

    const result = rectifyBillingHeader(message);

    expect(result.applied).toBe(false);
    expect(result.removedCount).toBe(0);
    expect(message.system).toBe(42);
  });
});
