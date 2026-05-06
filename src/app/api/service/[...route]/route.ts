import type { NextRequest } from "next/server";
import { createTempKey, getKeyUsage, revokeKey } from "@/actions/service/keys";
import { batchSyncProviders } from "@/actions/service/providers";

// 运行时配置
export const runtime = "nodejs";

// 路由映射表
const ROUTE_HANDLERS: Record<
  string,
  {
    POST?: (body: any) => Promise<Response>;
    GET?: (params: Record<string, string>) => Promise<Response>;
  }
> = {
  // Keys
  "keys/createTemp": {
    POST: async (body) => {
      const result = await createTempKey(body);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    },
  },
  "keys/revoke": {
    POST: async (body) => {
      const result = await revokeKey(body);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    },
  },
  "keys/usage": {
    GET: async (params) => {
      const result = await getKeyUsage({ key: params.key });
      return Response.json(result, { status: result.ok ? 200 : 400 });
    },
  },

  // Providers
  "providers/batchSync": {
    POST: async (body) => {
      const result = await batchSyncProviders(body);
      return Response.json(result, { status: result.ok ? 200 : 400 });
    },
  },
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/service/", "");

  const handler = ROUTE_HANDLERS[path]?.GET;
  if (!handler) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // 提取 URL 参数
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return handler(params);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/service/", "");

  const handler = ROUTE_HANDLERS[path]?.POST;
  if (!handler) {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  return handler(body);
}
