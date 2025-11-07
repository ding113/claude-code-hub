import { redirect } from "@/i18n/routing";

import { SETTINGS_NAV_ITEMS } from "./_lib/nav-items";

export default function SettingsIndex() {
  const firstItem = SETTINGS_NAV_ITEMS[0];
  const href = firstItem?.href ?? "/dashboard";
  redirect(href as any);
}
