import { Anthropic, Claude, Gemini, OpenAI } from "@lobehub/icons";
import type { ProviderType } from "@/types/provider";

// Anthropic Avatar 橙色包装组件（与 Claude Code 颜色一致）
const AnthropicOrangeAvatar: React.FC<{ className?: string }> = ({ className }) => {
  // 从 className 中提取尺寸，默认 12px（对应 h-3 w-3）
  const sizeMatch = className?.match(/h-(\d+)/);
  const size = sizeMatch ? parseInt(sizeMatch[1], 10) * 4 : 12; // Tailwind: h-3 = 12px

  return <Anthropic.Avatar size={size} background="#ffffff" shape="circle" className={className} />;
};

// 供应商类型 UI 配置（仅包含图标和颜色，不包含翻译文本）
export const PROVIDER_TYPE_CONFIG: Record<
  ProviderType,
  {
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
    bgColor: string;
  }
> = {
  claude: {
    icon: Claude.Color,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-500/15",
  },
  "claude-auth": {
    icon: AnthropicOrangeAvatar, // Anthropic Avatar 橙色圆形图标
    iconColor: "text-purple-600",
    bgColor: "bg-purple-500/15",
  },
  codex: {
    icon: OpenAI, // OpenAI 无文字版本（默认 Mono）
    iconColor: "text-blue-600",
    bgColor: "bg-blue-500/15",
  },
  gemini: {
    icon: Gemini.Color,
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-500/15",
  },
  "gemini-cli": {
    icon: Gemini.Color,
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-500/15",
  },
  "openai-compatible": {
    icon: OpenAI, // OpenAI 无文字版本（默认 Mono）
    iconColor: "text-cyan-600",
    bgColor: "bg-cyan-500/15",
  },
};

// 获取供应商类型配置
export function getProviderTypeConfig(type: ProviderType) {
  return PROVIDER_TYPE_CONFIG[type];
}

// 获取所有供应商类型
export function getAllProviderTypes(): ProviderType[] {
  return Object.keys(PROVIDER_TYPE_CONFIG) as ProviderType[];
}

// 将供应商类型转换为翻译键（claude-auth -> claudeAuth, gemini-cli -> geminiCli）
export function getProviderTypeTranslationKey(type: ProviderType): string {
  return type.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
