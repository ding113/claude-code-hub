// 兼容性 rewrites —— 客户端 base_url 与 CCH 实际路由前缀不一致时，
// 在服务端路由层（next.config rewrites，构建期路由表）透明重写。
//
// 为什么不用 middleware（src/proxy.ts）里的 NextResponse.rewrite/redirect：
// - Next.js 16.3 的 middleware rewrite 到被 proxy matcher 排除的路径（/v1、/v1beta）
//   不会重新路由，直接 404；
// - redirect（307）需要客户端跟随，Hermes 的 OpenAI SDK 不跟随 307，会把 307 当
//   APIStatusError 抛错；
// - next.config rewrites 是纯路由表改写，不经过 middleware matcher，客户端完全无感
//   （无 307、无 body-clone 开销），对 Hermes / OpenAI SDK / Gemini SDK 全部适用。
//
// 覆盖的场景：
// 1. 裸 OpenAI API 路径（客户端 base_url 不带 /v1，如 Hermes 配裸地址）：
//    /models → /v1/models、/chat/completions → /v1/chat/completions 等
// 2. Gemini SDK 配 .../v1（SDK 自带 /v1beta 前缀，拼成 /v1/v1beta/...）：
//    /v1/v1beta/... → /v1beta/...（剥掉多余的 /v1）
export const API_PROXY_PATH = "/v1";
export const GEMINI_PROXY_PATH = "/v1beta";

const BARE_OPENAI_API_PATH_PREFIXES = [
  "/models",
  "/chat/completions",
  "/responses",
  "/completions",
  "/embeddings",
  "/props",
  "/_ping",
] as const;

export function compatRewrites() {
  const rules: Array<{ source: string; destination: string }> = [
    // Gemini SDK 配 .../v1：/v1/v1beta/... → /v1beta/...
    { source: "/v1/v1beta", destination: GEMINI_PROXY_PATH },
    { source: "/v1/v1beta/:path*", destination: `${GEMINI_PROXY_PATH}/:path*` },
  ];

  for (const prefix of BARE_OPENAI_API_PATH_PREFIXES) {
    rules.push({ source: prefix, destination: `${API_PROXY_PATH}${prefix}` });
    rules.push({
      source: `${prefix}/:path*`,
      destination: `${API_PROXY_PATH}${prefix}/:path*`,
    });
  }

  return rules;
}
