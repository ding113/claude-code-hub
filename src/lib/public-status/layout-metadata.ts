const FALLBACK_SITE_TITLE = "Claude Code Hub";

export async function resolveSiteMetadataSource(input: {
  isPublicStatusRequest: boolean;
}): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  if (input.isPublicStatusRequest) {
    const { readPublicStatusSiteMetadata } = await import("./config-snapshot");
    return await readPublicStatusSiteMetadata();
  }

  const { getSystemSettings } = await import("@/repository/system-config");
  const settings = await getSystemSettings();
  const title = settings.siteTitle?.trim() || FALLBACK_SITE_TITLE;

  return {
    siteTitle: title,
    siteDescription: title,
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
