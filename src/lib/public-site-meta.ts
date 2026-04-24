import "server-only";

import { logger } from "@/lib/logger";
import {
  readPublicStatusSiteMetadata,
  resolvePublicStatusSiteDescription,
} from "@/lib/public-status/config-snapshot";
import { getSystemSettings } from "@/repository/system-config";
import { DEFAULT_SITE_TITLE, normalizeSiteTitle } from "./site-title";

export interface PublicSiteMeta {
  siteTitle: string;
  siteDescription: string;
}

export async function readPublicSiteMeta(): Promise<PublicSiteMeta> {
  try {
    const publicSnapshot = await readPublicStatusSiteMetadata();
    if (publicSnapshot) {
      return publicSnapshot;
    }
  } catch (error) {
    logger.warn("readPublicSiteMeta: failed to load public status snapshot", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const settings = await getSystemSettings();
    const systemTitle = normalizeSiteTitle(settings.siteTitle);
    if (systemTitle) {
      return {
        siteTitle: systemTitle,
        siteDescription: resolvePublicStatusSiteDescription({ siteTitle: systemTitle }),
      };
    }
  } catch (error) {
    logger.warn("readPublicSiteMeta: failed to load system settings; falling back to defaults", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    siteTitle: DEFAULT_SITE_TITLE,
    siteDescription: resolvePublicStatusSiteDescription({ siteTitle: DEFAULT_SITE_TITLE }),
  };
}
