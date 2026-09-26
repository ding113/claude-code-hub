import { NEW_API_USER_ID_MAX } from "@/lib/constants/provider.constants";

/**
 * 解析 New API 用户 ID 输入框的文本。
 *
 * 空白返回 null（不配置）；正整数返回数值；其余输入返回 undefined，由表单校验报错。
 */
export function parseNewApiUserIdInput(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;

  const value = Number(trimmed);
  return value >= 1 && value <= NEW_API_USER_ID_MAX ? value : undefined;
}

/**
 * 编辑供应商时系统访问令牌的提交内容。
 *
 * 令牌只以掩码形式下发到页面：选择清除时提交 null，填写了新令牌时提交新令牌，
 * 两者都没有时不提交该字段，服务端保留原值。
 */
export function buildNewApiAccessTokenEditPayload(
  trimmedToken: string,
  clear: boolean
): { new_api_access_token?: string | null } {
  if (clear) return { new_api_access_token: null };
  if (trimmedToken) return { new_api_access_token: trimmedToken };
  return {};
}
