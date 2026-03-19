/**
 * 从请求路径中提取命名空间前缀。
 *
 * 支持：
 * - /writer/v1/chat/completions -> writer
 * - /writer/v1/models -> writer
 * - /v1/chat/completions -> null
 */
export function extractRoutePrefix(pathname: string): string | null {
  const match = pathname.match(/^\/([^/]+)\/v1(?:\/|$)/i);
  return match?.[1] || null;
}

/**
 * 去掉命名空间前缀，恢复为内部统一处理的标准 v1 路径。
 *
 * 支持：
 * - /writer/v1/chat/completions -> /v1/chat/completions
 * - /writer/v1 -> /v1
 * - /v1/chat/completions -> /v1/chat/completions
 */
export function stripRoutePrefix(pathname: string): string {
  return pathname.replace(/^\/[^/]+(\/v1(?:\/|$))/i, "$1");
}
