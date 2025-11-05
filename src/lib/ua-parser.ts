/**
 * 客户端信息
 */
export interface ClientInfo {
  /** 客户端类型，如 "claude-cli" */
  clientType: string;
  /** 版本号，如 "2.0.31" */
  version: string;
  /** 原始 UA 字符串 */
  raw: string;
}

/**
 * 解析 User-Agent 字符串，提取客户端类型和版本号
 *
 * 支持的格式示例：
 * - claude-cli/2.0.31 (external, claude-vscode, agent-sdk/0.1.30)
 * - claude-cli/2.0.32 (external, cli)
 * - anthropic-sdk-typescript/1.0.0
 *
 * @param ua - User-Agent 字符串
 * @returns 解析结果，失败返回 null
 *
 * @example
 * ```typescript
 * const result = parseUserAgent("claude-cli/2.0.31 (external, claude-vscode, agent-sdk/0.1.30)");
 * // { clientType: "claude-cli", version: "2.0.31", raw: "..." }
 * ```
 */
export function parseUserAgent(ua: string | null | undefined): ClientInfo | null {
  if (!ua || typeof ua !== "string") {
    return null;
  }

  // 正则匹配: {clientType}/{version} ...
  // 提取斜杠前的客户端名称和斜杠后的版本号（直到空格或字符串结束）
  const regex = /^([a-zA-Z0-9_-]+)\/([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?)/;
  const match = ua.match(regex);

  if (!match) {
    return null; // 解析失败，向后兼容
  }

  return {
    clientType: match[1], // 如 "claude-cli"
    version: match[2], // 如 "2.0.31"
    raw: ua,
  };
}

/**
 * 格式化客户端信息为显示字符串
 *
 * @param clientInfo - 客户端信息
 * @returns 格式化的字符串，如 "claude-cli v2.0.31"
 */
export function formatClientInfo(clientInfo: ClientInfo): string {
  return `${clientInfo.clientType} v${clientInfo.version}`;
}
