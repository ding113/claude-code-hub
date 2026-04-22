import { DEFAULT_SITE_TITLE, resolveSiteTitle } from "@/lib/site-title";

export async function resolveSiteMetadataSource(input: {
  isPublicStatusRequest: boolean;
}): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  if (input.isPublicStatusRequest) {
    const { readPublicSiteMeta } = await import("@/lib/public-site-meta");
    const metadata = await readPublicSiteMeta();
    return {
      siteTitle: metadata.siteTitle,
      siteDescription: metadata.siteDescription,
    };
  }

  const { getSystemSettings } = await import("@/repository/system-config");
  const settings = await getSystemSettings();
  return {
    siteTitle: resolveSiteTitle(settings.siteTitle, DEFAULT_SITE_TITLE),
    siteDescription: resolveSiteTitle(settings.siteTitle, DEFAULT_SITE_TITLE),
  };
}

export async function resolveLayoutTimeZone(input: {
  isPublicStatusRequest: boolean;
}): Promise<string> {
  if (input.isPublicStatusRequest) {
    const { readPublicStatusTimeZone } = await import("./config-snapshot");
    return (await readPublicStatusTimeZone()) || "UTC";
  }

  const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
  return await resolveSystemTimezone();
}
