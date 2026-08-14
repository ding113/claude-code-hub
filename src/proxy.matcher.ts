// Pattern used by `src/proxy.ts` for the Next.js proxy/middleware matcher.
//
// Match all request paths except:
// - api          (API routes - own auth via cookie session, no proxy needed)
// - _next/static (static files)
// - _next/image  (image optimization files)
// - favicon.ico  (favicon file)
//
// Everything else reaches the middleware, including:
// - /v1 / /v1beta  API proxy routes. The middleware immediately passes them
//   through (NextResponse.next) — they authenticate via Bearer token inside
//   the App Router route handlers. IMPORTANT: they MUST stay inside the
//   matcher, because `NextResponse.rewrite` targets (bare OpenAI paths →
//   /v1/..., /v1/v1beta/... → /v1beta/...) must resolve inside the matcher
//   scope — Next.js 16.3 does not re-route a middleware rewrite whose target
//   is excluded by the matcher (returns 404).
//   Cost: matching these paths forces Next.js to clone the request body
//   (clamped to experimental.proxyClientMaxBodySize) even though we never
//   read it. LLM payloads are well under that limit, so this is acceptable.
// - bare OpenAI API paths (/models, /chat/completions, ...) — clients whose
//   base_url lacks `/v1` hit these; the middleware rewrites them to /v1/...
// - /v1/v1beta/... — Gemini SDK client whose base_url was set to `.../v1`
//   produces this prefix; the middleware rewrites it to /v1beta/...
//
// IMPORTANT: keep this pattern in sync with the inlined literal in
// `src/proxy.ts` — Next.js requires `config.matcher` entries to be string
// literals so its build-time static analyzer can collect them. The unit
// test in `tests/unit/proxy-matcher.test.ts` enforces drift between the two.
export const proxyMatcherPattern = "/((?!api|_next/static|_next/image|favicon.ico).*)";
