interface AuditLogTranslator {
  (key: string): string;
  has: (key: string) => boolean;
}

export function getAuditCategoryLabel(t: AuditLogTranslator, category: string): string {
  const key = `categories.${category}`;
  return t.has(key) ? t(key) : category;
}

export function getAuditActionLabel(t: AuditLogTranslator, actionType: string): string {
  // next-intl 缺失文案时会返回完整 key 字符串，因此这里必须先用 has() 判断。
  const key = `actions.${actionType}`;
  return t.has(key) ? t(key) : actionType;
}
