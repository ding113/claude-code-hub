/**
 * Clients that set base_url without `/v1` call `/chat/completions`, `/responses`,
 * `/models`, and `/messages` instead of the canonical `/v1/...` endpoints.
 *
 * Next.js serves those paths via sibling App Router route files; this helper
 * rewrites the Request URL so the Hono app (basePath `/v1`) and the rest of
 * the proxy pipeline see the canonical path.
 */
export const UNPREFIXED_V1_ALIASES = [
  "/chat/completions",
  "/responses",
  "/models",
  "/messages",
] as const;

type RequestDuplexInit = RequestInit & { duplex?: "half" };

function trimTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

export function mapUnprefixedV1Path(pathname: string): string {
  const path = trimTrailingSlash(pathname.split("?")[0] || "/");
  for (const alias of UNPREFIXED_V1_ALIASES) {
    if (path === alias || path.startsWith(`${alias}/`)) {
      return `/v1${path}`;
    }
  }
  return path;
}

export function rewriteUnprefixedV1Request(request: Request): Request {
  const url = new URL(request.url);
  const mapped = mapUnprefixedV1Path(url.pathname);
  if (mapped === url.pathname) {
    return request;
  }

  url.pathname = mapped;
  const init: RequestDuplexInit = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
    integrity: request.integrity,
    keepalive: request.keepalive,
    signal: request.signal,
  };
  if (request.body != null) {
    init.duplex = "half";
  }
  return new Request(url, init as RequestInit);
}
