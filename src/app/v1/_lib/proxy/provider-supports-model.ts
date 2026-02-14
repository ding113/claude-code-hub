import type { Provider } from "@/types/provider";

/**
 * 检查供应商是否支持指定模型（用于调度器匹配）
 *
 * 说明：
 * - 这里的“支持”指的是：该 provider 能否接受客户端请求的 model 作为入口，并在必要时通过 modelRedirects
 *   重写为上游实际模型。
 * - 对于配置了 modelRedirects 的场景，映射前（key）模型名应被视为可请求模型。
 */
export function providerSupportsModel(provider: Provider, requestedModel: string): boolean {
  const isClaudeModel = requestedModel.startsWith("claude-");
  const isClaudeProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";

  // Case 1: Claude 模型请求
  if (isClaudeModel) {
    // 1a. Anthropic 提供商
    if (isClaudeProvider) {
      // 未设置 allowedModels 或为空数组：允许所有 claude 模型
      if (!provider.allowedModels || provider.allowedModels.length === 0) {
        return true;
      }

      // Fix #786：当存在 modelRedirects 映射时，映射前模型名（key）也应视为可请求模型
      return (
        provider.allowedModels.includes(requestedModel) ||
        !!provider.modelRedirects?.[requestedModel]
      );
    }

    // 1b. 非 Anthropic 提供商不支持 Claude 模型调度
    return false;
  }

  // Case 2: 非 Claude 模型请求（gpt-*, gemini-*, 或其他任意模型）
  // 2a. 优先检查显式声明（支持跨类型别名）
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) || provider.modelRedirects?.[requestedModel]
  );

  if (explicitlyDeclared) {
    return true; // 显式声明优先级最高，允许跨类型别名
  }

  // 2b. Anthropic 提供商不支持非声明的非 Claude 模型
  // 保护机制：防止将非 Claude 模型误路由到 Anthropic API
  if (isClaudeProvider) {
    return false;
  }

  // 2c. 非 Anthropic 提供商（codex, gemini, gemini-cli, openai-compatible）
  // 未设置 allowedModels 或为空数组：接受任意模型（由上游提供商判断）
  if (!provider.allowedModels || provider.allowedModels.length === 0) {
    return true;
  }

  // 不在声明列表中且无重定向配置（前面已检查 explicitlyDeclared）
  return false;
}
