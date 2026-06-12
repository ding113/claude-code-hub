/**
 * 消息内容提取器
 *
 * 从 Request API 格式的消息中提取需要检测的文本内容
 * 支持：
 * - system 字段（string 或 array）
 * - messages 字段中 role='user' 的消息内容
 * - input 字段（Response API 格式）
 */

interface MessageBlock {
  type?: string;
  text?: string;
  content?: string;
}

interface Message {
  role?: string;
  content?: string | MessageBlock[];
}

/**
 * 从单个消息块中提取文本
 */
function extractTextFromBlock(block: unknown): string | null {
  if (typeof block === "string") {
    return block;
  }

  if (typeof block === "object" && block !== null) {
    const obj = block as Record<string, unknown>;

    // 优先提取 text 字段
    if (typeof obj.text === "string") {
      return obj.text;
    }

    // 兼容 content 字段
    if (typeof obj.content === "string") {
      return obj.content;
    }
  }

  return null;
}

/**
 * 从 system 字段中提取文本
 */
function extractSystemText(system: unknown): string[] {
  const texts: string[] = [];

  if (typeof system === "string") {
    texts.push(system);
  } else if (Array.isArray(system)) {
    system.forEach((item) => {
      const text = extractTextFromBlock(item);
      if (text) {
        texts.push(text);
      }
    });
  }

  return texts;
}

/**
 * 从 messages 数组中提取用户消息文本
 */
function extractMessagesText(messages: unknown): string[] {
  const texts: string[] = [];

  if (!Array.isArray(messages)) {
    return texts;
  }

  messages.forEach((msg) => {
    if (typeof msg !== "object" || msg === null) {
      return;
    }

    const message = msg as Message;

    // 仅提取用户消息
    if (message.role !== "user") {
      return;
    }

    // 处理 content 字段
    if (typeof message.content === "string") {
      texts.push(message.content);
    } else if (Array.isArray(message.content)) {
      message.content.forEach((block) => {
        const text = extractTextFromBlock(block);
        if (text) {
          texts.push(text);
        }
      });
    }
  });

  return texts;
}

/**
 * 从 input 字段中提取文本（Response API 格式）
 */
function extractInputText(input: unknown): string[] {
  const texts: string[] = [];

  if (!Array.isArray(input)) {
    return texts;
  }

  input.forEach((item) => {
    if (typeof item !== "object" || item === null) {
      return;
    }

    const obj = item as Record<string, unknown>;

    // 处理 role='user' 的消息
    if (obj.role !== "user") {
      return;
    }

    // 提取 content
    if (typeof obj.content === "string") {
      texts.push(obj.content);
    } else if (Array.isArray(obj.content)) {
      obj.content.forEach((block) => {
        const text = extractTextFromBlock(block);
        if (text) {
          texts.push(text);
        }
      });
    }
  });

  return texts;
}

/**
 * 关键词路由扫描文本
 *
 * systemTexts: 系统提示词文本（system / instructions / role=system|developer 消息）
 * lastUserTexts: 最后一条用户消息文本（含顶层 prompt）
 */
export interface KeywordRoutingScanTexts {
  systemTexts: string[];
  lastUserTexts: string[];
}

/**
 * 从单个消息条目的 content 字段中提取文本（string 或 content block 数组）
 */
function extractEntryContentTexts(entry: Record<string, unknown>): string[] {
  const texts: string[] = [];

  if (typeof entry.content === "string") {
    texts.push(entry.content);
  } else if (Array.isArray(entry.content)) {
    entry.content.forEach((block) => {
      const text = extractTextFromBlock(block);
      if (text) {
        texts.push(text);
      }
    });
  }

  return texts;
}

/**
 * 从消息条目数组（messages 或 input 字段）中按角色收集关键词路由扫描文本
 *
 * - role=system / role=developer 的条目进入 systemTexts
 * - 仅最后一条 role=user 的条目进入 lastUserTexts
 */
function collectRoleScanTexts(
  entries: unknown[],
  systemTexts: string[],
  lastUserTexts: string[]
): void {
  let lastUserEntry: Record<string, unknown> | null = null;

  entries.forEach((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }

    const obj = entry as Record<string, unknown>;

    if (obj.role === "system" || obj.role === "developer") {
      systemTexts.push(...extractEntryContentTexts(obj));
    } else if (obj.role === "user") {
      lastUserEntry = obj;
    }
  });

  if (lastUserEntry) {
    lastUserTexts.push(...extractEntryContentTexts(lastUserEntry));
  }
}

/**
 * 从请求消息中提取关键词路由需要扫描的文本
 *
 * 与 extractTextFromMessages 不同：
 * - 区分系统提示词与最后一条用户消息两个来源
 * - 额外支持 instructions 字段（Codex / Response API 格式）
 * - 支持 role=system / role=developer 的消息条目
 * - 用户消息仅扫描最后一条，避免历史消息误触发
 *
 * 注意：Gemini 格式（contents / systemInstruction）暂不支持
 *
 * @param message - 任意客户端格式的请求消息对象
 * @returns 按来源分类的待扫描文本
 */
export function extractKeywordRoutingTexts(
  message: Record<string, unknown>
): KeywordRoutingScanTexts {
  const systemTexts: string[] = [];
  const lastUserTexts: string[] = [];

  // 1. 提取 system 字段（Claude 格式，string 或 content block 数组）
  if ("system" in message) {
    systemTexts.push(...extractSystemText(message.system));
  }

  // 2. 提取 instructions 字段（Codex / Response API 格式）
  if (typeof message.instructions === "string") {
    systemTexts.push(message.instructions);
  }

  // 3. 提取 messages 数组（Claude / OpenAI Chat 格式）
  if (Array.isArray(message.messages)) {
    collectRoleScanTexts(message.messages, systemTexts, lastUserTexts);
  }

  // 4. 提取 input 数组（Codex / Response API 格式）
  if (Array.isArray(message.input)) {
    collectRoleScanTexts(message.input, systemTexts, lastUserTexts);
  }

  // 5. 提取图片接口等顶层 prompt 字段（string 或 string 数组）
  if (typeof message.prompt === "string") {
    lastUserTexts.push(message.prompt);
  } else if (Array.isArray(message.prompt)) {
    for (const item of message.prompt) {
      if (typeof item === "string") {
        lastUserTexts.push(item);
      }
    }
  }

  // 过滤空字符串
  return {
    systemTexts: systemTexts.filter((t) => t.length > 0),
    lastUserTexts: lastUserTexts.filter((t) => t.length > 0),
  };
}

/**
 * 从请求消息中提取所有需要检测的文本
 *
 * @param message - Request API 或 Response API 格式的消息对象
 * @returns 需要检测的文本数组
 */
export function extractTextFromMessages(message: Record<string, unknown>): string[] {
  const texts: string[] = [];

  // 0. 提取图片接口等顶层 prompt 文本
  if (typeof message.prompt === "string") {
    texts.push(message.prompt);
  } else if (Array.isArray(message.prompt)) {
    for (const item of message.prompt) {
      if (typeof item === "string") {
        texts.push(item);
      }
    }
  }

  // 1. 提取 system
  if ("system" in message) {
    const systemTexts = extractSystemText(message.system);
    texts.push(...systemTexts);
  }

  // 2. 提取 messages（Request API 格式）
  if ("messages" in message && Array.isArray(message.messages)) {
    const messageTexts = extractMessagesText(message.messages);
    texts.push(...messageTexts);
  }

  // 3. 提取 input（Response API 格式）
  if ("input" in message && Array.isArray(message.input)) {
    const inputTexts = extractInputText(message.input);
    texts.push(...inputTexts);
  }

  // 过滤空字符串
  return texts.filter((t) => t.length > 0);
}
