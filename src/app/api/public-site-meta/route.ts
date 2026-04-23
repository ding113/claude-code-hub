import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import {
  readCurrentPublicStatusConfigSnapshot,
  resolvePublicStatusSiteDescription,
} from "@/lib/public-status/config-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PUBLIC_SITE_META_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

export async function GET() {
  try {
    const snapshot = await readCurrentPublicStatusConfigSnapshot();
    const responseBody = snapshot
      ? {
          available: true,
          siteTitle: snapshot.siteTitle?.trim() || null,
          siteDescription: resolvePublicStatusSiteDescription({
            siteTitle: snapshot.siteTitle,
            siteDescription: snapshot.siteDescription,
          }),
          timeZone: snapshot.timeZone ?? null,
          source: "projection" as const,
        }
      : {
          available: false,
          siteTitle: null,
          siteDescription: null,
          timeZone: null,
          source: "projection" as const,
          reason: "projection_missing" as const,
        };

    return NextResponse.json(responseBody, {
      headers: {
        "Cache-Control": PUBLIC_SITE_META_CACHE_CONTROL,
      },
    });
  } catch (error) {
    logger.error("GET /api/public-site-meta failed", { error });
    return NextResponse.json(
      {
        error: "Public site metadata unavailable",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
