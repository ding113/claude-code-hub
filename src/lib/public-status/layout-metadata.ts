import { readPublicStatusSiteMetadata } from "@/lib/public-status/config-snapshot";
import { getSystemSettings } from "@/repository/system-config";

export async function resolveSiteMetadataSource(input: {
  isPublicStatusRequest: boolean;
}): Promise<{
  siteTitle: string;
  siteDescription: string;
} | null> {
  if (input.isPublicStatusRequest) {
    return await readPublicStatusSiteMetadata();
  }

  const settings = await getSystemSettings();
  return {
    siteTitle: settings.siteTitle,
    siteDescription: settings.siteTitle,
  };
}
