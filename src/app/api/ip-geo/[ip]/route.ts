import { getSession } from "@/lib/auth";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { lookupIp } from "@/lib/ip-geo/client";

// IP 查询需要 Redis + 网络，运行在 Node runtime
export const runtime = "nodejs";

/**
 * GET /api/ip-geo/:ip
 *
 * Dashboard 侧代理接口：根据 IP 返回归属地与网络信息。
 * - 仅登录用户可用（任何 role）
 * - 当系统设置 `ipGeoLookupEnabled` 为 false 时返回 404
 * - 结果由 Redis 缓存，默认 TTL 3600s
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ip: string }> }
) {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { ip } = await params;

  const settings = await getCachedSystemSettings();
  if (!settings.ipGeoLookupEnabled) {
    return Response.json({ error: "ip geolocation disabled" }, { status: 404 });
  }

  const result = await lookupIp(decodeURIComponent(ip));
  // Cache on the edge for a short window — response body already cached server-side.
  return Response.json(result, {
    headers: { "cache-control": "private, max-age=60" },
  });
}
