/** slug 精确命中 -> 逐段剥离末尾 dash 前缀回退(alibaba-coding-plan-cn -> alibaba);图标组件与云端 SVG 映射共用同一规则 */
export function resolveByDashPrefix<T>(slug: string, map: Record<string, T>): T | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  if (map[key]) return map[key];
  let probe = key;
  while (probe.includes("-")) {
    probe = probe.slice(0, probe.lastIndexOf("-"));
    if (map[probe]) return map[probe];
  }
  return null;
}
