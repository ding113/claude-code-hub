import "server-only";

import { readPublicStatusSiteMetadata } from "@/lib/public-status/config-snapshot";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_SITE_TITLE, normalizeSiteTitle, resolveSiteTitle } from "./site-title";

export interface PublicSiteMeta {
  siteTitle: string;
}

export async function readPublicSiteMeta(): Promise<PublicSiteMeta> {
  try {
    const settings = await getSystemSettings();
    const systemTitle = normalizeSiteTitle(settings.siteTitle);
    if (systemTitle) {
      return { siteTitle: systemTitle };
    }
  } catch {
    // fall through to public snapshot
  }

  const publicSnapshot = await readPublicStatusSiteMetadata();
  return {
    siteTitle: resolveSiteTitle(publicSnapshot?.siteTitle, DEFAULT_SITE_TITLE),
  };
}
