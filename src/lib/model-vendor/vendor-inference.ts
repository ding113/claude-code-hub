// Vendor inference for model call names.
// Ported from the cch-plus.com official website pricing pipeline (registry.ts)
// so that this project shares the exact same regex-based matching rules used to
// generate the cloud pricing table. Keyword rules are substring regex scans
// (first-match by array order); host prefixes are skipped when scanning
// "org/model" style names.

/** Bedrock-style region prefixes (us.anthropic.… / us-gov.…). */
const REGION_PREFIX = /^(us|eu|jp|au|apac|global|us-gov|ca|sa)\./;

export function stripRegionPrefix(value: string): string {
  let out = value;
  while (REGION_PREFIX.test(out)) out = out.replace(REGION_PREFIX, "");
  return out;
}

/**
 * Call-name prefix -> vendor slug ("openai/gpt-5.5" 的 "openai"、HF 风格 "deepseek-ai" 等)。
 */
export const PREFIX_VENDOR_ALIAS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  "meta-llama": "meta",
  meta: "meta",
  llama: "meta",
  deepseek: "deepseek",
  "deepseek-ai": "deepseek",
  qwen: "alibaba",
  alibaba: "alibaba",
  mistral: "mistral",
  mistralai: "mistral",
  xai: "xai",
  "x-ai": "xai",
  cohere: "cohere",
  ai21: "ai21",
  moonshotai: "moonshotai",
  moonshot: "moonshotai",
  zhipuai: "zhipuai",
  "z-ai": "zhipuai",
  thudm: "zhipuai",
  minimax: "minimax",
  minimaxai: "minimax",
  perplexity: "perplexity",
  pplx: "perplexity",
  stepfun: "stepfun",
  "stepfun-ai": "stepfun",
  baidu: "baidu",
  tencent: "tencent",
  bytedance: "bytedance",
  "bytedance-seed": "bytedance",
  volcengine: "bytedance",
  doubao: "bytedance",
  seed: "bytedance",
  seedance: "bytedance",
  xiaomi: "xiaomi",
  xiaomimimo: "xiaomi",
  mimo: "xiaomi",
  "01-ai": "01-ai",
  reka: "reka",
  nvidia: "nvidia",
  ibm: "ibm",
  "ibm-granite": "ibm",
  liquid: "liquid",
  amazon: "amazon",
  inception: "inception",
  morph: "morph",
};

/** 调用名的 vendor 前缀归一;无前缀或未知前缀返回 undefined */
export function vendorOfPrefix(prefix: string | undefined): string | undefined {
  if (!prefix) return undefined;
  return PREFIX_VENDOR_ALIAS[prefix.toLowerCase()];
}

/** 托管/网关 org 前缀:出现在 "org/model" 斜杠前时应跳过 org、改扫 model 段 */
const HOST_PREFIXES = new Set([
  "ppio",
  "sophnet",
  "together",
  "togetherai",
  "together-ai",
  "fireworks",
  "fireworks-ai",
  "openrouter",
  "deepinfra",
  "novita",
  "novita-ai",
  "siliconflow",
  "siliconflow-cn",
  "302ai",
  "aihubmix",
  "unsloth",
  "bartowski",
  "thebloke",
  "huggingface",
  "hf",
  "modelscope",
  "replicate",
  "nebius",
  "hyperbolic",
  "featherless",
  "parasail",
  "gmicloud",
  "kluster",
  "lambda",
  "cloudflare",
  "vercel",
  "portkey",
  "requesty",
  "nscale",
  "inference-net",
  "venice",
  "kenari",
  "qiniu-ai",
  "opencode-go",
  "coding",
]);

export function isHostPrefix(prefix: string): boolean {
  return HOST_PREFIXES.has(prefix.toLowerCase());
}

/**
 * 模型名关键词 -> vendor(全串子串匹配,按数组序 first-match;更"具体/发布方"的规则在前)。
 * 蒸馏/衍生名(deepseek-r1-distill-qwen、nemotron-llama)归发布方,故 deepseek/nvidia 早于 qwen/llama。
 */
export const KEYWORD_VENDOR_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/xiaomimimo|xiaomi|\bmimo\b/, "xiaomi"],
  [/deepseek/, "deepseek"],
  [/doubao|seedance|seedream|seed-oss|\bseed-\d|ui-tars|bytedance|volcengine/, "bytedance"],
  [/nemotron|\bnvidia\b/, "nvidia"],
  [/\bphi-?\d|wizardlm|\borca-2|\bmai-(ds|voice|\d)/, "microsoft"],
  [/\byi-\d|\byi-(lightning|vision|large|medium|coder|spark)|\b01-?ai|yi1\.5/, "01-ai"],
  [/sparkdesk|iflytek|spark-(max|lite|pro|ultra|x1)|\bspark4/, "iflytek"],
  [/360gpt|360zhinao/, "360"],
  [/kimi|moonshot/, "moonshotai"],
  [/ernie|wenxin|qianfan/, "baidu"],
  [
    /hunyuan|\bhy-?\d|\bhy-(mt|image|video|3d|t1|turbo|large|standard|lite|vision|role|a13b|dense|moe|code)/,
    "tencent",
  ],
  [/grok/, "xai"],
  [/\bcommand-?(r|a|light|nightly)|\bcommand\b/, "cohere"],
  [/pixtral|codestral|ministral|magistral|devstral|mixtral|mistral/, "mistral"],
  [/granite/, "ibm"],
  [/\blfm-?\d|\blfm\b/, "liquid"],
  [/jamba/, "ai21"],
  [/stepfun|\bstep-\d|step-r1|step-audio/, "stepfun"],
  [/minimax|\babab/, "minimax"],
  [/\breka-|\breka\b/, "reka"],
  [/sonar|perplexity/, "perplexity"],
  [/falcon/, "tii"],
  [/deepgram/, "deepgram"],
  [/\bjina/, "jina"],
  [/voyage/, "voyage"],
  [/\bbge-|\bbge\b|baai/, "baai"],
  [/black-forest|\bflux-?\d|\bflux-(pro|dev|schnell|kontext|krea|1)|\bflux\b/, "bfl"],
  [/\bkling/, "kling"],
  [/recraft/, "recraft"],
  [/longcat/, "longcat"],
  [
    /\bling-(lite|plus|flash|mini|coder|omni|1t|\d)|\bling\b|bailing|inclusionai|\bring-(lite|flash|mini|1t)/,
    "antgroup",
  ],
  [/chatglm|autoglm|charglm|codegeex|cogview|cogvideo|\bglm-?\d|\bglm-|\bglm\b|zhipu/, "zhipuai"],
  [/qwen|qwq|qvq|tongyi|wanx|marco-o1/, "alibaba"],
  [/gemini|gemma|\bpalm-2|imagen|nano-banana|\bbison\b|\bgecko\b/, "google"],
  [/codellama|llama/, "meta"],
  [
    /\bgpt-|\bo1-|\bo3-|\bo4-|davinci|\bwhisper\b|dall-e|\bchatgpt|text-embedding-(ada|3)/,
    "openai",
  ],
  [/claude/, "anthropic"],
  [/facebook|\bbart-|\bopt-\d|blenderbot/, "meta"],
];

/** 全串关键词扫描:命中第一条规则即返回其 vendor,否则 undefined */
export function keywordScan(value: string): string | undefined {
  for (const [re, vendor] of KEYWORD_VENDOR_RULES) {
    if (re.test(value)) return vendor;
  }
  return undefined;
}

/**
 * LobeHub 品牌 token -> vendor slug(主力厂商关键词都未命中时的兜底)。
 * 归一少量(hailuo->minimax、jimeng->bytedance、kolors->kwaipilot、tiangong->skywork、
 * dbrx->databricks、yuanbao->tencent)。
 */
const LOBEHUB_BRAND_VENDORS: Record<string, string> = {
  alephalpha: "alephalpha",
  antgroup: "antgroup",
  arcee: "arcee",
  assemblyai: "assemblyai",
  baichuan: "baichuan",
  briaai: "briaai",
  coqui: "coqui",
  dbrx: "databricks",
  elevenlabs: "elevenlabs",
  essentialai: "essentialai",
  fishaudio: "fishaudio",
  hailuo: "minimax",
  haiper: "haiper",
  hedra: "hedra",
  ideogram: "ideogram",
  inflection: "inflection",
  internlm: "internlm",
  jimeng: "bytedance",
  kolors: "kwaipilot",
  kwaipilot: "kwaipilot",
  llava: "llava",
  luma: "luma",
  microsoft: "microsoft",
  midjourney: "midjourney",
  myshell: "myshell",
  nousresearch: "nousresearch",
  novelai: "novelai",
  openchat: "openchat",
  pika: "pika",
  pixverse: "pixverse",
  reve: "reve",
  runway: "runway",
  rwkv: "rwkv",
  sensenova: "sensenova",
  skywork: "skywork",
  stability: "stability",
  suno: "suno",
  tiangong: "skywork",
  tripo: "tripo",
  upstage: "upstage",
  vidu: "vidu",
  xuanyuan: "xuanyuan",
  yandex: "yandex",
  yuanbao: "tencent",
};

/** LobeHub 品牌 token 按长度降序(最长/最具体优先),供全名子串兜底扫描 */
const LOBEHUB_BRAND_RULES: ReadonlyArray<readonly [string, string]> = Object.entries(
  LOBEHUB_BRAND_VENDORS
).sort((a, b) => b[0].length - a[0].length);

function lobehubBrandScan(value: string): string | undefined {
  for (const [token, vendor] of LOBEHUB_BRAND_RULES) {
    if (value.includes(token)) return vendor;
  }
  return undefined;
}

export const UNKNOWN_VENDOR = "other";

/**
 * 从模型调用名尽力推断 vendor slug。
 * ① Cloudflare "@cf/<org>/<model>" 取 org(facebook->meta);
 * ② "org/model" 且 org 非托管商时按 org 段;
 * ③ 全名关键词扫描(抗托管商前缀污染);
 * ④ bedrock 点前缀/dash 首段/整名 前缀映射;
 * ⑤ LobeHub 品牌全集子串扫描;全失败 -> "other"。
 */
export function inferVendorFromModelName(modelName: string): string {
  const lower = modelName.trim().toLowerCase();
  if (!lower) return UNKNOWN_VENDOR;

  if (lower.startsWith("@cf/")) {
    const parts = lower.split("/");
    const org = parts[1] ?? "";
    if (org === "facebook") return "meta";
    return (
      vendorOfPrefix(org) ??
      keywordScan(org) ??
      keywordScan(parts.slice(2).join("/")) ??
      UNKNOWN_VENDOR
    );
  }

  const slash = lower.indexOf("/");
  if (slash >= 0) {
    const org = lower.slice(0, slash);
    if (!HOST_PREFIXES.has(org)) {
      const byOrg = vendorOfPrefix(org) ?? keywordScan(org);
      if (byOrg) return byOrg;
    }
  }

  const byKeyword = keywordScan(lower);
  if (byKeyword) return byKeyword;

  const bare = slash >= 0 ? lower.slice(slash + 1) : lower;
  const dot = /^([a-z0-9-]+)\./.exec(stripRegionPrefix(bare));
  if (dot) {
    const byDot = vendorOfPrefix(dot[1]);
    if (byDot) return byDot;
  }
  const dash = bare.indexOf("-");
  if (dash > 0) {
    const byDash = vendorOfPrefix(bare.slice(0, dash));
    if (byDash) return byDash;
  }
  const byPrefix = vendorOfPrefix(bare);
  if (byPrefix) return byPrefix;

  return lobehubBrandScan(lower) ?? UNKNOWN_VENDOR;
}

/**
 * 合成 vendor(无对应源 provider 条目)的兜底显示名。
 * 云端价格表 providers 字典有同名条目时以云端为准。
 */
export const VENDOR_DISPLAY_NAMES: Record<string, string> = {
  other: "Other",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  meta: "Meta",
  deepseek: "DeepSeek",
  alibaba: "Alibaba",
  mistral: "Mistral",
  xai: "xAI",
  cohere: "Cohere",
  ai21: "AI21",
  moonshotai: "Moonshot AI",
  zhipuai: "Zhipu AI",
  minimax: "MiniMax",
  perplexity: "Perplexity",
  stepfun: "StepFun",
  baidu: "Baidu",
  tencent: "Tencent",
  bytedance: "ByteDance",
  xiaomi: "Xiaomi",
  "01-ai": "01.AI",
  reka: "Reka",
  nvidia: "NVIDIA",
  ibm: "IBM",
  liquid: "Liquid AI",
  amazon: "Amazon",
  inception: "Inception",
  morph: "Morph",
  "360": "360",
  microsoft: "Microsoft",
  iflytek: "iFlytek",
  tii: "TII",
  deepgram: "Deepgram",
  jina: "Jina AI",
  voyage: "Voyage AI",
  baai: "BAAI",
  bfl: "Black Forest Labs",
  kling: "Kling",
  recraft: "Recraft",
  longcat: "LongCat",
  alephalpha: "Aleph Alpha",
  antgroup: "Ant Group",
  arcee: "Arcee AI",
  assemblyai: "AssemblyAI",
  baichuan: "Baichuan",
  briaai: "Bria AI",
  coqui: "Coqui",
  databricks: "Databricks",
  elevenlabs: "ElevenLabs",
  essentialai: "Essential AI",
  fishaudio: "Fish Audio",
  haiper: "Haiper",
  hedra: "Hedra",
  ideogram: "Ideogram",
  inflection: "Inflection AI",
  internlm: "InternLM",
  kwaipilot: "Kwaipilot",
  llava: "LLaVA",
  luma: "Luma AI",
  midjourney: "Midjourney",
  myshell: "MyShell",
  nousresearch: "Nous Research",
  novelai: "NovelAI",
  openchat: "OpenChat",
  pika: "Pika",
  pixverse: "PixVerse",
  reve: "Reve",
  runway: "Runway",
  rwkv: "RWKV",
  sensenova: "SenseNova",
  skywork: "Skywork",
  stability: "Stability AI",
  suno: "Suno",
  tripo: "Tripo",
  upstage: "Upstage",
  vidu: "Vidu",
  xuanyuan: "XuanYuan",
  yandex: "Yandex",
};

export function vendorDisplayName(vendorSlug: string): string {
  return VENDOR_DISPLAY_NAMES[vendorSlug] ?? vendorSlug;
}
