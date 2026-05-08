// Pattern used by `src/proxy.ts` for the Next.js proxy/middleware matcher.
//
// Match all request paths except for the ones starting with:
// - api      (API routes - own auth via cookie session, no proxy needed)
// - v1 / v1beta (API proxy routes - own auth via Bearer token; matching
//   them here also forces Next.js to clone the request body via
//   getCloneableBody → cloneBodyStream, which clamps proxied bodies to
//   experimental.proxyClientMaxBodySize for no benefit since we no-op
//   immediately for these paths)
// - _next/static (static files)
// - _next/image (image optimization files)
// - favicon.ico (favicon file)
//
// Lifted into its own module so it can be exercised by a regression test
// without dragging in next-intl, the auth module, the logger, etc. that the
// proxy handler itself imports at module load time.
export const proxyMatcherPattern = "/((?!api|v1|_next/static|_next/image|favicon.ico).*)";
