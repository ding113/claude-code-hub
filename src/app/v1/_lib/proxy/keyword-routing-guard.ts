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
 * - 每个请求最多执行一次（GuardPipeline 对每个步骤只执行一次）；若被重复执行，
 *   同规则命中为无副作用空操作，但 sourceModel 限定规则可能基于改写结果链式二次改写
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

      // 快速路径：规则缓存为空时直接放行，连总开关查询都跳过（零规则部署零额外开销）
      if (keywordRoutingEngine.isEmpty()) {
        return null;
      }

      // 总开关关闭时直接放行（功能未启用）
      if (!(await isKeywordModelRoutingEnabled())) {
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
      if (!match) {
        return null;
      }

      // 规则命中但目标模型与请求模型相同：记录审计但不改写
      if (match.rule.targetModel === requestedModel) {
        session.setKeywordRoutingAudit({
          userRequestedModel: requestedModel,
          routedModel: match.rule.targetModel,
          ruleId: match.rule.id,
          keyword: match.rule.keyword,
          matchedIn: match.matchedIn,
        });

        session.request.note = `[Keyword Matched (no rewrite): rule#${match.rule.id}, target=${match.rule.targetModel}] ${session.request.note || ""}`;

        logger.debug(
          "[KeywordRoutingGuard] Rule matched but target equals source, skipped rewrite",
          {
            ruleId: match.rule.id,
            keyword: match.rule.keyword,
            matchedIn: match.matchedIn,
            model: requestedModel,
            sessionId: session.sessionId,
          }
        );

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
