/**
 * 检测 Clipboard API 是否可用
 * 在非 HTTPS 环境下（除了 localhost），Clipboard API 会被浏览器限制
 */
export function isClipboardSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  // 检查是否为安全上下文（HTTPS 或 localhost）
  return window.isSecureContext && !!navigator.clipboard?.writeText;
}

/**
 * 尝试复制文本到剪贴板
 * @returns 是否成功复制
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!isClipboardSupported()) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("复制失败:", err);
    return false;
  }
}
