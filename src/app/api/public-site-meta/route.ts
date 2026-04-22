import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { readPublicSiteMeta } from "@/lib/public-site-meta";
import { resolvePublicStatusSiteDescription } from "@/lib/public-status/config-snapshot";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PUBLIC_SITE_META_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

export async function GET() {
  try {
    const meta = await readPublicSiteMeta();
    return NextResponse.json(meta, {
      headers: {
        "Cache-Control": PUBLIC_SITE_META_CACHE_CONTROL,
      },
    });
  } catch (error) {
    logger.error("GET /api/public-site-meta failed", { error });
    return NextResponse.json(
      {
        siteTitle: DEFAULT_SITE_TITLE,
        siteDescription: resolvePublicStatusSiteDescription({ siteTitle: DEFAULT_SITE_TITLE }),
      },
      {
        headers: {
          "Cache-Control": PUBLIC_SITE_META_CACHE_CONTROL,
        },
      }
    );
  }
}
