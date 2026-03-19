import { describe, expect, test } from "vitest";
import {
  buildClaudeCodeMetadataUserId,
  extractSessionIdFromClaudeCodeMetadataUserId,
  parseClaudeCodeMetadataUserId,
} from "@/lib/claude-code-metadata-userid";

describe("Claude Code metadata.user_id 协议层", () => {
  test("应兼容解析旧格式 user_id", () => {
    const parsed = parseClaudeCodeMetadataUserId("user_deadbeef_account_acc-123_session_sess-456");

    expect(parsed).toEqual({
      format: "legacy",
      raw: "user_deadbeef_account_acc-123_session_sess-456",
      deviceId: "deadbeef",
      accountUuid: "acc-123",
      sessionId: "sess-456",
    });
  });

  test("应兼容解析新格式 json user_id", () => {
    const value = 'json{"device_id":"dev-1","account_uuid":"acc-2","session_id":"sess-3"}';

    const parsed = parseClaudeCodeMetadataUserId(value);

    expect(parsed).toEqual({
      format: "json",
      raw: value,
      deviceId: "dev-1",
      accountUuid: "acc-2",
      sessionId: "sess-3",
    });
  });

  test("构造后应可回解析并保留 session_id", () => {
    const built = buildClaudeCodeMetadataUserId({
      deviceId: "dev-x",
      accountUuid: "acc-y",
      sessionId: "sess-z",
    });

    expect(built.startsWith("json{")).toBe(true);
    expect(extractSessionIdFromClaudeCodeMetadataUserId(built)).toBe("sess-z");
  });
});
