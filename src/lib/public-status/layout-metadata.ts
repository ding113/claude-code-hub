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
  return {
    siteTitle: settings.siteTitle,
    siteDescription: settings.siteTitle,
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
