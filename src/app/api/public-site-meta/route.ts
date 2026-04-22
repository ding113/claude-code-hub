import { NextResponse } from "next/server";
import { readPublicSiteMeta } from "@/lib/public-site-meta";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const meta = await readPublicSiteMeta();
    return NextResponse.json(meta);
  } catch {
    return NextResponse.json({ siteTitle: DEFAULT_SITE_TITLE });
  }
}
