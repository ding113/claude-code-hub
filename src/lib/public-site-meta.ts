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

  let publicSnapshot: Awaited<ReturnType<typeof readPublicStatusSiteMetadata>> = null;
  try {
    publicSnapshot = await readPublicStatusSiteMetadata();
  } catch {
    publicSnapshot = null;
  }

  return {
    siteTitle: resolveSiteTitle(publicSnapshot?.siteTitle, DEFAULT_SITE_TITLE),
  };
}
