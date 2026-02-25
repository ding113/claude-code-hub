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

  // 1) 显式声明优先：allowedModels / modelRedirects
  // - 允许跨类型别名（例如 Claude provider 显式声明支持某个非 Claude 模型）
  // - 但保持安全语义：claude-* 仍只允许由 Claude provider 处理
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) || provider.modelRedirects?.[requestedModel]
  );

  if (explicitlyDeclared && (!isClaudeModel || isClaudeProvider)) {
    return true;
  }

  // 2) 隐式规则：按模型类型与 provider 类型决定

  // 2a. Claude 模型请求：仅 Claude provider 可处理
  if (isClaudeModel) {
    if (!isClaudeProvider) return false;

    // Claude provider 未设置 allowedModels：默认支持所有 claude-*
    return !provider.allowedModels || provider.allowedModels.length === 0;
  }

  // 2b. 非 Claude 模型：Claude provider 仅支持显式声明（上面已处理）
  if (isClaudeProvider) {
    return false;
  }

  // 2c. 非 Claude provider：未设置 allowedModels 时接受任意非 Claude 模型（由上游判断）
  return !provider.allowedModels || provider.allowedModels.length === 0;
}
