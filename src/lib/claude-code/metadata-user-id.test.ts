import { describe, expect, test } from "vitest";
import {
  buildClaudeMetadataDeviceId,
  buildClaudeMetadataUserId,
  CLAUDE_CODE_METADATA_USER_ID_JSON_SWITCH_VERSION,
  injectClaudeMetadataUserIdWithContext,
  parseClaudeMetadataUserId,
  resolveClaudeMetadataUserIdFormat,
} from "./metadata-user-id";

describe("Claude metadata.user_id helper", () => {
  test("解析旧格式 user_id 时应提取 sessionId 和 deviceId", () => {
    const userId =
      "user_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_account__session_sess_legacy_123";

    expect(parseClaudeMetadataUserId(userId)).toEqual({
      sessionId: "sess_legacy_123",
      format: "legacy",
      deviceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      accountUuid: null,
    });
  });

  test("解析 JSON 字符串 user_id 时应提取 sessionId 和 deviceId", () => {
    const userId = JSON.stringify({
      device_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      account_uuid: "",
      session_id: "sess_json_123",
    });

    expect(parseClaudeMetadataUserId(userId)).toEqual({
      sessionId: "sess_json_123",
      format: "json",
      deviceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      accountUuid: "",
    });
  });

  test("无法解析的 user_id 应返回空结果", () => {
    expect(parseClaudeMetadataUserId("not-a-valid-user-id")).toEqual({
      sessionId: null,
      format: null,
      deviceId: null,
      accountUuid: null,
    });
  });

  test("低于切换版本的 Claude Code 客户端应使用旧格式", () => {
    const keyId = 42;
    const sessionId = "sess_old_format";

    expect(resolveClaudeMetadataUserIdFormat("claude-cli/2.1.77 (external, cli)")).toBe("legacy");
    expect(
      buildClaudeMetadataUserId({
        keyId,
        sessionId,
        userAgent: "claude-cli/2.1.77 (external, cli)",
      })
    ).toBe(`user_${buildClaudeMetadataDeviceId(keyId)}_account__session_${sessionId}`);
  });

  test(`版本为 ${CLAUDE_CODE_METADATA_USER_ID_JSON_SWITCH_VERSION} 的客户端应使用 JSON 字符串`, () => {
    const keyId = 42;
    const sessionId = "sess_json_format";

    expect(resolveClaudeMetadataUserIdFormat("claude-cli/2.1.78 (external, cli)")).toBe("json");
    expect(
      JSON.parse(
        buildClaudeMetadataUserId({
          keyId,
          sessionId,
          userAgent: "claude-cli/2.1.78 (external, cli)",
        })
      )
    ).toEqual({
      device_id: buildClaudeMetadataDeviceId(keyId),
      account_uuid: "",
      session_id: sessionId,
    });
  });

  test("无法获取版本时应默认使用 JSON 字符串", () => {
    const keyId = 42;
    const sessionId = "sess_unknown_version";

    expect(resolveClaudeMetadataUserIdFormat(undefined)).toBe("json");
    expect(
      JSON.parse(
        buildClaudeMetadataUserId({
          keyId,
          sessionId,
        })
      )
    ).toEqual({
      device_id: buildClaudeMetadataDeviceId(keyId),
      account_uuid: "",
      session_id: sessionId,
    });
  });

  test("注入时应保留已有 metadata.user_id", () => {
    const message = {
      metadata: {
        user_id: "existing_user_id",
        source: "client",
      },
    };

    expect(
      injectClaudeMetadataUserIdWithContext(message, {
        keyId: 1,
        sessionId: "sess_should_not_override",
        userAgent: "claude-cli/2.1.78 (external, cli)",
      })
    ).toBe(message);
  });
});
