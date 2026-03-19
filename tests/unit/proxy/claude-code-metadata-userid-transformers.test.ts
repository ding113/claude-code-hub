import { describe, expect, test, vi } from "vitest";
import { parseClaudeCodeMetadataUserId } from "@/lib/claude-code-metadata-userid";
import { transformCodexRequestToClaude } from "@/app/v1/_lib/converters/codex-to-claude/request";
import { transformGeminiCLIRequestToClaude } from "@/app/v1/_lib/converters/gemini-cli-to-claude/request";

vi.mock("@/lib/config", () => ({
  getSystemSettingsSnapshot: () => ({
    enableClaudeCodeJsonUserIdFormat: true,
  }),
}));

describe("Claude Code metadata.user_id 转换器兼容", () => {
  test("Codex -> Claude 应产出新格式 user_id，并保留 session_id", () => {
    const result = transformCodexRequestToClaude(
      "claude-4.5-sonnet",
      {
        model: "gpt-5",
        input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
        metadata: {
          session_id: "sess_codex_12345678901234567890",
        },
      },
      false
    ) as {
      metadata?: {
        user_id?: string;
      };
    };

    const parsed = parseClaudeCodeMetadataUserId(result.metadata?.user_id);
    expect(parsed?.format).toBe("json");
    expect(parsed?.sessionId).toBe("sess_codex_12345678901234567890");
  });

  test("Gemini CLI -> Claude 应产出新格式 user_id", () => {
    const result = transformGeminiCLIRequestToClaude(
      "claude-4.5-sonnet",
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "hello" }] }],
        },
      },
      false
    ) as {
      metadata?: {
        user_id?: string;
      };
    };

    const parsed = parseClaudeCodeMetadataUserId(result.metadata?.user_id);
    expect(parsed?.format).toBe("json");
    expect(parsed?.sessionId).toBeTruthy();
  });
});
