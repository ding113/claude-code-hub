export {
  validateNumericField,
  clampWeight,
  clampPriority,
  clampIntInRange,
  clampTpm,
  formatTpmDisplay,
} from "./provider";

/**
 * 验证URL格式
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return Boolean(parsedUrl);
  } catch {
    return false;
  }
}

/**
 * 掩码显示密钥 - 统一显示6位掩码
 */
export function maskKey(key: string): string {
  if (!key || key.length <= 8) {
    return "••••••";
  }
  const head = 4;
  const tail = 4;
  return `${key.slice(0, head)}••••••${key.slice(-tail)}`;
}
