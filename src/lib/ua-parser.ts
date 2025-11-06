/**
 * 客户端信息
 */
export interface ClientInfo {
  /**
   * 客户端类型
   *
   * 可能的值：
   * - "claude-vscode": VSCode 插件
   * - "claude-cli": 纯 CLI
   * - "claude-cli-unknown": 无法识别的旧版本
   * - "anthropic-sdk-typescript": SDK
   * - 其他客户端类型
   */
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
 * - claude-cli/2.0.31 (external, claude-vscode, agent-sdk/0.1.30) -> clientType: "claude-vscode"
 * - claude-cli/2.0.32 (external, cli) -> clientType: "claude-cli"
 * - claude-cli/2.0.20 -> clientType: "claude-cli-unknown"
 * - anthropic-sdk-typescript/1.0.0 -> clientType: "anthropic-sdk-typescript"
 *
 * @param ua - User-Agent 字符串
 * @returns 解析结果，失败返回 null
 *
 * @example
 * ```typescript
 * const result = parseUserAgent("claude-cli/2.0.31 (external, claude-vscode, agent-sdk/0.1.30)");
 * // { clientType: "claude-vscode", version: "2.0.31", raw: "..." }
 *
 * const result2 = parseUserAgent("claude-cli/2.0.33 (external, cli)");
 * // { clientType: "claude-cli", version: "2.0.33", raw: "..." }
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

  const baseClientType = match[1]; // 如 "claude-cli"
  const version = match[2]; // 如 "2.0.31"

  // 如果基础类型不是 "claude-cli"，直接返回原始类型（如 "anthropic-sdk-typescript"）
  if (baseClientType !== "claude-cli") {
    return {
      clientType: baseClientType,
      version,
      raw: ua,
    };
  }

  // 对于 "claude-cli"，需要解析括号内的标记来区分 VSCode 插件和纯 CLI
  const finalClientType = determineClaudeClientType(ua);

  return {
    clientType: finalClientType,
    version,
    raw: ua,
  };
}

/**
 * 根据 User-Agent 中的标记，确定 Claude 客户端的具体类型
 *
 * @param ua - User-Agent 字符串
 * @returns 客户端类型：'claude-vscode' | 'claude-cli' | 'claude-cli-unknown'
 *
 * 识别规则：
 * - 包含 'claude-vscode' -> 'claude-vscode'（优先级最高）
 * - 包含 'cli' -> 'claude-cli'
 * - 都不包含 -> 'claude-cli-unknown'（旧版本或无法识别）
 */
function determineClaudeClientType(ua: string): string {
  // 优先检测 VSCode 插件标记
  if (ua.includes("claude-vscode")) {
    return "claude-vscode";
  }

  // 检测纯 CLI 标记（通常是 "(external, cli)" 格式）
  if (ua.includes("cli")) {
    return "claude-cli";
  }

  // 无法识别的旧版本或格式
  return "claude-cli-unknown";
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

/**
 * 获取客户端类型的友好显示名称
 *
 * @param clientType - 客户端类型
 * @returns 友好的显示名称
 *
 * @example
 * ```typescript
 * getClientTypeDisplayName("claude-vscode")        // "Claude VSCode Extension"
 * getClientTypeDisplayName("claude-cli")           // "Claude CLI"
 * getClientTypeDisplayName("claude-cli-unknown")   // "Claude CLI (Unknown Version)"
 * getClientTypeDisplayName("anthropic-sdk-typescript") // "Anthropic SDK (TypeScript)"
 * ```
 */
export function getClientTypeDisplayName(clientType: string): string {
  const displayNames: Record<string, string> = {
    "claude-vscode": "Claude VSCode Extension",
    "claude-cli": "Claude CLI",
    "claude-cli-unknown": "Claude CLI (Unknown Version)",
    "anthropic-sdk-typescript": "Anthropic SDK (TypeScript)",
  };

  return displayNames[clientType] || clientType;
}
