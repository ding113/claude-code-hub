import type { Metadata } from "next";
import { cookies } from "next/headers";
import { defaultLocale, localeCookieName } from "@/i18n/config";
import { getLocaleFromValue } from "@/i18n/pathname";
import { redirect } from "@/i18n/routing";
import { DEFAULT_SITE_TITLE } from "@/lib/site-title";

export const metadata: Metadata = {
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_TITLE,
};

export default async function RootPage() {
  const cookieStore = await cookies();
  const locale = getLocaleFromValue(cookieStore.get(localeCookieName)?.value) || defaultLocale;

  redirect({ href: "/dashboard", locale });
}
