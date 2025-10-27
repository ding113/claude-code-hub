/**
 * Codex CLI 官方 Instructions
 *
 * 来源：CLIProxyAPI/internal/misc/codex_instructions/
 * 参考：
 * - prompt.md-013-b1c291e2bbca0706ec9b2888f358646e65a8f315
 * - gpt_5_codex_prompt.md-006-0ad1b0782b16bb5e91065da622b7c605d7d512e6
 *
 * 用途：
 * 1. 检测用户 instructions 是否为官方 prompt，避免重复注入
 * 2. 为非官方 instructions 提供默认 prompt
 */

/**
 * GPT-5 标准 Prompt（最新版本）
 *
 * 用于 gpt-5 模型的默认 instructions
 */
export const GPT5_PROMPT = `You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.

Your capabilities:

- Receive user prompts and other context provided by the harness, such as files in the workspace.
- Communicate with the user by streaming thinking & responses, and by making & updating plans.
- Emit function calls to run terminal commands and apply patches. Depending on how this specific run is configured, you can request that these function calls be escalated to the user for approval before running. More on this in the "Sandbox and approvals" section.

Within this context, Codex refers to the open-source agentic coding interface (not the old Codex language model built by OpenAI).`;

/**
 * GPT-5 Codex Prompt（最新版本）
 *
 * 用于 gpt-5-codex 模型的默认 instructions
 */
export const GPT5_CODEX_PROMPT = `You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General

- The arguments to \`shell\` will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the \`workdir\` param when using the shell function. Do not use \`cd\` unless absolutely necessary.
- When searching for text or files, prefer using \`rg\` or \`rg --files\` respectively because \`rg\` is much faster than alternatives like \`grep\`. (If the \`rg\` command is not found, then use alternatives.)`;

/**
 * 所有官方 Prompts 列表
 *
 * 用于前缀匹配检测，按优先级排序（更长的 prompt 优先）
 */
export const OFFICIAL_PROMPTS = [GPT5_CODEX_PROMPT, GPT5_PROMPT];

/**
 * 检查 instructions 是否为官方 prompt
 *
 * 检查逻辑：
 * - instructions 必须以某个官方 prompt 开头（前缀匹配）
 * - 匹配忽略前后空白符
 *
 * @param instructions - 用户提供的 instructions
 * @returns 是否为官方 prompt
 */
export function isOfficialInstructions(instructions: string | undefined): boolean {
  if (!instructions) {
    return false;
  }

  const trimmed = instructions.trim();
  if (!trimmed) {
    return false;
  }

  // 检查是否以任何官方 prompt 开头
  return OFFICIAL_PROMPTS.some((official) => trimmed.startsWith(official.trim()));
}

/**
 * 获取默认 instructions（根据模型名称）
 *
 * 规则：
 * - 模型名称包含 "codex" → GPT5_CODEX_PROMPT
 * - 其他模型 → GPT5_PROMPT
 *
 * @param modelName - 模型名称
 * @returns 默认 instructions
 */
export function getDefaultInstructions(modelName: string): string {
  const lowerModel = modelName.toLowerCase();

  if (lowerModel.includes("codex")) {
    return GPT5_CODEX_PROMPT;
  }

  return GPT5_PROMPT;
}
