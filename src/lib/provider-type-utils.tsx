import { Bot, Sparkles, Code2, Diamond, Network } from "lucide-react";
import type { ProviderType } from "@/types/provider";

// 供应商类型配置
export const PROVIDER_TYPE_CONFIG: Record<
  ProviderType,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    iconColor: string;
    bgColor: string;
    description: string;
  }
> = {
  claude: {
    label: "Claude",
    icon: Bot,
    iconColor: "text-orange-600",
    bgColor: "bg-orange-500/15",
    description: "Anthropic 官方 API",
  },
  "claude-auth": {
    label: "Claude Auth",
    icon: Sparkles,
    iconColor: "text-purple-600",
    bgColor: "bg-purple-500/15",
    description: "Claude 中转服务",
  },
  codex: {
    label: "Codex",
    icon: Code2,
    iconColor: "text-blue-600",
    bgColor: "bg-blue-500/15",
    description: "Codex CLI API",
  },
  "gemini-cli": {
    label: "Gemini CLI",
    icon: Diamond,
    iconColor: "text-emerald-600",
    bgColor: "bg-emerald-500/15",
    description: "Gemini CLI API",
  },
  "openai-compatible": {
    label: "OpenAI Compatible",
    icon: Network,
    iconColor: "text-cyan-600",
    bgColor: "bg-cyan-500/15",
    description: "OpenAI 兼容 API",
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
