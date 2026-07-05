import {
  Ai21,
  Ai360,
  AlephAlpha,
  Alibaba,
  AntGroup,
  Arcee,
  AssemblyAI,
  Aws,
  Azure,
  BAAI,
  Baichuan,
  Baidu,
  Bedrock,
  Bfl,
  ByteDance,
  Claude,
  Cohere,
  Coqui,
  Dbrx,
  DeepSeek,
  ElevenLabs,
  EssentialAI,
  Fireworks,
  FishAudio,
  Google,
  Grok,
  Groq,
  Haiper,
  Hedra,
  IBM,
  Ideogram,
  Inception,
  Inflection,
  InternLM,
  Jina,
  Kling,
  Kwaipilot,
  Liquid,
  LLaVA,
  LongCat,
  Luma,
  Meta,
  Microsoft,
  Midjourney,
  Minimax,
  Mistral,
  Moonshot,
  Morph,
  MyShell,
  NousResearch,
  NovelAI,
  Nvidia,
  Ollama,
  OpenAI,
  OpenChat,
  OpenRouter,
  Perplexity,
  Pika,
  PixVerse,
  Qwen,
  Recraft,
  Runway,
  Rwkv,
  SenseNova,
  Skywork,
  Spark,
  Stability,
  Stepfun,
  Suno,
  Tencent,
  TII,
  Together,
  Tripo,
  Upstage,
  Vidu,
  Voyage,
  Xuanyuan,
  Yandex,
  Yi,
  Zhipu,
} from "@lobehub/icons";
import { iconFileForVendor, type VendorIconFileEntry } from "@/lib/model-vendor/vendor-icon-files";
import {
  inferVendorFromModelName,
  UNKNOWN_VENDOR,
  vendorDisplayName,
} from "@/lib/model-vendor/vendor-inference";

export type VendorIconComponent = React.ComponentType<{ className?: string }>;

/**
 * vendor/provider slug -> 本地打包的品牌图标组件(离线可用)。
 * 未覆盖的 slug 由 vendor-icon-files 的云端 SVG(cch-plus.com/model-icons)与
 * monogram 逐级兜底,视觉与云端价格表 providers 字典下发的 icon 一致。
 */
const VENDOR_ICON_COMPONENTS: Record<string, VendorIconComponent> = {
  // 主力厂商(与云端价格表 vendor slug 对齐)
  anthropic: Claude.Color,
  openai: OpenAI,
  google: Google.Color,
  meta: Meta.Color,
  deepseek: DeepSeek.Color,
  alibaba: Alibaba.Color,
  qwen: Qwen.Color,
  mistral: Mistral.Color,
  xai: Grok,
  cohere: Cohere.Color,
  ai21: Ai21.BrandColor,
  moonshotai: Moonshot,
  zhipuai: Zhipu.Color,
  minimax: Minimax.Color,
  perplexity: Perplexity.Color,
  stepfun: Stepfun.Color,
  baidu: Baidu.Color,
  tencent: Tencent.Color,
  bytedance: ByteDance.Color,
  "01-ai": Yi.Color,
  nvidia: Nvidia.Color,
  ibm: IBM,
  liquid: Liquid,
  amazon: Aws.Color,
  inception: Inception,
  morph: Morph.Color,
  "360": Ai360.Color,
  microsoft: Microsoft.Color,
  iflytek: Spark.Color,
  tii: TII.Color,
  jina: Jina,
  voyage: Voyage.Color,
  baai: BAAI,
  bfl: Bfl,
  kling: Kling.Color,
  recraft: Recraft,
  longcat: LongCat.Color,
  // LobeHub 品牌兜底集
  alephalpha: AlephAlpha,
  antgroup: AntGroup.Color,
  arcee: Arcee.Color,
  assemblyai: AssemblyAI.Color,
  baichuan: Baichuan.Color,
  coqui: Coqui.Color,
  databricks: Dbrx.Color,
  elevenlabs: ElevenLabs,
  essentialai: EssentialAI.Color,
  fishaudio: FishAudio,
  haiper: Haiper,
  hedra: Hedra,
  ideogram: Ideogram,
  inflection: Inflection,
  internlm: InternLM.Color,
  kwaipilot: Kwaipilot.Color,
  llava: LLaVA.Color,
  luma: Luma.Color,
  midjourney: Midjourney,
  myshell: MyShell.Color,
  nousresearch: NousResearch,
  novelai: NovelAI,
  openchat: OpenChat.Color,
  pika: Pika,
  pixverse: PixVerse.Color,
  runway: Runway,
  rwkv: Rwkv.Color,
  sensenova: SenseNova.Color,
  skywork: Skywork.Color,
  stability: Stability.Color,
  suno: Suno,
  tripo: Tripo.Color,
  upstage: Upstage.Color,
  vidu: Vidu.Color,
  xuanyuan: Xuanyuan.Color,
  yandex: Yandex,
  // 常见 provider 渠道(供应商价格对比等场景)
  openrouter: OpenRouter,
  groq: Groq,
  azure: Azure.Color,
  together: Together.Color,
  "together-ai": Together.Color,
  fireworks: Fireworks.Color,
  "fireworks-ai": Fireworks.Color,
  ollama: Ollama,
  bedrock: Bedrock.Color,
  "amazon-bedrock": Bedrock.Color,
  "google-vertex": Google.Color,
};

/** slug 精确命中 -> 最长 dash 前缀家族回退(与云端 icon 解析规则一致) */
export function getVendorIconComponent(slug: string): VendorIconComponent | null {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  if (VENDOR_ICON_COMPONENTS[key]) return VENDOR_ICON_COMPONENTS[key];
  let probe = key;
  while (probe.includes("-")) {
    probe = probe.slice(0, probe.lastIndexOf("-"));
    if (VENDOR_ICON_COMPONENTS[probe]) return VENDOR_ICON_COMPONENTS[probe];
  }
  return null;
}

export interface ModelVendorEntry {
  /** 云端价格表口径的 vendor slug */
  vendor: string;
  displayName: string;
  /** 本地打包的图标组件(可能为空,走远程 SVG/monogram 兜底) */
  icon: VendorIconComponent | null;
  /** 云端 SVG 图标文件(cch-plus.com/model-icons/<file>) */
  iconFile: VendorIconFileEntry | null;
}

/**
 * 按模型调用名推断厂商(正则规则与云端价格表生成侧一致)。
 * 未识别(vendor=other)返回 null。
 */
export function getModelVendor(modelId: string): ModelVendorEntry | null {
  if (!modelId) return null;
  const vendor = inferVendorFromModelName(modelId);
  if (vendor === UNKNOWN_VENDOR) return null;
  return getVendorEntry(vendor);
}

/** 按 vendor slug 组装图标条目 */
export function getVendorEntry(vendor: string): ModelVendorEntry {
  return {
    vendor,
    displayName: vendorDisplayName(vendor),
    icon: getVendorIconComponent(vendor),
    iconFile: iconFileForVendor(vendor),
  };
}
