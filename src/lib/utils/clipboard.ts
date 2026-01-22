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

function tryCopyViaExecCommand(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);

    textarea.select();

    const ok = document.execCommand?.("copy") ?? false;
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 尝试复制文本到剪贴板（Clipboard API 优先，失败则走 execCommand fallback）
 * @returns 是否成功复制
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (isClipboardSupported()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  return tryCopyViaExecCommand(text);
}

/**
 * 尝试复制文本到剪贴板
 * @returns 是否成功复制
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return copyTextToClipboard(text);
}

/**
 * 检测 Clipboard 读取 API 是否可用
 */
export function isClipboardReadSupported(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.isSecureContext && !!navigator.clipboard?.readText;
}

/**
 * 从剪贴板读取文本
 * @returns 剪贴板文本内容，失败或不支持时返回 null
 */
export async function readFromClipboard(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (isClipboardReadSupported()) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return null;
    }
  }
  return null;
}
