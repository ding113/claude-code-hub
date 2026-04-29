import type { Context } from "hono";

export async function runWithHonoRequestContext<T>(c: Context, callback: () => T): Promise<T> {
  const [{ runWithRequestContext }, { getClientIp }] = await Promise.all([
    import("@/lib/audit/request-context"),
    import("@/lib/ip"),
  ]);
  return runWithRequestContext(
    {
      ip: getClientIp(c.req.raw.headers),
      userAgent: c.req.header("user-agent") ?? null,
    },
    callback
  );
}
