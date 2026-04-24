export async function resolveSiteMetadataSource(): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  try {
    const { loadPublicSiteMeta } = await import("./public-api-loader");
    const metadata = await loadPublicSiteMeta();
    if (!metadata.available || !metadata.siteTitle?.trim()) {
      return null;
    }

    return {
      siteTitle: metadata.siteTitle,
      siteDescription: metadata.siteDescription?.trim() || metadata.siteTitle,
    };
  } catch {
    return null;
  }
}

export async function resolveLayoutTimeZone(): Promise<string> {
  try {
    const { loadPublicSiteMeta } = await import("./public-api-loader");
    const metadata = await loadPublicSiteMeta();
    return metadata.timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}
