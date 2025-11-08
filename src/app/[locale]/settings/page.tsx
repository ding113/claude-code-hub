import { redirect } from "@/i18n/routing";

import { SETTINGS_NAV_ITEMS } from "./_lib/nav-items";

export default async function SettingsIndex({ params }: { params: Promise<{ locale: string }> }) {
  // Await params to ensure locale is available in the async context
  const { locale } = await params;
  const firstItem = SETTINGS_NAV_ITEMS[0];
  const href = firstItem?.href ?? "/dashboard";
  return redirect({ href, locale });
}
