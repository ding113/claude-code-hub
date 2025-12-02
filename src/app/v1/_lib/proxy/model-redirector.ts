import { logger } from "@/lib/logger";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "./session";

/**
 * 模型重定向器
 *
 * 根据供应商配置的 modelRedirects 重写请求中的模型名称
 * 例如：将 Claude Code 客户端请求的 "claude-sonnet-4-5-20250929" 重定向为上游供应商支持的 "glm-4.6"
 * 用于接入第三方 AI 服务或成本优化
 */
export class ModelRedirector {
  /**
   * 应用模型重定向（如果配置了）
   *
   * @param session - 代理会话
   * @param provider - 目标供应商
   * @returns 是否进行了重定向
   */
  static apply(session: ProxySession, provider: Provider): boolean {
    // 获取真正的原始模型（用户请求的模型，不是上一个供应商重定向后的模型）
    const trueOriginalModel = session.getOriginalModel() || session.request.model;

    // 检查是否配置了模型重定向
    if (!provider.modelRedirects || Object.keys(provider.modelRedirects).length === 0) {
      // 如果新供应商没有重定向配置，且之前发生过重定向，需要重置
      if (session.isModelRedirected() && trueOriginalModel) {
        ModelRedirector.resetToOriginal(session, trueOriginalModel, provider);
      }
      return false;
    }

    // 获取原始模型名称
    const originalModel = trueOriginalModel;
    if (!originalModel) {
      logger.debug("[ModelRedirector] No model in request, skipping redirect", {
        providerId: provider.id,
        providerName: provider.name,
      });
      return false;
    }

    // 检查是否有该模型的重定向配置
    const redirectedModel = provider.modelRedirects[originalModel];
    if (!redirectedModel) {
      // 如果新供应商对此模型没有重定向规则，且之前发生过重定向，需要重置
      if (session.isModelRedirected()) {
        ModelRedirector.resetToOriginal(session, originalModel, provider);
      } else {
        logger.debug("[ModelRedirector] No redirect configured for model", {
          model: originalModel,
          providerId: provider.id,
          providerName: provider.name,
        });
      }
      return false;
    }

    // 执行重定向
    logger.info("[ModelRedirector] Model redirected", {
      originalModel,
      redirectedModel,
      providerId: provider.id,
      providerName: provider.name,
      providerType: provider.providerType,
    });

    // 保存原始模型（用于计费，必须在修改 request.model 之前）
    session.setOriginalModel(originalModel);

    // Gemini 特殊处理：修改 URL 路径中的模型名称
    // Gemini API 的模型名称通过 URL 路径传递，不是通过 request body
    // 例如：/v1internal/models/gemini-2.5-flash:generateContent
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      const originalPath = session.requestUrl.pathname;
      // 替换 URL 中的模型名称
      // 匹配模式：/models/{model}:action 或 /models/{model}
      const newPath = originalPath.replace(
        /\/models\/([^/:]+)(:[^/]+)?$/,
        `/models/${redirectedModel}$2`
      );

      if (newPath !== originalPath) {
        // 创建新的 URL 对象并修改路径
        const newUrl = new URL(session.requestUrl.toString());
        newUrl.pathname = newPath;
        session.requestUrl = newUrl;

        logger.debug(`[ModelRedirector] Updated Gemini URL path`, {
          originalPath,
          newPath,
          originalModel,
          redirectedModel,
        });
      }
    }

    // 修改 message 对象中的模型（对 Claude/OpenAI 有效，对 Gemini 无效但不影响）
    session.request.message.model = redirectedModel;

    // 更新缓存的 model 字段
    session.request.model = redirectedModel;

    // 重新生成请求 buffer（使用 TextEncoder）
    const updatedBody = JSON.stringify(session.request.message);
    const encoder = new TextEncoder();
    session.request.buffer = encoder.encode(updatedBody).buffer;

    // 更新日志（记录重定向）
    session.request.note = `[Model Redirected: ${originalModel} → ${redirectedModel}] ${session.request.note || ""}`;

    // 在决策链中记录模型重定向信息
    const providerChain = session.getProviderChain();
    if (providerChain.length > 0) {
      const lastDecision = providerChain[providerChain.length - 1];
      lastDecision.modelRedirect = {
        originalModel: originalModel,
        redirectedModel: redirectedModel,
        billingModel: originalModel, // 始终使用原始模型计费
      };
      logger.debug("[ModelRedirector] Added modelRedirect to provider chain", {
        providerId: provider.id,
        originalModel,
        redirectedModel,
      });
    }

    return true;
  }

  /**
   * 获取重定向后的模型名称（不修改 session）
   *
   * @param originalModel - 原始模型名称
   * @param provider - 供应商
   * @returns 重定向后的模型名称（如果没有重定向则返回原始名称）
   */
  static getRedirectedModel(originalModel: string, provider: Provider): string {
    if (!provider.modelRedirects || !originalModel) {
      return originalModel;
    }

    return provider.modelRedirects[originalModel] || originalModel;
  }

  /**
   * 检查供应商是否配置了指定模型的重定向
   *
   * @param model - 模型名称
   * @param provider - 供应商
   * @returns 是否配置了重定向
   */
  static hasRedirect(model: string, provider: Provider): boolean {
    return !!(provider.modelRedirects && model && provider.modelRedirects[model]);
  }

  /**
   * 重置模型到原始值（用于供应商切换时）
   *
   * @param session - 代理会话
   * @param originalModel - 原始模型名称
   * @param provider - 新供应商
   */
  private static resetToOriginal(
    session: ProxySession,
    originalModel: string,
    provider: Provider
  ): void {
    // 重置 request.model 和 request.message.model
    session.request.model = originalModel;
    session.request.message.model = originalModel;

    // 重置 Gemini URL 路径（如果适用）
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      const originalPathname = session.getOriginalUrlPathname();
      if (originalPathname && originalPathname !== session.requestUrl.pathname) {
        const newUrl = new URL(session.requestUrl.toString());
        newUrl.pathname = originalPathname;
        session.requestUrl = newUrl;

        logger.debug("[ModelRedirector] Reset Gemini URL path to original", {
          originalPathname,
          providerId: provider.id,
          providerName: provider.name,
        });
      }
    }

    // 重新生成请求 buffer
    const updatedBody = JSON.stringify(session.request.message);
    session.request.buffer = new TextEncoder().encode(updatedBody).buffer;

    logger.info("[ModelRedirector] Reset model to original (provider switch)", {
      originalModel,
      providerId: provider.id,
      providerName: provider.name,
    });
  }
}
