"use strict";

// 客户端 base_url 与 CCH 实际路由前缀不一致时的 URL 兼容改写。
//
// 这个模块运行在自定义 Node server（server.js）的 HTTP 入口，在把请求交给
// Next.js handler 之前直接改写 pathname —— 纯 Node 层面，不依赖 Next 的
// middleware rewrite / next.config rewrites（Next.js 16.3 + programmatic
// server 环境下这两者都不可靠：rewrite 头出现但不重新路由 → 404；
// next.config rewrites 在 routes-manifest 里有但运行时被忽略 → 404）。
//
// 覆盖的场景：
// 1. 裸 OpenAI API 路径（客户端 base_url 不带 /v1，如 Hermes）：
//    /models → /v1/models、/chat/completions → /v1/chat/completions 等
// 2. Gemini SDK 配 .../v1（SDK 自带 /v1beta 前缀，拼成 /v1/v1beta/...）：
//    /v1/v1beta/... → /v1beta/...（剥掉多余的 /v1）

const BARE_OPENAI_API_PATH_PREFIXES = [
  "/models",
  "/chat/completions",
  "/responses",
  "/completions",
  "/embeddings",
  "/props",
  "/_ping",
];

const NESTED_GEMINI_PREFIX = "/v1/v1beta";
const API_PROXY_PATH = "/v1";

/**
 * Rewrite a request pathname for base_url path compatibility.
 * Returns the same string when no rewrite applies.
 * @param {string} pathname
 * @returns {string}
 */
function rewriteCompatPath(pathname) {
  // Gemini SDK 客户端 base_url 配成 .../v1 → /v1/v1beta/...，剥掉多余的 /v1
  if (pathname === NESTED_GEMINI_PREFIX) {
    return pathname.slice(API_PROXY_PATH.length) || "/";
  }
  if (pathname.startsWith(`${NESTED_GEMINI_PREFIX}/`)) {
    return pathname.slice(API_PROXY_PATH.length);
  }

  // 裸 OpenAI API 路径 → 加 /v1 前缀
  for (const prefix of BARE_OPENAI_API_PATH_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${API_PROXY_PATH}${pathname}`;
    }
  }

  return pathname;
}

module.exports = {
  rewriteCompatPath,
  BARE_OPENAI_API_PATH_PREFIXES,
};
