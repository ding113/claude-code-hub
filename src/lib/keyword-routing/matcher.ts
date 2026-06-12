import type { KeywordRoutingScanTexts } from "@/lib/message-extractor";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";

/**
 * 关键词路由匹配结果
 *
 * matchedIn 标记关键词命中的位置：system（系统提示词）或 user（最后一条用户消息）
 */
export interface KeywordRoutingMatch {
  rule: KeywordRoutingRule;
  matchedIn: "system" | "user";
}

/**
 * 判断规则的关键词是否命中给定文本（子串匹配）
 *
 * caseSensitive=false 时双方统一转为小写后比较
 */
export function ruleMatchesText(
  rule: Pick<KeywordRoutingRule, "keyword" | "caseSensitive">,
  text: string
): boolean {
  if (rule.caseSensitive) {
    return text.includes(rule.keyword);
  }
  return text.toLowerCase().includes(rule.keyword.toLowerCase());
}

/**
 * 在扫描文本中查找首个命中的关键词路由规则
 *
 * 语义：
 * - 按传入顺序逐条评估（调用方需保证 priority 升序、id 升序），首个命中即返回
 * - 跳过已禁用的规则（深度防御）
 * - 跳过关键词为空或仅空白字符的规则（空关键词会匹配一切，防御脏数据）
 * - sourceModel 非空时要求与请求模型严格相等（大小写敏感），否则跳过该规则
 * - 先检查 systemTexts，再检查 lastUserTexts，matchedIn 反映命中位置
 *
 * @param rules - 已按评估顺序排列的规则列表
 * @param texts - 按来源分类的待扫描文本
 * @param requestedModel - 客户端请求的模型名（可能为 null）
 * @returns 首个命中的规则及命中位置，未命中返回 null
 */
export function findMatchingKeywordRoutingRule(
  rules: readonly KeywordRoutingRule[],
  texts: KeywordRoutingScanTexts,
  requestedModel: string | null
): KeywordRoutingMatch | null {
  for (const rule of rules) {
    if (!rule.isEnabled) {
      continue;
    }

    if (rule.keyword.trim().length === 0) {
      continue;
    }

    if (rule.sourceModel && rule.sourceModel !== requestedModel) {
      continue;
    }

    if (texts.systemTexts.some((text) => ruleMatchesText(rule, text))) {
      return { rule, matchedIn: "system" };
    }

    if (texts.lastUserTexts.some((text) => ruleMatchesText(rule, text))) {
      return { rule, matchedIn: "user" };
    }
  }

  return null;
}
