/**
 * 关键词路由守卫
 *
 * 职责：
 * - 扫描请求的系统提示词与最后一条用户消息，匹配关键词路由规则
 * - 命中规则时在供应商选择之前改写请求模型，使改写结果参与供应商路由决策
 * - 将审计信息记录到 session（决策链展示），保留用户原始请求模型
 *
 * 调用时机：
 * - requestFilter 之后、rateLimit / provider 选择之前
 * - 必须早于供应商选择，否则改写无法影响供应商路由
 *
 * 重要约束：
 * - 不调用 setOriginalModel：改写后 getOriginalModel() 返回目标模型，
 *   供应商选择与 ModelRedirector 均以目标模型为基准（否则会被静默回退）；
 *   用户原始请求模型通过 keywordRoutingAudit 单独保留用于审计
 * - 该守卫永不拦截请求（始终返回 null），任何异常均降级放行
 */

import { isKeywordModelRoutingEnabled } from "@/lib/config/system-settings-cache";
import { keywordRoutingEngine } from "@/lib/keyword-routing/engine";
import { logger } from "@/lib/logger";
import { extractKeywordRoutingTexts } from "@/lib/message-extractor";
import type { ProxySession } from "./session";

export class ProxyKeywordRoutingGuard {
  /**
   * 应用关键词路由（命中规则时改写请求模型）
   *
   * @returns 始终返回 null（该守卫不拦截请求）
   */
  static async ensure(session: ProxySession): Promise<Response | null> {
    try {
      // Gemini 格式的模型名通过 URL 路径传递，不在请求体中，暂不支持
      if (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") {
        return null;
      }

      // multipart 图片请求（请求体非 JSON），暂不支持
      if (session.isOpenAIImageMultipartRequest()) {
        return null;
      }

      // 总开关关闭时直接放行（fail-closed）
      if (!(await isKeywordModelRoutingEnabled())) {
        return null;
      }

      // 快速路径：规则缓存为空时跳过文本提取（提取是昂贵步骤）
      if (keywordRoutingEngine.isEmpty()) {
        return null;
      }

      const requestedModel = session.request.model;
      if (!requestedModel) {
        return null;
      }

      // 提取待扫描文本（系统提示词 + 最后一条用户消息）
      const texts = extractKeywordRoutingTexts(session.request.message);
      if (texts.systemTexts.length === 0 && texts.lastUserTexts.length === 0) {
        return null;
      }

      // 匹配关键词路由规则（首个命中即返回）
      const match = keywordRoutingEngine.match(texts, requestedModel);
      if (!match || match.rule.targetModel === requestedModel) {
        return null;
      }

      // 改写请求模型（在供应商选择之前生效）
      session.request.message.model = match.rule.targetModel;
      session.request.model = match.rule.targetModel;

      // 重新生成请求 buffer（使用 TextEncoder）
      const updatedBody = JSON.stringify(session.request.message);
      const encoder = new TextEncoder();
      session.request.buffer = encoder.encode(updatedBody).buffer;

      // 记录审计信息（不调用 setOriginalModel，见文件头注释）
      session.setKeywordRoutingAudit({
        userRequestedModel: requestedModel,
        routedModel: match.rule.targetModel,
        ruleId: match.rule.id,
        keyword: match.rule.keyword,
        matchedIn: match.matchedIn,
      });

      // 更新日志（记录路由改写）
      session.request.note = `[Keyword Routed: ${requestedModel} -> ${match.rule.targetModel}, rule#${match.rule.id}] ${session.request.note || ""}`;

      logger.info("[KeywordRoutingGuard] Model rewritten by keyword rule", {
        ruleId: match.rule.id,
        keyword: match.rule.keyword,
        matchedIn: match.matchedIn,
        from: requestedModel,
        to: match.rule.targetModel,
        sessionId: session.sessionId,
      });

      return null;
    } catch (error) {
      logger.error("[KeywordRoutingGuard] Routing error:", error);
      return null; // 降级：路由失败时放行，不阻塞正常请求
    }
  }
}
