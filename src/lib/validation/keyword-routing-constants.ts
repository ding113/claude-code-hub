/**
 * 关键词路由规则的字段长度与取值边界常量
 *
 * 作为单一数据源，由 API 层 Zod schema
 * (@/lib/api/v1/schemas/keyword-routing) 与 Server Action 验证
 * (@/actions/keyword-routing) 共同引用，避免两处独立维护导致的不一致。
 */
export const KEYWORD_MAX_LENGTH = 500;
export const MODEL_MAX_LENGTH = 128;
export const DESCRIPTION_MAX_LENGTH = 500;
export const PRIORITY_ABS_LIMIT = 1000000;
