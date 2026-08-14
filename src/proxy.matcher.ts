// Pattern used by `src/proxy.ts` for the Next.js proxy/middleware matcher.
//
// Match all request paths except for the ones starting with:
// - api          (API routes - own auth via cookie session, no proxy needed)
// - v1 / v1beta  (API proxy routes - own auth via Bearer token; matching
//   them here also forces Next.js to clone the request body via
//   getCloneableBody → cloneBodyStream, which clamps proxied bodies to
//   experimental.proxyClientMaxBodySize for no benefit since we no-op
//   immediately for these paths). Anchored to a path-segment boundary
//   (`/` or end of string) so future routes like `/v10/...` are NOT
//   accidentally excluded.
//   Exception: `/v1/v1beta/...` (a Gemini SDK client whose base_url was set
//   to `.../v1`) MUST reach the proxy so it can be rewritten to `/v1beta/...`.
//   The negative lookahead `(?!v1beta(?:/|$))` keeps that prefix inside the
//   proxy's scope while everything else under `/v1` stays excluded.
// - _next/static (static files)
// - _next/image  (image optimization files)
// - favicon.ico  (favicon file)
//
// IMPORTANT: keep this pattern in sync with the inlined literal in
// `src/proxy.ts` — Next.js requires `config.matcher` entries to be string
// literals so its build-time static analyzer can collect them. The unit
// test in `tests/unit/proxy-matcher.test.ts` enforces drift between the two.
export const proxyMatcherPattern =
  "/((?!api|v1(?:/(?!v1beta(?:/|$))|$)|v1beta(?:/|$)|_next/static|_next/image|favicon.ico).*)";
