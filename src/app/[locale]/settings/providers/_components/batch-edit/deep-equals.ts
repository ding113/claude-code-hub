/**
 * 深度比较两个值是否相等（处理对象、数组、基本类型）
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  // 1. Object.is 处理基本类型和特殊值（NaN, +0/-0）
  if (Object.is(a, b)) return true;

  // 2. null/undefined 处理
  if (a == null || b == null) return false;

  // 3. 类型不同
  if (typeof a !== typeof b) return false;

  // 4. 数组比较
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEquals(item, b[i]));
  }

  // 5. 数组和对象的类型区分
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  // 6. 对象比较（使用稳定序列化）
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();

    if (keysA.length !== keysB.length) return false;
    if (!keysA.every((k, i) => k === keysB[i])) return false;

    return keysA.every((key) =>
      deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }

  return false;
}
